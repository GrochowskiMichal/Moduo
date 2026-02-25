import type { BrainstormTemplate } from "./types";

export const whatIfTemplate: BrainstormTemplate = {
  id: "what-if",
  name: "What If Analysis",
  description: "Explore hypothetical scenarios to uncover opportunities, risks, and contingency plans.",
  icon: "🔮",
  color: "#a855f7",
  fields: [
    { key: "scenario", label: "Scenario Title", placeholder: "Give this scenario a descriptive name...", multiline: false },
    { key: "what_if", label: "What If...", placeholder: "Describe the hypothetical situation in detail...", multiline: true },
    { key: "outcomes", label: "Potential Outcomes", placeholder: "What would likely happen as a result?", multiline: true },
    { key: "opportunities", label: "Opportunities Created", placeholder: "What new possibilities would this open up?", multiline: true },
    { key: "risks", label: "Risks Introduced", placeholder: "What dangers or downsides would emerge?", multiline: true },
    { key: "impact", label: "Impact Assessment", placeholder: "How significant is this scenario? Who would be affected?", multiline: true },
    { key: "preparation", label: "Preparation Steps", placeholder: "What can we do now to prepare for or prevent this?", multiline: true },
  ],
};
