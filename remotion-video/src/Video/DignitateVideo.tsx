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

  // Calculate frames per clip based on total duration and number of clips
  const numClips = Math.max(clipUrls.length, scenes.length, 1);
  const framesPerClip = Math.floor(durationInFrames / numClips);

  return (
    <AbsoluteFill style={{ backgroundColor: "#1a1a2e" }}>
      {/* Layer 1: Video clips in sequence */}
      {scenes.map((scene, i) => {
        const clipUrl = clipUrls[i] || clipUrls[clipUrls.length - 1] || "";
        const from = i * framesPerClip;
        const duration =
          i === numClips - 1
            ? durationInFrames - from // Last clip gets remaining frames
            : framesPerClip;

        return (
          <Sequence
            key={`scene-${i}`}
            from={from}
            durationInFrames={duration}
            name={`${scene.type}: ${scene.narration.substring(0, 30)}...`}
          >
            <Scene clipUrl={clipUrl} />
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
