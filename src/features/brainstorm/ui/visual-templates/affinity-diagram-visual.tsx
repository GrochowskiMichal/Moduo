import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function AffinityDiagramVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "grid", accent: "#34d399", panel: "#192f2a", glow: "rgba(52,211,153,.34)" }}
    />
  );
}
