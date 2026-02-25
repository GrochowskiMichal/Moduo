import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function EisenhowerMatrixVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "grid", accent: "#f59e0b", panel: "#302413", glow: "rgba(245,158,11,.34)" }}
    />
  );
}
