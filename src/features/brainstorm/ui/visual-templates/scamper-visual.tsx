import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function ScamperVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "orbit", accent: "#ff8b5f", panel: "#2d1f1a", glow: "rgba(255,139,95,.32)" }}
    />
  );
}
