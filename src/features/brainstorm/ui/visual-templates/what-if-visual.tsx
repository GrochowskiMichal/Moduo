import { FrameworkPoster } from "./framework-poster";
import type { TemplateVisualProps } from "./template-visual-props";

export function WhatIfVisual(props: TemplateVisualProps) {
  return (
    <FrameworkPoster
      {...props}
      style={{ mode: "orbit", accent: "#fb7185", panel: "#311c23", glow: "rgba(251,113,133,.32)" }}
    />
  );
}
