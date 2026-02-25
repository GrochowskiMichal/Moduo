import type { BrainstormTemplate } from "./types";

export const pestelTemplate: BrainstormTemplate = {
  id: "pestel",
  name: "PESTEL Analysis",
  description: "Macro-environmental analysis across Political, Economic, Social, Technological, Environmental, and Legal factors.",
  icon: "🌍",
  color: "#8b5cf6",
  fields: [
    { key: "context", label: "Subject / Context", placeholder: "What decision or strategy is this analysis supporting?", multiline: false },
    { key: "political", label: "Political Factors", placeholder: "Government policy, regulations, trade restrictions, political stability...", multiline: true },
    { key: "economic", label: "Economic Factors", placeholder: "Growth rates, inflation, exchange rates, disposable income...", multiline: true },
    { key: "social", label: "Social Factors", placeholder: "Demographics, cultural trends, lifestyle changes, education...", multiline: true },
    { key: "technological", label: "Technological Factors", placeholder: "Innovation, automation, R&D activity, tech infrastructure...", multiline: true },
    { key: "environmental", label: "Environmental Factors", placeholder: "Climate, sustainability, waste management, ecological regulations...", multiline: true },
    { key: "legal", label: "Legal Factors", placeholder: "Employment law, consumer protection, health & safety, IP...", multiline: true },
    { key: "insights", label: "Key Insights", placeholder: "Most impactful factors and recommended actions...", multiline: true },
  ],
};
