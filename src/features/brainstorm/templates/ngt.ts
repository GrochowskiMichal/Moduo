import type { BrainstormTemplate } from "./types";

export const ngtTemplate: BrainstormTemplate = {
  id: "ngt",
  name: "Nominal Group Technique",
  description: "Structured group decision-making with silent idea generation, round-robin sharing, and ranked voting.",
  icon: "🗳️",
  color: "#6366f1",
  fields: [
    { key: "question", label: "Central Question", placeholder: "What problem or topic are we addressing?", multiline: false },
    { key: "individual_ideas", label: "Individual Ideas", placeholder: "List all ideas generated silently by participants...", multiline: true },
    { key: "discussion", label: "Discussion & Clarification", placeholder: "Notes from the round-robin discussion...", multiline: true },
    { key: "voting", label: "Voting & Ranking", placeholder: "Record votes and rankings for each idea...", multiline: true },
    { key: "final_list", label: "Final Prioritized List", placeholder: "Top ideas after voting...", multiline: true },
    { key: "action_items", label: "Action Items", placeholder: "Next steps based on the prioritized ideas...", multiline: true },
  ],
};
