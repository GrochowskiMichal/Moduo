import type { ComponentType } from "react";
import { AffinityDiagramVisual } from "./affinity-diagram-visual";
import { BrainDumpVisual } from "./brain-dump-visual";
import { BuyerPersonaVisual } from "./buyer-persona-visual";
import { ConstraintIdentificationVisual } from "./constraint-identification-visual";
import { EisenhowerMatrixVisual } from "./eisenhower-matrix-visual";
import { FiveWhysVisual } from "./five-whys-visual";
import { NgtVisual } from "./ngt-visual";
import { PestelVisual } from "./pestel-visual";
import { PortersFiveVisual } from "./porters-five-visual";
import { ReverseBrainstormingVisual } from "./reverse-brainstorming-visual";
import { RiceScoringVisual } from "./rice-scoring-visual";
import { ScamperVisual } from "./scamper-visual";
import { SixThinkingHatsVisual } from "./six-thinking-hats-visual";
import { StarburstingVisual } from "./starbursting-visual";
import { SwotVisual } from "./swot-visual";
import { WhatIfVisual } from "./what-if-visual";
import type { TemplateVisualProps } from "./template-visual-props";

export const visualByTemplateId: Record<string, ComponentType<TemplateVisualProps>> = {
  swot: SwotVisual,
  "five-whys": FiveWhysVisual,
  "buyer-persona": BuyerPersonaVisual,
  scamper: ScamperVisual,
  "six-thinking-hats": SixThinkingHatsVisual,
  "porters-five": PortersFiveVisual,
  pestel: PestelVisual,
  ngt: NgtVisual,
  "constraint-identification": ConstraintIdentificationVisual,
  "what-if": WhatIfVisual,
  "reverse-brainstorming": ReverseBrainstormingVisual,
  starbursting: StarburstingVisual,
  "rice-scoring": RiceScoringVisual,
  "brain-dump": BrainDumpVisual,
  "affinity-diagram": AffinityDiagramVisual,
  "eisenhower-matrix": EisenhowerMatrixVisual,
};
