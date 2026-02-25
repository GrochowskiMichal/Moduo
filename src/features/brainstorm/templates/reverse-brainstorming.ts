import type { BrainstormTemplate } from "./types";

export const reverseBrainstormingTemplate: BrainstormTemplate = {
  id: "reverse-brainstorming",
  name: "Reverse Brainstorming",
  description: "Solve problems by first brainstorming ways to cause them, then reversing those ideas into solutions.",
  icon: "🔄",
  color: "#06b6d4",
  fields: [
    { key: "problem", label: "Problem to Solve", placeholder: "What problem are you trying to fix?", multiline: false },
    { key: "cause_ideas", label: "How Could We Cause This Problem?", placeholder: "Brainstorm ways to make the problem worse...", multiline: true },
    { key: "worst_ideas", label: "Ideas That Make It Worse", placeholder: "List the most impactful negative ideas...", multiline: true },
    { key: "reversed", label: "Reverse Each Idea", placeholder: "Flip each negative idea into a positive solution...", multiline: true },
    { key: "viable", label: "Viable Solutions", placeholder: "Which reversed ideas are most practical and effective?", multiline: true },
    { key: "action_plan", label: "Action Plan", placeholder: "Steps to implement the best solutions...", multiline: true },
  ],
};
