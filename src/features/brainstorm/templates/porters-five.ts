import type { BrainstormTemplate } from "./types";

export const portersFiveTemplate: BrainstormTemplate = {
  id: "porters-five",
  name: "Porter's 5 Forces",
  description: "Analyze the competitive forces shaping an industry to understand profitability and strategy.",
  icon: "⚔️",
  color: "#ef4444",
  fields: [
    { key: "industry", label: "Industry / Market", placeholder: "Which industry or market are you analyzing?", multiline: false },
    { key: "new_entrants", label: "Threat of New Entrants", placeholder: "Barriers to entry, capital requirements, brand loyalty...", multiline: true },
    { key: "supplier_power", label: "Bargaining Power of Suppliers", placeholder: "Supplier concentration, switching costs, substitute inputs...", multiline: true },
    { key: "buyer_power", label: "Bargaining Power of Buyers", placeholder: "Buyer volume, price sensitivity, switching costs...", multiline: true },
    { key: "substitutes", label: "Threat of Substitutes", placeholder: "Alternative products, price-performance trade-offs...", multiline: true },
    { key: "rivalry", label: "Competitive Rivalry", placeholder: "Number of competitors, industry growth, differentiation...", multiline: true },
    { key: "implications", label: "Strategic Implications", placeholder: "Key takeaways and strategic positioning...", multiline: true },
  ],
};
