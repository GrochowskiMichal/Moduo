import type { BrainstormTemplate } from "./types";

export const starburstingTemplate: BrainstormTemplate = {
  id: "starbursting",
  name: "Starbursting (5W1H)",
  description: "Generate comprehensive questions using Who, What, Where, When, Why, and How to explore an idea.",
  icon: "⭐",
  color: "#f43f5e",
  fields: [
    { key: "subject", label: "Subject / Idea", placeholder: "What idea, product, or initiative are you exploring?", multiline: false },
    { key: "who", label: "Who?", placeholder: "Who is involved? Who benefits? Who is the target audience?", multiline: true },
    { key: "what", label: "What?", placeholder: "What is it? What does it do? What problem does it solve?", multiline: true },
    { key: "where", label: "Where?", placeholder: "Where will it be used? Where will it be sold/deployed?", multiline: true },
    { key: "when", label: "When?", placeholder: "When will it launch? When is the best timing?", multiline: true },
    { key: "why", label: "Why?", placeholder: "Why is this needed? Why now? Why would people want this?", multiline: true },
    { key: "how", label: "How?", placeholder: "How will it work? How will it be built? How will it be marketed?", multiline: true },
    { key: "insights", label: "Key Insights", placeholder: "Most important findings from the questioning process...", multiline: true },
  ],
};
