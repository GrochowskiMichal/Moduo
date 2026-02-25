import type { BrainstormTemplate } from "./types";
import { ngtTemplate } from "./ngt";
import { fiveWhysTemplate } from "./five-whys";
import { swotTemplate } from "./swot";
import { portersFiveTemplate } from "./porters-five";
import { pestelTemplate } from "./pestel";
import { buyerPersonaTemplate } from "./buyer-persona";
import { scamperTemplate } from "./scamper";
import { sixThinkingHatsTemplate } from "./six-thinking-hats";
import { constraintIdentificationTemplate } from "./constraint-identification";
import { whatIfTemplate } from "./what-if";
import { reverseBrainstormingTemplate } from "./reverse-brainstorming";
import { starburstingTemplate } from "./starbursting";
import { riceScoringTemplate } from "./rice-scoring";
import { brainDumpTemplate } from "./brain-dump";
import { affinityDiagramTemplate } from "./affinity-diagram";
import { eisenhowerMatrixTemplate } from "./eisenhower-matrix";

export const allTemplates: BrainstormTemplate[] = [
  swotTemplate,
  fiveWhysTemplate,
  buyerPersonaTemplate,
  scamperTemplate,
  sixThinkingHatsTemplate,
  portersFiveTemplate,
  pestelTemplate,
  ngtTemplate,
  constraintIdentificationTemplate,
  whatIfTemplate,
  reverseBrainstormingTemplate,
  starburstingTemplate,
  riceScoringTemplate,
  brainDumpTemplate,
  affinityDiagramTemplate,
  eisenhowerMatrixTemplate,
];

export const templateById = new Map<string, BrainstormTemplate>(
  allTemplates.map((t) => [t.id, t])
);

export type { BrainstormTemplate } from "./types";
