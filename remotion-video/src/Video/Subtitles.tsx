import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { SceneData } from "./types";

interface WordEntry {
  word: string;
  startFrame: number;
  endFrame: number;
}

function buildWordTimeline(
  scenes: SceneData[],
  totalDurationSec: number,
  fps: number
): WordEntry[] {
  const allWords: string[] = [];
  for (const scene of scenes) {
    const words = scene.narration.split(/\s+/).filter(Boolean);
    allWords.push(...words);
  }

  if (allWords.length === 0) return [];

  // Distribute timing by (approximate) spoken rhythm, not character count.
  // Character-based timing makes long words appear too slow and short words too fast.
  // This is still an approximation (no true phoneme alignment), but feels closer to TTS pace.
  const weights = allWords.map((w) => {
    const word = String(w || "");
    const endsWithStrongPause = /[.!?]$/.test(word);
    const endsWithSoftPause = /[,;:]$/.test(word);
    const isLong = word.replace(/[^a-z0-9]/gi, "").length >= 9;
    return (
      1 +
      (endsWithSoftPause ? 0.35 : 0) +
      (endsWithStrongPause ? 0.8 : 0) +
      (isLong ? 0.15 : 0)
    );
  });

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let currentTime = 0;

  return allWords.map((word, idx) => {
    const weight = weights[idx] || 1;
    const wordDuration =
      totalWeight > 0 ? (weight / totalWeight) * totalDurationSec : 0;
    const entry: WordEntry = {
      word,
      startFrame: Math.round(currentTime * fps),
      endFrame: Math.round((currentTime + wordDuration) * fps),
    };
    currentTime += wordDuration;
    return entry;
  });
}

interface SubtitlesProps {
  scenes: SceneData[];
  audioDurationInSeconds: number;
  fps: number;
}

export const Subtitles: React.FC<SubtitlesProps> = ({
  scenes,
  audioDurationInSeconds,
  fps,
}) => {
  const frame = useCurrentFrame();

  const timeline = useMemo(
    () => buildWordTimeline(scenes, audioDurationInSeconds, fps),
    [scenes, audioDurationInSeconds, fps]
  );

  if (timeline.length === 0) return null;

  // Find current word index
  let currentWordIndex = timeline.findIndex(
    (w) => frame >= w.startFrame && frame < w.endFrame
  );

  // If between words or past end, find closest
  if (currentWordIndex === -1) {
    currentWordIndex = timeline.findIndex((w) => frame < w.endFrame);
    if (currentWordIndex === -1) currentWordIndex = timeline.length - 1;
  }

  // Show a rolling window of words
  const WINDOW_BEFORE = 3;
  const WINDOW_AFTER = 4;
  const groupStart = Math.max(0, currentWordIndex - WINDOW_BEFORE);
  const groupEnd = Math.min(timeline.length, currentWordIndex + WINDOW_AFTER + 1);
  const visibleWords = timeline.slice(groupStart, groupEnd);

  // Fade in the entire subtitle block
  const blockOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: 170,
        opacity: blockOpacity,
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.60)",
          borderRadius: 16,
          padding: "18px 28px",
          maxWidth: "90%",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "6px 10px",
          border: "1px solid rgba(20, 184, 166, 0.12)",
        }}
      >
        {visibleWords.map((w, i) => {
          const absoluteIndex = groupStart + i;
          const isActive = absoluteIndex === currentWordIndex;
          const isPast = absoluteIndex < currentWordIndex;

          return (
            <span
              key={absoluteIndex}
              style={{
                fontFamily: "Inter, sans-serif",
                fontWeight: isActive ? 800 : 600,
                fontSize: isActive ? 50 : 44,
                color: isActive
                  ? "#14b8a6"
                  : isPast
                    ? "rgba(255, 255, 255, 0.6)"
                    : "#ffffff",
                textShadow: "2px 2px 6px rgba(0, 0, 0, 0.9)",
                transform: isActive ? "scale(1.07)" : "scale(1)",
                display: "inline-block",
                lineHeight: 1.3,
              }}
            >
              {w.word}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
