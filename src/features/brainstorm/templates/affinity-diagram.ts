import type { BrainstormTemplate } from "./types";

export const affinityDiagramTemplate: BrainstormTemplate = {
  id: "affinity-diagram",
  name: "Affinity Diagram",
  description: "Organize large amounts of data or ideas into natural groupings to find patterns and insights.",
  icon: "🗂️",
  color: "#84cc16",
  fields: [
    { key: "question", label: "Research Question", placeholder: "What question or problem are you organizing data around?", multiline: false },
    { key: "raw_data", label: "Raw Data / Observations", placeholder: "All individual data points, observations, or sticky notes...", multiline: true },
    { key: "group1", label: "Group 1", placeholder: "Theme name + grouped items...", multiline: true },
    { key: "group2", label: "Group 2", placeholder: "Theme name + grouped items...", multiline: true },
    { key: "group3", label: "Group 3", placeholder: "Theme name + grouped items...", multiline: true },
    { key: "group4", label: "Group 4", placeholder: "Theme name + grouped items...", multiline: true },
    { key: "conclusions", label: "Insights & Conclusions", placeholder: "What patterns emerged? What actions do the groups suggest?", multiline: true },
  ],
};
