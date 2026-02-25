import type { BrainstormTemplate } from "./types";

export const fiveWhysTemplate: BrainstormTemplate = {
  id: "five-whys",
  name: "The 5 Whys",
  description: "Iterative root-cause analysis by asking 'why' five times to drill down to the core issue.",
  icon: "🔍",
  color: "#f59e0b",
  fields: [
    { key: "problem", label: "Problem Statement", placeholder: "Clearly define the problem you're investigating...", multiline: false },
    { key: "why1", label: "Why 1", placeholder: "Why is this happening?", multiline: true },
    { key: "why2", label: "Why 2", placeholder: "Why is that?", multiline: true },
    { key: "why3", label: "Why 3", placeholder: "And why is that?", multiline: true },
    { key: "why4", label: "Why 4", placeholder: "Why does that occur?", multiline: true },
    { key: "why5", label: "Why 5", placeholder: "What is the underlying reason?", multiline: true },
    { key: "root_cause", label: "Root Cause", placeholder: "The fundamental cause identified...", multiline: true },
    { key: "action_plan", label: "Action Plan", placeholder: "Steps to address the root cause...", multiline: true },
  ],
};
