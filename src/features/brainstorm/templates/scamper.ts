import type { BrainstormTemplate } from "./types";

export const scamperTemplate: BrainstormTemplate = {
  id: "scamper",
  name: "SCAMPER",
  description: "Creative thinking technique: Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse.",
  icon: "💡",
  color: "#f97316",
  fields: [
    { key: "subject", label: "Subject / Product", placeholder: "What product, service, or process are you reimagining?", multiline: false },
    { key: "substitute", label: "Substitute", placeholder: "What components, materials, or processes can be replaced?", multiline: true },
    { key: "combine", label: "Combine", placeholder: "What ideas, features, or steps can be merged together?", multiline: true },
    { key: "adapt", label: "Adapt", placeholder: "What can be borrowed from other contexts or industries?", multiline: true },
    { key: "modify", label: "Modify / Magnify", placeholder: "What can be enlarged, emphasized, or changed in form?", multiline: true },
    { key: "put_to_use", label: "Put to Other Uses", placeholder: "How else could this be used? Who else could benefit?", multiline: true },
    { key: "eliminate", label: "Eliminate", placeholder: "What can be removed, simplified, or reduced?", multiline: true },
    { key: "reverse", label: "Reverse / Rearrange", placeholder: "What if you reversed the order, roles, or layout?", multiline: true },
    { key: "best_ideas", label: "Best Ideas", placeholder: "Most promising ideas from the exercise...", multiline: true },
  ],
};
