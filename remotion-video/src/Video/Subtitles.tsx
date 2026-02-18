import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { SceneData } from "./types";

interface WordEntry {
  word: string;
  startFrame: number;
  endFrame: number;
}

interface CaptionGroup {
  words: WordEntry[];
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

function normalizeWord(word: string): string {
  const w = String(word || "").trim();
  // Keep punctuation, but avoid rendering weird whitespace/newlines.
  return w.replace(/\s+/g, " ");
}

function estimateLineLen(words: string[]): number {
  // Roughly count visible chars. It's not perfect, but good enough for chunking.
  return words.join(" ").replace(/\s+/g, " ").trim().length;
}

function buildCaptionGroups(
  timeline: WordEntry[],
  opts: { maxWords: number; maxChars: number }
): CaptionGroup[] {
  const maxWords = Math.max(1, Math.floor(opts.maxWords));
  const maxChars = Math.max(10, Math.floor(opts.maxChars));

  const groups: CaptionGroup[] = [];
  let cur: WordEntry[] = [];

  const flush = () => {
    if (!cur.length) return;
    groups.push({
      words: cur,
      startFrame: cur[0].startFrame,
      endFrame: cur[cur.length - 1].endFrame,
    });
    cur = [];
  };

  for (const entry of timeline) {
    const word = normalizeWord(entry.word);
    const testWords = [...cur.map((w) => normalizeWord(w.word)), word];
    const wouldExceedWords = cur.length + 1 > maxWords;
    const wouldExceedChars = estimateLineLen(testWords) > maxChars;

    if (cur.length && (wouldExceedWords || wouldExceedChars)) {
      flush();
    }

    cur.push({ ...entry, word });

    const strongPause = /[.!?]$/.test(word);
    const softPause = /[,;:]$/.test(word);

    // Prefer cutting on punctuation so captions feel phrase-based.
    if (strongPause) {
      flush();
      continue;
    }
    if (softPause && cur.length >= Math.max(3, Math.floor(maxWords * 0.6))) {
      flush();
      continue;
    }
  }
  flush();

  return groups;
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

  const groups = useMemo(() => {
    // TikTok-style: short, punchy chunks.
    return buildCaptionGroups(timeline, { maxWords: 6, maxChars: 28 });
  }, [timeline]);

  // Find current word index
  let currentWordIndex = timeline.findIndex(
    (w) => frame >= w.startFrame && frame < w.endFrame
  );

  // If between words or past end, find closest
  if (currentWordIndex === -1) {
    currentWordIndex = timeline.findIndex((w) => frame < w.endFrame);
    if (currentWordIndex === -1) currentWordIndex = timeline.length - 1;
  }

  // Find active group
  let groupIndex = groups.findIndex(
    (g) => frame >= g.startFrame && frame < g.endFrame
  );
  if (groupIndex === -1) {
    // Fallback: choose the next group that ends after now.
    groupIndex = groups.findIndex((g) => frame < g.endFrame);
    if (groupIndex === -1) groupIndex = Math.max(0, groups.length - 1);
  }

  const activeGroup = groups[groupIndex] || { words: [], startFrame: 0, endFrame: 1 };
  const visibleWords = activeGroup.words;

  let activeWordInGroup = visibleWords.findIndex(
    (w) => frame >= w.startFrame && frame < w.endFrame
  );
  if (activeWordInGroup === -1) {
    activeWordInGroup = visibleWords.findIndex((w) => frame < w.endFrame);
    if (activeWordInGroup === -1) activeWordInGroup = Math.max(0, visibleWords.length - 1);
  }

  // Fade in the entire subtitle block
  const blockOpacity = interpolate(frame, [0, 10], [0, 1], {
    extrapolateRight: "clamp",
  });

  const fontFamily =
    '"Montserrat", "Arial Black", Impact, system-ui, -apple-system, sans-serif';

  // Classic TikTok/Shorts caption treatment: white fill with a thick black stroke.
  // Chrome (Remotion renderer) supports WebkitTextStroke.
  const strokeColor = "rgba(0,0,0,0.95)";
  const baseShadow = "0 6px 18px rgba(0,0,0,0.55)";
  const highlight = "#14b8a6";

  return (
    <AbsoluteFill
      style={{
        justifyContent: "flex-end",
        alignItems: "center",
        padding: "0 80px 190px 80px",
        opacity: blockOpacity,
      }}
    >
      <div style={{ width: "100%", maxWidth: 980, textAlign: "center" }}>
        {visibleWords.map((w, i) => {
          const isActive = i === activeWordInGroup;
          const isPast = i < activeWordInGroup;

          const pop = isActive
            ? interpolate(
                frame,
                [w.startFrame, w.startFrame + 4, w.endFrame],
                [1, 1.12, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              )
            : 1;

          return (
            <span
              key={`${groupIndex}-${i}-${w.startFrame}`}
              style={{
                fontFamily,
                fontWeight: 900,
                fontSize: 78,
                letterSpacing: "-1px",
                lineHeight: 1.05,
                textTransform: "uppercase",
                color: isActive ? highlight : "#ffffff",
                WebkitTextStrokeWidth: 12,
                WebkitTextStrokeColor: strokeColor,
                textShadow: baseShadow,
                margin: "0 10px",
                display: "inline-block",
                transform: `translateY(${isActive ? -2 : 0}px) scale(${pop})`,
                opacity: isPast ? 0.98 : 1,
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
