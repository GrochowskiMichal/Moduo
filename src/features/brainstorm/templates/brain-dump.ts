import type { BrainstormTemplate } from "./types";

export const brainDumpTemplate: BrainstormTemplate = {
  id: "brain-dump",
  name: "Brain Dump",
  description: "Free-form idea capture followed by pattern recognition and prioritization.",
  icon: "🧠",
  color: "#d946ef",
  fields: [
    { key: "topic", label: "Topic / Focus Area", placeholder: "What area or challenge are you dumping ideas about?", multiline: false },
    { key: "raw_ideas", label: "Raw Ideas & Thoughts", placeholder: "Write everything that comes to mind, no filtering...", multiline: true },
    { key: "patterns", label: "Patterns & Themes", placeholder: "What clusters or themes emerge from the ideas above?", multiline: true },
    { key: "priorities", label: "Priority Items", placeholder: "Which ideas feel most important or actionable?", multiline: true },
    { key: "next_steps", label: "Next Steps", placeholder: "Immediate actions to take based on this dump...", multiline: true },
  ],
};
