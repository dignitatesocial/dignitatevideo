import path from "path";
import fs from "fs";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";

interface RenderInput {
  clipUrls: string[];
  audioUrl?: string;
  narrationText?: string;
  voiceId?: string;
  scenes: Array<{
    narration: string;
    visualPrompt: string;
    type: string;
    duration: number;
    index: number;
  }>;
  title: string;
  chatId: string;
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
  // Estimate duration from file size for MP3 at 128kbps
  // More accurate than nothing, and avoids needing ffprobe
  const stats = fs.statSync(filePath);
  const fileSizeBytes = stats.size;
  const bitrateKbps = 128;
  const durationSec = (fileSizeBytes * 8) / (bitrateKbps * 1000);
  console.log(
    `Audio estimated duration: ${durationSec.toFixed(1)}s (${fileSizeBytes} bytes at ${bitrateKbps}kbps)`
  );
  return durationSec;
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

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "video/mp4",
      "x-upsert": "true",
    },
    body: fileBuffer,
  });

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

  const input: RenderInput = JSON.parse(rawInput);
  console.log(`Title: ${input.title}`);
  console.log(`Clips: ${input.clipUrls.length}`);
  console.log(`Scenes: ${input.scenes.length}`);

  // Create temp directory
  const tmpDir = "/tmp/remotion-render";
  fs.mkdirSync(tmpDir, { recursive: true });

  // Download all clips
  const localClipPaths: string[] = [];
  for (let i = 0; i < input.clipUrls.length; i++) {
    const clipPath = path.join(tmpDir, `clip-${i}.mp4`);
    try {
      await downloadToFile(input.clipUrls[i], clipPath);
      localClipPaths.push(clipPath);
    } catch (err) {
      console.error(`Failed to download clip ${i}:`, err);
      // Continue with remaining clips
    }
  }

  if (localClipPaths.length === 0) {
    throw new Error("No clips could be downloaded");
  }

  // Resolve audio source:
  // 1) Use provided audio URL if available.
  // 2) Otherwise synthesize from narrationText + voiceId.
  // 3) Fallback to silent video timing from scene durations.
  const audioPath = path.join(tmpDir, "voiceover.mp3");
  let resolvedAudioPath = "";
  let audioDuration = 0;

  if (input.audioUrl) {
    console.log("Using provided audio URL from payload.");
    await downloadToFile(input.audioUrl, audioPath);
    resolvedAudioPath = audioPath;
    audioDuration = await getAudioDuration(audioPath);
  } else if (input.narrationText) {
    try {
      await synthesizeVoiceoverElevenLabs(
        input.narrationText,
        input.voiceId || "GoLTMzQJAHarswiHqv3L",
        audioPath
      );
      resolvedAudioPath = audioPath;
      audioDuration = await getAudioDuration(audioPath);
    } catch (err) {
      console.error("Voice synthesis failed, rendering without voiceover:", err);
    }
  }

  if (!resolvedAudioPath) {
    const sceneBasedDuration = (input.scenes || []).reduce((sum, s) => {
      const d = Number(s?.duration || 0);
      return sum + (Number.isFinite(d) && d > 0 ? d : 5);
    }, 0);
    audioDuration = Math.max(6, sceneBasedDuration || localClipPaths.length * 5 || 15);
    console.log(
      `No audio source available. Rendering silent video with duration ${audioDuration}s based on scene timings.`
    );
  }

  // Build render props with local file paths
  const renderProps = {
    clipUrls: localClipPaths,
    audioUrl: resolvedAudioPath,
    scenes: input.scenes,
    title: input.title,
    fps: 30,
    audioDurationInSeconds: audioDuration,
  };

  console.log("Bundling Remotion project...");
  const entryPoint = path.resolve(__dirname, "index.ts");
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
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
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
  const webhookUrl = process.env.N8N_WEBHOOK_URL;
  const rawInput = process.env.INPUT_PROPS;
  if (webhookUrl && rawInput) {
    const input = JSON.parse(rawInput);
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
