/**
 * The Notes slash grammar (Wave-3 NO-4, AC5) — the designer-ratified final
 * set (DESIGN_BRIEF §3c). Pure registry + filter so the grammar is
 * unit-testable; execution lives in the slash-menu plugin.
 *
 * `/toggle` and `/embed-task` are gone. `/mindmap` (renamed from
 * `/embed-mindmap`) is deliberately demoted to the last group. Command names
 * are labels — cheap to rename later; keyword aliases keep discovery
 * forgiving (`child`/`subpage` → /page, `check`/`checkbox` → /todo).
 */

export type SlashCommandId =
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "number"
  | "todo"
  | "quote"
  | "code"
  | "divider"
  | "table"
  | "page"
  | "note"
  | "task"
  | "contact"
  | "company"
  | "event"
  | "mindmap";

export type SlashCommandGroup = "Basics" | "Insert" | "Embeds";

export type SlashCommandDef = {
  id: SlashCommandId;
  title: string;
  description: string;
  keywords: string[];
  group: SlashCommandGroup;
};

export const SLASH_COMMANDS: readonly SlashCommandDef[] = [
  // ── Basics ──────────────────────────────────────────────────────────────────
  { id: "text", title: "Text", description: "Plain paragraph", keywords: ["paragraph", "plain", "p"], group: "Basics" },
  { id: "h1", title: "Heading 1", description: "Big section heading", keywords: ["heading", "title", "h1"], group: "Basics" },
  { id: "h2", title: "Heading 2", description: "Medium heading", keywords: ["heading", "subtitle", "h2"], group: "Basics" },
  { id: "h3", title: "Heading 3", description: "Small heading", keywords: ["heading", "h3"], group: "Basics" },
  { id: "bullet", title: "Bulleted list", description: "Simple list", keywords: ["list", "unordered", "ul"], group: "Basics" },
  { id: "number", title: "Numbered list", description: "Ordered list", keywords: ["list", "ordered", "ol"], group: "Basics" },
  { id: "todo", title: "Checkbox", description: "A humble checkbox — never a task", keywords: ["check", "checkbox", "checklist", "to-do"], group: "Basics" },
  { id: "quote", title: "Quote", description: "Pull quote", keywords: ["blockquote", "citation"], group: "Basics" },
  { id: "code", title: "Code block", description: "Monospaced block", keywords: ["codeblock", "snippet", "pre"], group: "Basics" },
  { id: "divider", title: "Divider", description: "Horizontal rule", keywords: ["hr", "rule", "line", "separator"], group: "Basics" },
  { id: "table", title: "Table", description: "Simple table", keywords: ["grid", "rows", "columns"], group: "Basics" },
  // ── Insert (entities — a noun inserts that entity) ──────────────────────────
  { id: "page", title: "Page", description: "New child note, right here", keywords: ["child", "subpage", "subnote", "new"], group: "Insert" },
  { id: "note", title: "Note", description: "Link an existing note", keywords: ["ref", "reference", "link"], group: "Insert" },
  { id: "task", title: "Task", description: "Task line — create or link a real task", keywords: ["todo-task", "work"], group: "Insert" },
  { id: "contact", title: "Contact", description: "Attach a person's card", keywords: ["person", "people", "crm"], group: "Insert" },
  { id: "company", title: "Company", description: "Attach a company", keywords: ["org", "organization", "business"], group: "Insert" },
  { id: "event", title: "Event", description: "Reference a calendar event", keywords: ["calendar", "meeting"], group: "Insert" },
  // ── Embeds (demoted; kept working, no new investment) ───────────────────────
  { id: "mindmap", title: "Mindmap", description: "Embed a mindmap", keywords: ["embed", "canvas", "map"], group: "Embeds" },
] as const;

/** Case-insensitive filter over title + keywords. Empty query → the full
 * menu in registry order. Title-prefix matches rank before keyword ones. */
export function filterSlashCommands(query: string): SlashCommandDef[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...SLASH_COMMANDS];
  const titleHits: SlashCommandDef[] = [];
  const keywordHits: SlashCommandDef[] = [];
  for (const cmd of SLASH_COMMANDS) {
    const title = cmd.title.toLowerCase();
    if (title.startsWith(q) || cmd.id.startsWith(q)) {
      titleHits.push(cmd);
    } else if (
      title.includes(q) ||
      cmd.keywords.some((k) => k.startsWith(q)) ||
      cmd.description.toLowerCase().includes(q)
    ) {
      keywordHits.push(cmd);
    }
  }
  return [...titleHits, ...keywordHits];
}
