// Contacts snippet projectors (block CO-2) — the spine extension seam. Registers
// how a contact/company row reads when it appears in another entity's hub. At
// alpha these project the registry label + the right type glyph; richer
// projections (a contact's status/company inline) arrive when the hub read
// carries that data. Import this module for its registration side effect.

import { registerSnippetProjector } from "../spine/snippet-projectors";
// The spine's baseline task/note/event/email projectors (DF-7) — registered
// alongside the contacts-owned contact/company ones so any hub that imports this
// module gets rich snippets for every well-known type.
import "../spine/snippet-projectors.builtin";

registerSnippetProjector("contact", (record) => ({
  title: record?.label?.trim() || "Unnamed contact",
  snippet: null,
  icon: "contact",
}));

registerSnippetProjector("company", (record) => ({
  title: record?.label?.trim() || "Unnamed company",
  snippet: null,
  icon: "company",
}));

/** Touch to force the registration side effect from a component import. */
export const contactsProjectorsReady = true;
