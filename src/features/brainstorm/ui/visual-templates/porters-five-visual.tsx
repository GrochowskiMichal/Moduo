import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function PortersFiveVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "steps", accent: "#22d3ee", panel: "#172a2f", glow: "rgba(34,211,238,.32)" }}
    />
  );
}
