import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function StarburstingVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "orbit", accent: "#f97316", panel: "#2f2117", glow: "rgba(249,115,22,.34)" }}
    />
  );
}
