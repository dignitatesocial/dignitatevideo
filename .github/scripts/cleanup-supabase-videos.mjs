const SUPABASE_URL = String(process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_BUCKET = String(process.env.SUPABASE_BUCKET || 'videos').trim();
const SUPABASE_PREFIX = String(process.env.SUPABASE_PREFIX || 'videos').trim().replace(/^\/+|\/+$/g, '');
const RETENTION_DAYS = Number(process.env.RETENTION_DAYS || 7);

if (!SUPABASE_URL) throw new Error('SUPABASE_URL is required');
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required');
if (!SUPABASE_BUCKET) throw new Error('SUPABASE_BUCKET is required');
if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS <= 0) {
  throw new Error('RETENTION_DAYS must be a positive number');
}

const headers = {
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
};

const cutoffMs = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
const LIST_LIMIT = 100;

const log = (...args) => console.log('[cleanup]', ...args);

function buildObjectPath(name) {
  const n = String(name || '').trim().replace(/^\/+/, '');
  if (!n) return '';
  return SUPABASE_PREFIX ? `${SUPABASE_PREFIX}/${n}` : n;
}

function parseFileTimestamp(item, objectPath) {
  const base = String(objectPath || '').split('/').pop() || '';
  const match = base.match(/^(\d{10,})-/);
  if (match) {
    const ts = Number(match[1]);
    if (Number.isFinite(ts) && ts > 0) return ts;
  }

  const fallbacks = [item?.created_at, item?.updated_at, item?.last_accessed_at]
    .map((v) => Date.parse(String(v || '')))
    .find((v) => Number.isFinite(v));

  return Number.isFinite(fallbacks) ? fallbacks : NaN;
}

function isVideoPath(objectPath) {
  return /\.(mp4|mov|webm|m3u8)$/i.test(String(objectPath || ''));
}

async function listPage(offset) {
  const url = `${SUPABASE_URL}/storage/v1/object/list/${encodeURIComponent(SUPABASE_BUCKET)}`;
  const body = {
    prefix: SUPABASE_PREFIX,
    limit: LIST_LIMIT,
    offset,
    sortBy: { column: 'name', order: 'asc' },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`List failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const json = await res.json();
  if (!Array.isArray(json)) return [];
  return json;
}

async function removePaths(paths) {
  if (!paths.length) return;
  const url = `${SUPABASE_URL}/storage/v1/object/remove`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prefixes: paths }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Remove failed (${res.status}): ${text.slice(0, 400)}`);
  }

  const data = await res.json().catch(() => ({}));
  const count = Array.isArray(data) ? data.length : paths.length;
  log(`Removed ${count} objects in batch`);
}

async function main() {
  log(`Bucket=${SUPABASE_BUCKET} Prefix=${SUPABASE_PREFIX || '(root)'} Retention=${RETENTION_DAYS} day(s)`);

  let offset = 0;
  let scanned = 0;
  const toDelete = [];

  while (true) {
    const page = await listPage(offset);
    if (page.length === 0) break;

    for (const item of page) {
      const objectPath = buildObjectPath(item?.name);
      if (!objectPath || !isVideoPath(objectPath)) continue;

      const ts = parseFileTimestamp(item, objectPath);
      if (!Number.isFinite(ts)) continue;

      scanned += 1;
      if (ts < cutoffMs) {
        toDelete.push(objectPath);
      }
    }

    offset += page.length;
    if (page.length < LIST_LIMIT) break;
  }

  log(`Scanned ${scanned} video objects. Found ${toDelete.length} expired.`);

  const CHUNK = 100;
  for (let i = 0; i < toDelete.length; i += CHUNK) {
    const slice = toDelete.slice(i, i + CHUNK);
    await removePaths(slice);
  }

  log('Cleanup complete.');
}

main().catch((err) => {
  console.error('[cleanup] Failed:', err);
  process.exit(1);
});
