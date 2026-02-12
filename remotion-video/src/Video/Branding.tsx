import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame, interpolate } from "remotion";

export const Branding: React.FC = () => {
  const frame = useCurrentFrame();

  // Fade in branding over first 15 frames
  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Top teal accent bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          backgroundColor: "#14b8a6",
        }}
      />

      {/* Logo watermark - top right */}
      <div
        style={{
          position: "absolute",
          top: 40,
          right: 40,
          opacity: 0.6,
        }}
      >
        <Img
          src={staticFile("dignitate-logo.png")}
          style={{
            width: 80,
            height: 80,
            objectFit: "contain",
          }}
          onError={() => {
            // Logo file not found - silently skip
          }}
        />
      </div>

      {/* Bottom teal accent bar */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 4,
          backgroundColor: "#14b8a6",
        }}
      />
    </AbsoluteFill>
  );
};
