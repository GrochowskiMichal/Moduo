import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function RiceScoringVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "steps", accent: "#2dd4bf", panel: "#19302d", glow: "rgba(45,212,191,.34)" }}
    />
  );
}
