import type { BrainstormTemplate } from "../../templates";
import type { BrainstormEntry } from "../../types";

export type TemplateVisualProps = {
  template: BrainstormTemplate;
  entry: BrainstormEntry;
  onUpdateName: (value: string) => void;
  onUpdateField: (key: string, value: string) => void;
};

export type TemplateVisualStyle = {
  mode: "orbit" | "grid" | "steps";
  accent: string;
  panel: string;
  glow: string;
};
