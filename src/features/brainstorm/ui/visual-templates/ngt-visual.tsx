import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function NgtVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "steps", accent: "#4ade80", panel: "#1a2b22", glow: "rgba(74,222,128,.32)" }}
    />
  );
}
