import type { BrainstormTemplate } from "./types";

export const swotTemplate: BrainstormTemplate = {
  id: "swot",
  name: "SWOT Analysis",
  description: "Evaluate Strengths, Weaknesses, Opportunities, and Threats for strategic planning.",
  icon: "📊",
  color: "#10b981",
  fields: [
    { key: "subject", label: "Subject / Topic", placeholder: "What are you analyzing? (product, company, project...)", multiline: false },
    { key: "strengths", label: "Strengths", placeholder: "Internal advantages and positive attributes...", multiline: true },
    { key: "weaknesses", label: "Weaknesses", placeholder: "Internal limitations and areas for improvement...", multiline: true },
    { key: "opportunities", label: "Opportunities", placeholder: "External factors you could leverage...", multiline: true },
    { key: "threats", label: "Threats", placeholder: "External risks and challenges...", multiline: true },
    { key: "action_items", label: "Action Items", placeholder: "Strategic actions based on the analysis...", multiline: true },
  ],
};
