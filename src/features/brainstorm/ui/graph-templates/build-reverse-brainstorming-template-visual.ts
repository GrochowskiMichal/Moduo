import type { BrainstormEntry } from "../../types";
import type { BrainstormTemplate } from "../../templates";
import { buildGenericTemplateVisual } from "./build-generic-template-visual";
import type { TemplateVisualBundle } from "./types";

export function buildReverseBrainstormingTemplateVisual(
  entry: BrainstormEntry,
  index: number,
  template: BrainstormTemplate | undefined
): TemplateVisualBundle {
  return buildGenericTemplateVisual(entry, index, template);
}
