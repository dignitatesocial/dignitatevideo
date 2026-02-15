import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { parseFile } from "music-metadata";

interface RenderInput {
  clipUrls: string[];
  // Optional: when clipUrls are not ready yet, pass fal queue request ids/urls.
  // The GitHub Action can resolve these into mp4 URLs before rendering.
  clipRequests?: Array<{
    requestId?: string;
    request_id?: string;
    statusUrl?: string;
    status_url?: string;
    responseUrl?: string;
    response_url?: string;
    duration?: number;
    index?: number;
  }>;
  // Optional: founder portrait pool for identity anchoring in scene-image generation.
  creatorImageUrl?: string;
  creatorImageUrls?: string[];
  audioUrl?: string;
  narrationText?: string;
  voiceId?: string;
  n8nWebhookUrl?: string;
  scenes: Array<{
    narration: string;
    visualPrompt: string;
    type: string;
    duration: number;
    index: number;
    // Optional: richer prompts produced by n8n.
    videoPrompt?: string;
    sceneImagePrompt?: string;
    creatorImageUrl?: string;
    creatorImageUrls?: string[];
  }>;
  title: string;
  chatId: string;
}

function parseRenderInput(rawInput: string): RenderInput {
  const parsed = JSON.parse(rawInput);
  let candidate: any = parsed;

  // repository_dispatch payload is often wrapped for GitHub limits:
  // client_payload: { job: { ...actual render input... } }
  if (candidate && typeof candidate === "object" && candidate.job) {
    candidate = candidate.job;
  }

  if (candidate && typeof candidate === "object" && typeof candidate.payloadJson === "string") {
    candidate = JSON.parse(candidate.payloadJson);
  }

  if (candidate && typeof candidate === "object" && typeof candidate.payloadB64 === "string") {
    const decoded = Buffer.from(candidate.payloadB64, "base64").toString("utf8");
    candidate = JSON.parse(decoded);
  }

  return {
    ...candidate,
    clipUrls: Array.isArray(candidate?.clipUrls) ? candidate.clipUrls : [],
    clipRequests: Array.isArray(candidate?.clipRequests) ? candidate.clipRequests : [],
    creatorImageUrl: clean(candidate?.creatorImageUrl),
    creatorImageUrls: Array.isArray(candidate?.creatorImageUrls) ? candidate.creatorImageUrls : [],
    scenes: Array.isArray(candidate?.scenes) ? candidate.scenes : [],
    title: String(candidate?.title || "Untitled Video"),
    chatId: String(candidate?.chatId || ""),
  } as RenderInput;
}

function clean(s: unknown): string {
  return String(s ?? "").trim();
}

function looksLikeUrl(u: string): boolean {
  return /^https?:\/\//i.test(clean(u));
}

function looksLikeVideoUrl(u: string): boolean {
  const s = clean(u);
  if (!looksLikeUrl(s)) return false;
  const lower = s.toLowerCase();
  const bare = lower.split("?")[0].split("#")[0];
  if (bare.endsWith(".mp4") || bare.endsWith(".mov") || bare.endsWith(".webm") || bare.endsWith(".m3u8")) return true;
  if (lower.includes("fal.media/files/")) return true;
  return false;
}

function looksLikeImageUrl(u: string): boolean {
  const s = clean(u);
  if (!looksLikeUrl(s)) return false;
  const lower = s.toLowerCase();
  const bare = lower.split("?")[0].split("#")[0];
  if (bare.endsWith(".png") || bare.endsWith(".jpg") || bare.endsWith(".jpeg") || bare.endsWith(".webp")) return true;
  if (lower.includes("fal.media/files/")) return true;
  return false;
}

function getRequestId(req: any): string {
  return clean(req?.requestId || req?.request_id);
}

function getStatusUrl(req: any): string {
  return clean(req?.statusUrl || req?.status_url);
}

function getResponseUrl(req: any): string {
  return clean(req?.responseUrl || req?.response_url);
}

