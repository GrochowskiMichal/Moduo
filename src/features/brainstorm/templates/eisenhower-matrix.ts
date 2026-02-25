import type { BrainstormTemplate } from "./types";

export const eisenhowerMatrixTemplate: BrainstormTemplate = {
  id: "eisenhower-matrix",
  name: "Eisenhower Matrix",
  description: "Prioritize tasks by urgency and importance into four quadrants: Do, Schedule, Delegate, Eliminate.",
  icon: "⚡",
  color: "#0891b2",
  fields: [
    { key: "context", label: "Context / Focus Area", placeholder: "What scope of work are you prioritizing?", multiline: false },
    { key: "q1_do", label: "Q1 — Urgent & Important (Do First)", placeholder: "Critical deadlines, crises, pressing problems...", multiline: true },
    { key: "q2_schedule", label: "Q2 — Not Urgent & Important (Schedule)", placeholder: "Strategic planning, relationship building, personal growth...", multiline: true },
    { key: "q3_delegate", label: "Q3 — Urgent & Not Important (Delegate)", placeholder: "Interruptions, some meetings, certain emails...", multiline: true },
    { key: "q4_eliminate", label: "Q4 — Not Urgent & Not Important (Eliminate)", placeholder: "Time wasters, busywork, pleasant but unproductive activities...", multiline: true },
    { key: "takeaways", label: "Key Takeaways", placeholder: "What will you focus on? What will you stop doing?", multiline: true },
  ],
};
