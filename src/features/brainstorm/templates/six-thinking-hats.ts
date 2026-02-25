import type { BrainstormTemplate } from "./types";

export const sixThinkingHatsTemplate: BrainstormTemplate = {
  id: "six-thinking-hats",
  name: "Six Thinking Hats",
  description: "De Bono's method for exploring decisions from six distinct perspectives for balanced thinking.",
  icon: "🎩",
  color: "#14b8a6",
  fields: [
    { key: "topic", label: "Topic / Decision", placeholder: "What decision or topic are you exploring?", multiline: false },
    { key: "white", label: "White Hat — Facts & Information", placeholder: "What data and facts do we have? What information is missing?", multiline: true },
    { key: "red", label: "Red Hat — Feelings & Intuition", placeholder: "What are your gut reactions? How do people feel about this?", multiline: true },
    { key: "black", label: "Black Hat — Caution & Risks", placeholder: "What could go wrong? What are the dangers and weaknesses?", multiline: true },
    { key: "yellow", label: "Yellow Hat — Benefits & Optimism", placeholder: "What are the advantages? Why could this work?", multiline: true },
    { key: "green", label: "Green Hat — Creativity & Alternatives", placeholder: "What are creative solutions? What new ideas emerge?", multiline: true },
    { key: "blue", label: "Blue Hat — Process & Summary", placeholder: "What is the overall picture? What are the next steps?", multiline: true },
    { key: "conclusion", label: "Decision / Conclusion", placeholder: "Final decision or recommendation based on all perspectives...", multiline: true },
  ],
};
