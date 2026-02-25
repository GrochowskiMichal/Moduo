import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function FiveWhysVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "steps", accent: "#f5b940", panel: "#2c2617", glow: "rgba(245,185,64,.32)" }}
    />
  );
}
