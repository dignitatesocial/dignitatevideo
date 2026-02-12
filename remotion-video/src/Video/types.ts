export interface SceneData {
  narration: string;
  visualPrompt: string;
  type: "hook" | "scene" | "cta";
  duration: number;
  index: number;
}

export interface VideoInputProps {
  clipUrls: string[];
  audioUrl: string;
  scenes: SceneData[];
  title: string;
  fps: number;
  audioDurationInSeconds: number;
}
