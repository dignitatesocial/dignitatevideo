import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  Img,
} from "remotion";

interface SceneProps {
  clipUrl: string;
}

export const Scene: React.FC<SceneProps> = ({ clipUrl }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const FADE_FRAMES = 6; // 0.2s at 30fps

  const opacity = interpolate(
    frame,
    [0, FADE_FRAMES, durationInFrames - FADE_FRAMES, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // If no clip URL, show a dark background (fallback)
  if (!clipUrl) {
    return (
      <AbsoluteFill
        style={{ backgroundColor: "#1a1a2e", opacity }}
      />
    );
  }

  return (
    <AbsoluteFill style={{ opacity }}>
      <OffthreadVideo
        src={clipUrl}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
        }}
        muted
      />
    </AbsoluteFill>
  );
};
