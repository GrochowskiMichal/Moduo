import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function SixThinkingHatsVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "grid", accent: "#f87171", panel: "#2a1d22", glow: "rgba(248,113,113,.32)" }}
    />
  );
}
