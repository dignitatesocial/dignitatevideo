import React from "react";
import {
  AbsoluteFill,
  OffthreadVideo,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";

interface SceneProps {
  clipUrl: string;
  sceneIndex?: number;
}

export const Scene: React.FC<SceneProps> = ({ clipUrl, sceneIndex = 0 }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const FADE_FRAMES = 6; // 0.2s at 30fps

  const t = durationInFrames <= 1 ? 0 : frame / (durationInFrames - 1);

  const opacity = interpolate(
    frame,
    [0, FADE_FRAMES, durationInFrames - FADE_FRAMES, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Gentle documentary "Ken Burns" motion.
  // Start slightly more zoomed-in to aggressively crop any embedded black bars
  // that sometimes come back from gen video models.
  const zoom = interpolate(t, [0, 1], [1.18, 1.26]);
  const panX = interpolate(
    t,
    [0, 1],
    sceneIndex % 2 === 0 ? [-18, 18] : [18, -18]
  );
  const panY = interpolate(t, [0, 1], [10, -10]);

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
      {/* Layer 1: blurred full-bleed background to avoid any letterboxing-looking areas */}
      <OffthreadVideo
        src={clipUrl}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          filter: "blur(28px) saturate(1.15) contrast(1.05)",
          transform: "scale(1.2)",
          transformOrigin: "50% 50%",
          opacity: 0.85,
        }}
        muted
      />

      {/* Layer 2: main clip, full-bleed cover + motion */}
      <OffthreadVideo
        src={clipUrl}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transformOrigin: "50% 50%",
          transform: `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`,
        }}
        muted
      />

      {/* Layer 3: subtle vignette + top/bottom readability gradients */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0.00) 40%, rgba(0,0,0,0.45) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.00) 22%)",
          mixBlendMode: "multiply",
          opacity: 0.85,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.00) 34%)",
          mixBlendMode: "multiply",
          opacity: 0.95,
        }}
      />
    </AbsoluteFill>
  );
};