function pickFirstVideoUrl(payload: any): string {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (v: any) => {
    const u = clean(v);
    if (!u || seen.has(u) || !looksLikeVideoUrl(u)) return;
    seen.add(u);
    out.push(u);
  };

  const walk = (node: any, depth = 0) => {
    if (node == null || depth > 8) return;
    if (typeof node === "string") {
      push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    push((node as any)?.video?.url);
    push((node as any)?.data?.video?.url);
    push((node as any)?.output?.video?.url);
    push((node as any)?.result?.video?.url);
    push((node as any)?.response?.video?.url);
    push((node as any)?.video_url);
    push((node as any)?.videoUrl);
    push((node as any)?.url);

    for (const v of Object.values(node as any)) walk(v, depth + 1);
  };

  walk(payload);
  return out[0] || "";
}

function pickFirstImageUrl(payload: any): string {
  const seen = new Set<string>();
  const out: string[] = [];

  const push = (v: any) => {
    const u = clean(v);
    if (!u || seen.has(u) || !looksLikeImageUrl(u)) return;
    // Filter out queue/status urls
    if (u.includes("queue.fal.run") && u.includes("/requests/")) return;
    seen.add(u);
    out.push(u);
  };

  const walk = (node: any, depth = 0) => {
    if (node == null || depth > 8) return;
    if (typeof node === "string") {
      push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const x of node) walk(x, depth + 1);
      return;
    }
    if (typeof node !== "object") return;

    push((node as any)?.url);
    push((node as any)?.image_url);
    push((node as any)?.imageUrl);
    push((node as any)?.data?.image?.url);
    push((node as any)?.data?.images?.[0]?.url);
    push((node as any)?.images?.[0]?.url);

    for (const v of Object.values(node as any)) walk(v, depth + 1);
  };

  walk(payload);
  return out[0] || "";
}

async function falGetJson(url: string, falKey: string): Promise<any> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Key ${falKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`fal GET failed (${res.status}) for ${url}: ${body.slice(0, 200)}`);
  }
  return await res.json();
}

async function falPostJson(url: string, body: any, falKey: string): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Key ${falKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`fal POST failed (${res.status}) for ${url}: ${text.slice(0, 200)}`);
  }
  return await res.json();
}

