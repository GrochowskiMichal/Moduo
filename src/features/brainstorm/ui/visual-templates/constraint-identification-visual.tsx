import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function ConstraintIdentificationVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "orbit", accent: "#facc15", panel: "#2f2a16", glow: "rgba(250,204,21,.32)" }}
    />
  );
}
