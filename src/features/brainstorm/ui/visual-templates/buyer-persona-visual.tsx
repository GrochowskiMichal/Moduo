import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function BuyerPersonaVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "grid", accent: "#5aa7ff", panel: "#1a2636", glow: "rgba(90,167,255,.32)" }}
    />
  );
}