async function resolveFalClipUrl(
  req: any,
  falKey: string,
  opts: { pollIntervalMs: number; maxWaitMs: number }
): Promise<string> {
  const requestId = getRequestId(req);
  const statusUrl = getStatusUrl(req);
  const responseUrl = getResponseUrl(req);

  const fallbackStatusUrl = requestId
    ? `https://queue.fal.run/fal-ai/kling-video/requests/${encodeURIComponent(requestId)}/status`
    : "";
  const fallbackResponseUrl = requestId
    ? `https://queue.fal.run/fal-ai/kling-video/requests/${encodeURIComponent(requestId)}`
    : "";

  const started = Date.now();
  const deadline = started + opts.maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const sUrl = looksLikeUrl(statusUrl) ? statusUrl : fallbackStatusUrl;
      if (sUrl) {
        const statusJson = await falGetJson(sUrl, falKey);
        const status = clean(
          statusJson?.status || statusJson?.data?.status || statusJson?.request_status || ""
        ).toUpperCase();
        if (["FAILED", "ERROR", "CANCELLED"].includes(status)) {
          throw new Error(`fal clip request failed: status=${status}`);
        }
      }
    } catch (e) {
      console.log(`fal status check warning: ${String((e as any)?.message || e).slice(0, 160)}`);
    }

    try {
      const rUrl = looksLikeUrl(responseUrl) ? responseUrl : fallbackResponseUrl;
      if (rUrl) {
        const resultJson = await falGetJson(rUrl, falKey);
        const direct = pickFirstVideoUrl(resultJson) || pickFirstVideoUrl(req);
        if (direct) return direct;
      }
    } catch (e) {
      console.log(`fal result fetch warning: ${String((e as any)?.message || e).slice(0, 160)}`);
    }

    await new Promise((r) => setTimeout(r, opts.pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for fal clip (requestId=${requestId || "n/a"}) after ${Math.round(
      opts.maxWaitMs / 1000
    )}s`
  );
}

async function resolveFalImageUrl(
  req: any,
  falKey: string,
  opts: { pollIntervalMs: number; maxWaitMs: number; modelPath: string }
): Promise<string> {
  const requestId = getRequestId(req);
  const statusUrl = getStatusUrl(req);
  const responseUrl = getResponseUrl(req);

  const fallbackStatusUrl = requestId
    ? `https://queue.fal.run/${opts.modelPath}/requests/${encodeURIComponent(requestId)}/status`
    : "";
  const fallbackResponseUrl = requestId
    ? `https://queue.fal.run/${opts.modelPath}/requests/${encodeURIComponent(requestId)}`
    : "";

  const started = Date.now();
  const deadline = started + opts.maxWaitMs;

  while (Date.now() < deadline) {
    try {
      const rUrl = looksLikeUrl(responseUrl) ? responseUrl : fallbackResponseUrl;
      if (rUrl) {
        const resultJson = await falGetJson(rUrl, falKey);
        const direct = pickFirstImageUrl(resultJson) || pickFirstImageUrl(req);
        if (direct) return direct;
      }
    } catch (e) {
      console.log(`fal image result fetch warning: ${String((e as any)?.message || e).slice(0, 160)}`);
    }

    try {
      const sUrl = looksLikeUrl(statusUrl) ? statusUrl : fallbackStatusUrl;
      if (sUrl) {
        const statusJson = await falGetJson(sUrl, falKey);
        const status = clean(
          statusJson?.status || statusJson?.data?.status || statusJson?.request_status || ""
        ).toUpperCase();
        if (["FAILED", "ERROR", "CANCELLED"].includes(status)) {
          throw new Error(`fal image request failed: status=${status}`);
        }
      }
    } catch (e) {
      console.log(`fal image status warning: ${String((e as any)?.message || e).slice(0, 160)}`);
    }

    await new Promise((r) => setTimeout(r, opts.pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for fal image (requestId=${requestId || "n/a"}) after ${Math.round(
      opts.maxWaitMs / 1000
    )}s`
  );
}

async function resolveClipUrlsFromFal(
  clipRequests: RenderInput["clipRequests"]
): Promise<string[]> {
  const falKey = String(process.env.FAL_KEY || "").trim();
  if (!falKey) {
    throw new Error("clipRequests were provided but FAL_KEY is missing in GitHub Actions secrets/env.");
  }

  const reqs = (clipRequests || []).filter(Boolean);
  if (reqs.length === 0) return [];

  console.log(`Resolving ${reqs.length} clip request(s) via fal queue...`);
  const pollIntervalMs = 4000;
  const maxWaitMs = 22 * 60 * 1000;

  const concurrency = 3;
  const results: string[] = new Array(reqs.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= reqs.length) return;
      const url = await resolveFalClipUrl(reqs[i], falKey, { pollIntervalMs, maxWaitMs });
      results[i] = url;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, reqs.length) }, () => worker()));
  const resolved = results.filter((u) => looksLikeVideoUrl(u));

  if (resolved.length !== reqs.length) {
    throw new Error(`Failed to resolve all clip request URLs (${resolved.length}/${reqs.length})`);
  }

  return resolved;
}

function normalizeUrlList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list) {
    const u = clean(v);
    if (!looksLikeUrl(u)) continue;
    const k = u.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

async function generateClipsFromScenes(
  input: RenderInput
): Promise<string[]> {
  const falKey = String(process.env.FAL_KEY || "").trim();
  if (!falKey) {
    throw new Error("Generating clips from scenes requires FAL_KEY.");
  }

  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  if (scenes.length === 0) return [];

  const basePool = normalizeUrlList(input.creatorImageUrls);
  const baseSingle = clean(input.creatorImageUrl);

  const nanoUrl = "https://queue.fal.run/fal-ai/nano-banana-pro/edit";
  const nanoModelPath = "fal-ai/nano-banana-pro";
  const klingUrl = "https://queue.fal.run/fal-ai/kling-video/o3/standard/image-to-video";

  const pollIntervalMs = 4000;
  const maxWaitMs = 22 * 60 * 1000;

  const concurrency = 2;
  const results: string[] = new Array(scenes.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= scenes.length) return;
      const s = scenes[i] as any;

      const pool = normalizeUrlList(s.creatorImageUrls).length
        ? normalizeUrlList(s.creatorImageUrls)
        : (basePool.length ? basePool : (baseSingle ? [baseSingle] : []));
      if (pool.length === 0) {
        throw new Error("No creatorImageUrls available for identity anchoring.");
      }

      const sceneImagePrompt = clean(s.sceneImagePrompt || s.visualPrompt || "");
      const videoPrompt = clean(s.videoPrompt || s.visualPrompt || "");
      const duration = Number(s.duration) && Number(s.duration) > 0 ? Number(s.duration) : 15;

      console.log(`Scene ${i + 1}/${scenes.length}: generating start frame...`);
      const sceneImageSubmit = await falPostJson(
        nanoUrl,
        {
          prompt: sceneImagePrompt || "Photorealistic UK dementia-care documentary scene, vertical 9:16.",
          image_urls: pool,
          num_images: 1,
          aspect_ratio: "9:16",
          output_format: "png",
          resolution: "1K",
          safety_tolerance: "4",
          limit_generations: true,
        },
        falKey
      );

      const sceneImageUrl = await resolveFalImageUrl(sceneImageSubmit, falKey, {
        pollIntervalMs,
        maxWaitMs,
        modelPath: nanoModelPath,
      });
      console.log(`Scene ${i + 1}: start frame ready: ${sceneImageUrl}`);

      console.log(`Scene ${i + 1}/${scenes.length}: generating clip (${duration}s)...`);
      const clipSubmit = await falPostJson(
        klingUrl,
        {
          image_url: sceneImageUrl,
          prompt: videoPrompt || "Photorealistic UK dementia-care documentary scene.",
          duration,
          aspect_ratio: "9:16",
          generate_audio: false,
        },
        falKey
      );

      const clipUrl = await resolveFalClipUrl(clipSubmit, falKey, { pollIntervalMs, maxWaitMs });
      console.log(`Scene ${i + 1}: clip ready: ${clipUrl}`);
      results[i] = clipUrl;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, scenes.length) }, () => worker()));
  const done = results.filter((u) => looksLikeVideoUrl(u));
  if (done.length !== scenes.length) {
    throw new Error(`Only generated ${done.length}/${scenes.length} clips`);
  }
  return results;
}

async function downloadToFile(url: string, destPath: string): Promise<string> {
  console.log(`Downloading: ${url} -> ${destPath}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  console.log(`Downloaded: ${destPath} (${buffer.length} bytes)`);
  return destPath;
}

async function getAudioDuration(filePath: string): Promise<number> {
  // Prefer real metadata duration; fallback to a rough estimate if parsing fails.
  try {
    const metadata = await parseFile(filePath, { duration: true });
    const dur = Number(metadata?.format?.duration);
    if (Number.isFinite(dur) && dur > 0) {
      console.log(`Audio duration (metadata): ${dur.toFixed(2)}s`);
      return dur;
    }
  } catch (e) {
    console.log(
      `Audio duration parse failed, falling back to estimate: ${String(
        (e as any)?.message || e
      ).slice(0, 180)}`
    );
  }

  // Estimate duration from file size for MP3 at 128kbps
  const stats = fs.statSync(filePath);
  const fileSizeBytes = stats.size;
  const bitrateKbps = 128;
  const durationSec = (fileSizeBytes * 8) / (bitrateKbps * 1000);
  console.log(
    `Audio duration (estimated): ${durationSec.toFixed(1)}s (${fileSizeBytes} bytes at ${bitrateKbps}kbps)`
  );
  return durationSec;
}

function fileToDataUri(filePath: string, mimeType: string): string {
  const buffer = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function synthesizeVoiceoverElevenLabs(
  text: string,
  voiceId: string,
  destPath: string
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is missing");
  }

  const cleanedText = String(text || "").trim();
  if (!cleanedText) {
    throw new Error("Narration text is empty");
  }

  const resolvedVoiceId = String(voiceId || "GoLTMzQJAHarswiHqv3L").trim();
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(resolvedVoiceId)}`;

  console.log(`Generating voiceover with ElevenLabs voice ${resolvedVoiceId}...`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: cleanedText,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.4,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `ElevenLabs TTS failed (${response.status}): ${body.slice(0, 200)}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destPath, buffer);
  console.log(`Voiceover generated: ${destPath} (${buffer.length} bytes)`);
  return destPath;
}

async function uploadToSupabase(
  filePath: string,
  key: string
): Promise<string> {
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const bucket = String(process.env.SUPABASE_BUCKET || "").trim();

  if (!supabaseUrl || !serviceRoleKey || !bucket) {
    throw new Error(
      "Missing Supabase env vars. Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET"
    );
  }

  const objectPath = String(key)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath}`;
  const fileBuffer = fs.readFileSync(filePath);

  const uploadOnce = async () =>
    fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "video/mp4",
        "x-upsert": "true",
      },
      body: fileBuffer,
    });

  const ensureBucket = async () => {
    const createRes = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: bucket,
        name: bucket,
        public: true,
      }),
    });
    if (!createRes.ok && createRes.status !== 409) {
      const body = await createRes.text().catch(() => "");
      throw new Error(
        `Supabase bucket create failed (${createRes.status}): ${body.slice(0, 300)}`
      );
    }
  };

  let uploadRes = await uploadOnce();

  if (!uploadRes.ok && uploadRes.status === 400) {
    const body = await uploadRes.text().catch(() => "");
    if (/Bucket not found/i.test(body)) {
      console.log(`Supabase bucket "${bucket}" missing, creating it now...`);
      await ensureBucket();
      uploadRes = await uploadOnce();
    } else {
      throw new Error(`Supabase upload failed (${uploadRes.status}): ${body.slice(0, 300)}`);
    }
  }

  if (!uploadRes.ok) {
    const body = await uploadRes.text().catch(() => "");
    throw new Error(
      `Supabase upload failed (${uploadRes.status}): ${body.slice(0, 300)}`
    );
  }

  const publicUrl = `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${objectPath}`;
  console.log(`Uploaded to Supabase Storage: ${publicUrl}`);
  return publicUrl;
}

async function main() {
  console.log("=== Dignitate Video Renderer ===");

  // Parse input props from environment
  const rawInput = process.env.INPUT_PROPS;
  if (!rawInput) {
    throw new Error("INPUT_PROPS environment variable is required");
  }

  const input: RenderInput = parseRenderInput(rawInput);
  console.log(`Title: ${input.title}`);
  console.log(`Clips: ${input.clipUrls.length}`);
  console.log(`Scenes: ${input.scenes.length}`);

  let remoteClipUrls = (input.clipUrls || [])
    .map((u) => String(u || "").trim())
    .filter((u) => /^https?:\/\//i.test(u));

  if (remoteClipUrls.length === 0 && (input.clipRequests || []).length > 0) {
    remoteClipUrls = await resolveClipUrlsFromFal(input.clipRequests);
  }

  // If clips aren't provided at all, generate them from the prepared scene prompts.
  if (remoteClipUrls.length === 0 && (input.scenes || []).length > 0) {
    remoteClipUrls = await generateClipsFromScenes(input);
  }

  if (remoteClipUrls.length === 0) {
    throw new Error(
      "No valid clip URLs were provided (and no resolvable clipRequests were provided)."
    );
  }

  // Create temp directory
  const tmpDir = "/tmp/remotion-render";
  fs.mkdirSync(tmpDir, { recursive: true });

  // Resolve audio source:
  // 1) Use provided audio URL if available.
  // 2) Otherwise synthesize from narrationText + voiceId.
  // 3) Fallback to silent video timing from scene durations.
  const audioPath = path.join(tmpDir, "voiceover.mp3");
  let resolvedAudioSrc = "";
  let audioDuration = 0;

  if (input.audioUrl) {
    console.log("Using provided audio URL from payload.");
    await downloadToFile(input.audioUrl, audioPath);
    resolvedAudioSrc = fileToDataUri(audioPath, "audio/mpeg");
    audioDuration = await getAudioDuration(audioPath);
  } else if (input.narrationText) {
    try {
      await synthesizeVoiceoverElevenLabs(
        input.narrationText,
        input.voiceId || "GoLTMzQJAHarswiHqv3L",
        audioPath
      );
      resolvedAudioSrc = fileToDataUri(audioPath, "audio/mpeg");
      audioDuration = await getAudioDuration(audioPath);
    } catch (err) {
      console.error("Voice synthesis failed, rendering without voiceover:", err);
    }
  }

  if (!resolvedAudioSrc) {
    const sceneBasedDuration = (input.scenes || []).reduce((sum, s) => {
      const d = Number(s?.duration || 0);
      return sum + (Number.isFinite(d) && d > 0 ? d : 5);
    }, 0);
    audioDuration = Math.max(6, sceneBasedDuration || remoteClipUrls.length * 5 || 15);
    console.log(
      `No audio source available. Rendering silent video with duration ${audioDuration}s based on scene timings.`
    );
  }

  // Prefer the explicit scene timeline length (e.g. 30s for 2 x 15s).
  // Subtitles use this duration to distribute words; keep it aligned to the timeline.
  const sceneTimelineSeconds = (input.scenes || []).reduce((sum, s) => {
    const d = Number((s as any)?.duration || 0);
    return sum + (Number.isFinite(d) && d > 0 ? d : 0);
  }, 0);

  const timelineSeconds =
    sceneTimelineSeconds > 0
      ? sceneTimelineSeconds
      : (audioDuration > 0 ? audioDuration : remoteClipUrls.length * 5);

  const subtitlesSeconds =
    audioDuration > 0 ? Math.min(audioDuration, timelineSeconds) : timelineSeconds;

  // Build render props with local file paths
  const renderProps = {
    clipUrls: remoteClipUrls,
    audioUrl: resolvedAudioSrc,
    scenes: input.scenes,
    title: input.title,
    fps: 30,
    audioDurationInSeconds: subtitlesSeconds,
  };

  console.log("Bundling Remotion project...");
  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFilePath);
  const entryPoint = path.resolve(currentDir, "index.ts");
  const bundled = await bundle({
    entryPoint,
    webpackOverride: (config) => config,
  });

  console.log("Selecting composition...");
  const composition = await selectComposition({
    serveUrl: bundled,
    id: "DignitateVideo",
    inputProps: renderProps,
  });

  const outputPath = path.join(tmpDir, "output.mp4");
  console.log(`Rendering video (${composition.durationInFrames} frames)...`);

  await renderMedia({
    composition,
    serveUrl: bundled,
    codec: "h264",
    outputLocation: outputPath,
    inputProps: renderProps,
    concurrency: 2,
    onProgress: ({ progress }) => {
      if (Math.round(progress * 100) % 10 === 0) {
        console.log(`Render progress: ${Math.round(progress * 100)}%`);
      }
    },
  });

  console.log("Render complete!");

  // Upload to Supabase Storage
  const videoKey = `videos/${Date.now()}-${input.title.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.mp4`;
  const videoUrl = await uploadToSupabase(outputPath, videoKey);

  // Callback to n8n webhook
  const webhookUrl = String(process.env.N8N_WEBHOOK_URL || input.n8nWebhookUrl || "").trim();
  if (webhookUrl) {
    console.log("Sending callback to n8n...");
    const callbackResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoUrl,
        status: "success",
        title: input.title,
        chatId: input.chatId,
      }),
    });
    console.log(`Callback response: ${callbackResponse.status}`);
  }

  // Output for GitHub Actions
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `video_url=${videoUrl}\n`);
  }

  console.log(`\nDone! Video URL: ${videoUrl}`);
}

main().catch((err) => {
  console.error("Render failed:", err);

  // Send failure callback
  const rawInput = process.env.INPUT_PROPS;
  let parsedInput: RenderInput | null = null;
  try {
    parsedInput = rawInput ? parseRenderInput(rawInput) : null;
  } catch {
    parsedInput = null;
  }
  const webhookUrl = String(process.env.N8N_WEBHOOK_URL || parsedInput?.n8nWebhookUrl || "").trim();
  if (webhookUrl && parsedInput) {
    const input = parsedInput;
    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "failed",
        error: String(err),
        title: input.title,
        chatId: input.chatId,
      }),
    }).catch(() => {});
  }

  process.exit(1);
});
