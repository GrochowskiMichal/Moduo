import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function ReverseBrainstormingVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "grid", accent: "#a78bfa", panel: "#221f34", glow: "rgba(167,139,250,.34)" }}
    />
  );
}
