import type { BrainstormTemplate } from "./types";

export const constraintIdentificationTemplate: BrainstormTemplate = {
  id: "constraint-identification",
  name: "Constraint Identification",
  description: "Systematically identify and plan around project constraints across key dimensions.",
  icon: "🚧",
  color: "#eab308",
  fields: [
    { key: "goal", label: "Project / Goal", placeholder: "What project or goal are you scoping?", multiline: false },
    { key: "time", label: "Time Constraints", placeholder: "Deadlines, milestones, schedule dependencies...", multiline: true },
    { key: "budget", label: "Budget Constraints", placeholder: "Financial limits, cost drivers, funding gaps...", multiline: true },
    { key: "resources", label: "Resource Constraints", placeholder: "Team size, skill gaps, tool limitations...", multiline: true },
    { key: "technical", label: "Technical Constraints", placeholder: "Technology limits, legacy systems, scalability...", multiline: true },
    { key: "regulatory", label: "Regulatory Constraints", placeholder: "Compliance, legal requirements, industry standards...", multiline: true },
    { key: "other", label: "Other Constraints", placeholder: "Organizational, political, cultural, geographic...", multiline: true },
    { key: "mitigation", label: "Mitigation Strategies", placeholder: "How will you work within or around these constraints?", multiline: true },
    { key: "priorities", label: "Priority Actions", placeholder: "Most critical constraints to address first...", multiline: true },
  ],
};
