import type { BrainstormTemplate } from "./types";

export const riceScoringTemplate: BrainstormTemplate = {
  id: "rice-scoring",
  name: "RICE Scoring",
  description: "Prioritize features or initiatives by evaluating Reach, Impact, Confidence, and Effort.",
  icon: "📐",
  color: "#0ea5e9",
  fields: [
    { key: "initiative", label: "Feature / Initiative", placeholder: "What are you evaluating for prioritization?", multiline: false },
    { key: "reach", label: "Reach", placeholder: "How many users/customers will this affect in a given period?", multiline: true },
    { key: "impact", label: "Impact", placeholder: "How much will this impact each user? (Massive / High / Medium / Low / Minimal)", multiline: true },
    { key: "confidence", label: "Confidence", placeholder: "How confident are you in these estimates? (High / Medium / Low)", multiline: true },
    { key: "effort", label: "Effort", placeholder: "How much work is required? (person-months, story points...)", multiline: true },
    { key: "score_notes", label: "RICE Score & Notes", placeholder: "Calculate: (Reach x Impact x Confidence) / Effort. Notes on the result...", multiline: true },
    { key: "decision", label: "Decision", placeholder: "Prioritize, defer, or drop? Reasoning...", multiline: true },
  ],
};
