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

  const totalChars = allWords.reduce((sum, w) => sum + w.length, 0);
  let currentTime = 0;

  return allWords.map((word) => {
    const wordDuration = (word.length / totalChars) * totalDurationSec;
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
        paddingBottom: 200,
        opacity: blockOpacity,
      }}
    >
      <div
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.55)",
          borderRadius: 16,
          padding: "18px 28px",
          maxWidth: "90%",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "6px 10px",
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
                fontSize: isActive ? 52 : 46,
                color: isActive
                  ? "#14b8a6"
                  : isPast
                    ? "rgba(255, 255, 255, 0.6)"
                    : "#ffffff",
                textShadow: "2px 2px 6px rgba(0, 0, 0, 0.9)",
                transform: isActive ? "scale(1.08)" : "scale(1)",
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
