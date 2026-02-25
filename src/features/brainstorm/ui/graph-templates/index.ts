import type { BrainstormEntry } from "../../types";
import type { BrainstormTemplate } from "../../templates";
import { buildGenericTemplateVisual } from "./build-generic-template-visual";
import { buildAffinityDiagramTemplateVisual } from "./build-affinity-diagram-template-visual";
import { buildBrainDumpTemplateVisual } from "./build-brain-dump-template-visual";
import { buildBuyerPersonaTemplateVisual } from "./build-buyer-persona-template-visual";
import { buildConstraintIdentificationTemplateVisual } from "./build-constraint-identification-template-visual";
import { buildEisenhowerMatrixTemplateVisual } from "./build-eisenhower-matrix-template-visual";
import { buildFiveWhysTemplateVisual } from "./build-five-whys-template-visual";
import { buildNgtTemplateVisual } from "./build-ngt-template-visual";
import { buildPestelTemplateVisual } from "./build-pestel-template-visual";
import { buildPortersFiveTemplateVisual } from "./build-porters-five-template-visual";
import { buildReverseBrainstormingTemplateVisual } from "./build-reverse-brainstorming-template-visual";
import { buildRiceScoringTemplateVisual } from "./build-rice-scoring-template-visual";
import { buildScamperTemplateVisual } from "./build-scamper-template-visual";
import { buildSixThinkingHatsTemplateVisual } from "./build-six-thinking-hats-template-visual";
import { buildStarburstingTemplateVisual } from "./build-starbursting-template-visual";
import { buildSwotTemplateVisual } from "./build-swot-template-visual";
import { buildWhatIfTemplateVisual } from "./build-what-if-template-visual";
import type { TemplateVisualBundle } from "./types";

export function buildTemplateVisual(
  entry: BrainstormEntry,
  index: number,
  template: BrainstormTemplate | undefined
): TemplateVisualBundle {
  switch (entry.templateId) {
    case "swot":
      return buildSwotTemplateVisual(entry, index, template);
    case "five-whys":
      return buildFiveWhysTemplateVisual(entry, index, template);
    case "buyer-persona":
      return buildBuyerPersonaTemplateVisual(entry, index, template);
    case "scamper":
      return buildScamperTemplateVisual(entry, index, template);
    case "six-thinking-hats":
      return buildSixThinkingHatsTemplateVisual(entry, index, template);
    case "porters-five":
      return buildPortersFiveTemplateVisual(entry, index, template);
    case "pestel":
      return buildPestelTemplateVisual(entry, index, template);
    case "ngt":
      return buildNgtTemplateVisual(entry, index, template);
    case "constraint-identification":
      return buildConstraintIdentificationTemplateVisual(entry, index, template);
    case "what-if":
      return buildWhatIfTemplateVisual(entry, index, template);
    case "reverse-brainstorming":
      return buildReverseBrainstormingTemplateVisual(entry, index, template);
    case "starbursting":
      return buildStarburstingTemplateVisual(entry, index, template);
    case "rice-scoring":
      return buildRiceScoringTemplateVisual(entry, index, template);
    case "brain-dump":
      return buildBrainDumpTemplateVisual(entry, index, template);
    case "affinity-diagram":
      return buildAffinityDiagramTemplateVisual(entry, index, template);
    case "eisenhower-matrix":
      return buildEisenhowerMatrixTemplateVisual(entry, index, template);
    default:
      return buildGenericTemplateVisual(entry, index, template);
  }
}

export * from "./types";
