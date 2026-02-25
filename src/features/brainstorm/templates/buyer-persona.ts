import type { BrainstormTemplate } from "./types";

export const buyerPersonaTemplate: BrainstormTemplate = {
  id: "buyer-persona",
  name: "Buyer Persona",
  description: "Build a detailed profile of your ideal customer to guide marketing and product decisions.",
  icon: "👤",
  color: "#ec4899",
  fields: [
    { key: "name", label: "Persona Name", placeholder: "Give this persona a name (e.g. 'Startup Sarah')...", multiline: false },
    { key: "demographics", label: "Demographics", placeholder: "Age, location, job title, income, education, family status...", multiline: true },
    { key: "goals", label: "Goals & Motivations", placeholder: "What are they trying to achieve? What drives them?", multiline: true },
    { key: "pain_points", label: "Pain Points & Challenges", placeholder: "What frustrates them? What obstacles do they face?", multiline: true },
    { key: "behavior", label: "Behavior Patterns", placeholder: "How do they research? Where do they spend time online?", multiline: true },
    { key: "channels", label: "Preferred Channels", placeholder: "Social media, email, forums, events, podcasts...", multiline: true },
    { key: "triggers", label: "Buying Triggers", placeholder: "What events or situations prompt a purchase decision?", multiline: true },
    { key: "objections", label: "Common Objections", placeholder: "What concerns might prevent them from buying?", multiline: true },
    { key: "how_we_help", label: "How We Help", placeholder: "How does our product/service solve their problems?", multiline: true },
  ],
};
