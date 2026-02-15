import React from "react";
import {
  AbsoluteFill,
  Audio,
  Sequence,
  useVideoConfig,
} from "remotion";
import { VideoInputProps } from "./types";
import { Scene } from "./Scene";
import { Subtitles } from "./Subtitles";
import { Branding } from "./Branding";

export const DignitateVideo: React.FC<VideoInputProps> = ({
  clipUrls,
  audioUrl,
  scenes,
  audioDurationInSeconds,
  fps,
}) => {
  const { durationInFrames } = useVideoConfig();

  // Prefer explicit scene durations (in seconds) coming from n8n.
  // This keeps the video length stable (e.g. 2 x 15s = 30s) and prevents
  // stretching short AI clips to match an overestimated audio duration.
  const sceneFrames = (Array.isArray(scenes) ? scenes : []).map((s) => {
    const sec = Number((s as any)?.duration);
    const durSec = Number.isFinite(sec) && sec > 0 ? sec : 0;
    return Math.max(1, Math.round(durSec * fps));
  });

  const hasSceneDurations = sceneFrames.some((f) => f > 1);

  return (
    <AbsoluteFill style={{ backgroundColor: "#05060a" }}>
      {/* Layer 1: Video clips in sequence */}
      {scenes.map((scene, i) => {
        const clipUrl = clipUrls[i] || clipUrls[clipUrls.length - 1] || "";
        const from = hasSceneDurations
          ? sceneFrames.slice(0, i).reduce((a, b) => a + b, 0)
          : Math.floor((durationInFrames / Math.max(scenes.length, 1)) * i);

        const desired =
          hasSceneDurations && sceneFrames[i]
            ? sceneFrames[i]
            : Math.floor(durationInFrames / Math.max(scenes.length, 1));

        const duration = Math.max(
          1,
          Math.min(desired, Math.max(1, durationInFrames - from))
        );

        return (
          <Sequence
            key={`scene-${i}`}
            from={from}
            durationInFrames={duration}
            name={`${scene.type}: ${scene.narration.substring(0, 30)}...`}
          >
            <Scene clipUrl={clipUrl} sceneIndex={i} />
          </Sequence>
        );
      })}

      {/* Layer 2: Voiceover audio */}
      {audioUrl ? <Audio src={audioUrl} volume={1} /> : null}

      {/* Layer 3: Word-by-word subtitles */}
      <Subtitles
        scenes={scenes}
        audioDurationInSeconds={audioDurationInSeconds}
        fps={fps}
      />

      {/* Layer 4: Branding (logo + accent bars) */}
      <Branding />
    </AbsoluteFill>
  );
};
