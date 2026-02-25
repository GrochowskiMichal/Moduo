import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function PestelVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "grid", accent: "#c084fc", panel: "#261d34", glow: "rgba(192,132,252,.34)" }}
    />
  );
}
