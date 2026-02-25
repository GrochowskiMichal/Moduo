import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function BrainDumpVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "grid", accent: "#60a5fa", panel: "#18283b", glow: "rgba(96,165,250,.34)" }}
    />
  );
}
