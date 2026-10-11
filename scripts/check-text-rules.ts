/**
 * Text rules for `lint:tw` (DS-6, tasks-v3 AC14.1; calls 40 and 46a). Two
 * guards a per-line regex can't express, plus their one-line shapes:
 *
 * 1. **Text is never rotated** (call 46a). `writing-mode` / `text-orientation`
 *    and sideways values fail anywhere. A 90° / 270° rotation (`rotate-90`,
 *    `-rotate-90`, `rotate-[90deg]`, `rotate(90deg)`) fails unless the element
 *    it sits on is an icon: an `<svg>`, a lucide import, or a tag named
 *    `…Icon` / `Chevron…` / `Arrow…` / `Caret…`. A turned chevron is a glyph;
 *    a turned label is not.
 * 2. **Small caps never carry people's words** (call 40). `Eyebrow` and the
 *    menu labels built on its recipe are for fixed chrome only. Each one whose
 *    children hold an expression (`{name}`) must be on the reviewed allowlist
 *    below, unless the expression is plainly not words (a string literal, a
 *    count, a `.length`). A group named by a person uses `GroupHeader`
 *    (sentence case). `eyebrowVariants()` outside `src/components/ui` has the
 *    same rule. `capitalize` and `font-variant` small caps fail anywhere.
 */

type TextHit = {
  line: number;
  column: number;
  pattern: string;
  match: string;
  /** The allowlist key a small-caps hit is filed under. */
  expr?: string;
};

// ── shapes ───────────────────────────────────────────────────────────────────

const ROTATION =
  /(?<![\w-])-?rotate-(?:90|270|\[-?(?:90|270)deg\])(?![\w-])|rotate\(\s*-?(?:90|270)deg\s*\)|\brotate\s*:\s*["'`]-?(?:90|270)deg/g;

const VERTICAL_TEXT =
  /\[(?:writing-mode|text-orientation):[^\]]*\]|\bwritingMode\s*:|\btextOrientation\s*:|\b(?:vertical|sideways)-(?:rl|lr)\b/g;

const SMALL_CAPS_SHAPES =
  /\[font-variant(?:-caps)?:[^\]]*\]|\bfontVariant(?:Caps)?\s*:|(?<=["'`\s])capitalize(?=["'`\s])/g;

/** Labels that wear the eyebrow recipe (small caps) on their children. */
const SMALL_CAPS_TAGS = [
  "Eyebrow",
  "DropdownMenuLabel",
  "ContextMenuLabel",
  "SelectLabel",
  "WidgetSectionLabel",
];

/** Wrappers that put one prop into small caps: checked at every call site. */
const SMALL_CAPS_PROPS: Record<string, string> = { Field: "label", CommandGroup: "heading" };

// ── the reviewed allowlist ───────────────────────────────────────────────────
//
// `file → expressions` whose small caps were checked and hold fixed chrome
// (a section name the app chose, a weekday, a kind of thing), never a name a
// person typed. Each entry excuses ONE site: list an expression twice for two
// sites, so a generic name (`label`) can't excuse the next site in the same
// file, and a test fails when a file has fewer sites than its entries. Add an
// entry only after checking where the value comes from; a user word moves to
// `GroupHeader` instead. Paths outside Tasks also sit here because DS-5's
// sweep of the other modules was retired (tasks-v3, 2026-10-10): each one is
// read again when its module is rebuilt.
const SMALL_CAPS_CHROME: Record<string, string[]> = {
  // Settings: section and nav-group names the app defines; platform names;
  // the "This device" tag.
  "src/features/settings/settings-modal.tsx": ["group.label"],
  "src/features/settings/sections/api-keys-section.tsx": ["label"],
  "src/features/settings/sections/appearance-section.tsx": ["label"],
  "src/features/settings/sections/workspace-section.tsx": ["label"],
  "src/features/settings/sections/preferences-section.tsx": ["label"],
  "src/features/settings/sections/integrations-section.tsx": ["platform"],
  "src/features/settings/appearance/picker-row.tsx": ["tag"],
  // Tasks: the timeline's month band ("October 2026"); Focus (rebuilt in
  // TV-F7) shows its phase word ("Focus", "Break") and a subtask number.
  "src/features/tasks/ui/task-timeline-view.tsx": ["m.label"],
  "src/features/tasks/ui/execute-view.tsx": ["session.phaseLabel", "done"],
  // Calendar: its Tasks groups ("Queue", "Due soon", "Backlog"), a weekday on
  // the booking page; colour names ("blue" → "Blue") in the account colour menu.
  "src/features/calendar/ui/calendar-tasks-panel.tsx": ["title"],
  "src/features/calendar/ui/calendar-rail.tsx": ["capitalize"],
  "src/features/calendar/booking/sentence-ui.tsx": ["parts.weekday"],
  // Chat: rail sections ("Starred", "Channels", "Direct messages"); the kind
  // of thing in a reference result ("project", "task").
  "src/features/chat/ui/chat-sidebar.tsx": ["label"],
  "src/features/chat/ui/composer.tsx": ["capitalize"],
  // Spine: module names and relation kinds.
  "src/features/spine/ui/entity-hub.tsx": [
    "section.label",
    "RELATION_KIND_LABELS[row.relationKind]",
  ],
  // Contacts: the A–Z index letter; linked-section names ("Tasks", "Notes").
  "src/features/contacts/ui/contact-directory.tsx": ["letter"],
  "src/features/contacts/ui/linked-sections.tsx": ["label"],
  // Dashboard: widget sizes, entity types, relation kinds, widget sections.
  "src/features/dashboard/ui/gallery-dialog.tsx": ["meta.sizes[0]"],
  "src/features/dashboard/ui/widgets/recently-linked-widget.tsx": [
    "RELATION_KIND_LABELS[item.relationKind] ?? item.relationKind",
  ],
  "src/features/dashboard/ui/widgets/pinned-widget.tsx": ["pinned.type"],
  "src/features/dashboard/ui/widgets/widget-primitives.tsx": ["children"],
  // Notes: tree sections ("Pinned", "Inbox", "Workspace", "Archive"); the
  // slash menu's command groups.
  "src/features/notes/ui/note-tree-sidebar.tsx": ["title"],
  "src/features/notes/editor/plugins/slash-menu-plugin.tsx": ["command.group"],
  // Email: date groups ("Today"), page sections, snooze picker headings.
  "src/features/email/ui/email-thread-list.tsx": ["group.label"],
  "src/features/email/ui/email-page-view.tsx": ["label"],
  "src/features/email/ui/email-snooze-picker.tsx": ["title"],
  "src/features/transactional-email/ui/email-preview.tsx": ["title"],
  // Shared: a form field's label; the command palette's kind of result; the
  // paywall's plan names and its section eyebrow.
  "src/components/ui/field.tsx": ["label"],
  "src/components/app/global-command-palette.tsx": [
    "TYPE_LABEL[record.type] ?? record.type",
    // Result groups from palette-search's fixed GROUP_DEFS ("Tasks", "Notes").
    "group.heading",
  ],
  "src/routes/pages/paywall-page.tsx": ["heading.eyebrow", "name"],
  // Stories demonstrate the recipe with sample text.
  "src/components/ui/drag-visuals.stories.tsx": ["children"],
};

/**
 * Known people's words in small caps, in modules the retired DS-5 sweep would
 * have reached (tasks-v3, 2026-10-10: guards only; each module adopts
 * `GroupHeader` when it is rebuilt). Never add a Tasks path or a new site
 * here: a test fails on either.
 */
const SMALL_CAPS_DEBT: Record<string, string[]> = {
  // A CalDAV / ICS account's own name heads its group (Settings and the
  // calendar rail: the username or server, accounts.ts).
  "src/features/settings/sections/integrations-section.tsx": ["header"],
  "src/features/calendar/ui/calendar-rail.tsx": ["group.header"],
  // The sender's address heads the row menu.
  "src/features/email/ui/email-thread-list.tsx": ["thread.fromEmail || senderText(thread)"],
  // "<Host> also asks": the host's name on the public booking page.
  "src/routes/pages/book-page.tsx": ["host"],
};

// ── helpers ──────────────────────────────────────────────────────────────────

function lineCol(content: string, index: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: index - last };
}

/** Is `index` inside a `//` or block comment line (prose, not code)? */
function inComment(content: string, index: number): boolean {
  const lineStart = content.lastIndexOf("\n", index - 1) + 1;
  const before = content.slice(lineStart, index);
  return /^\s*(?:\/\/|\*|\/\*|\{\s*\/\*)/.test(before) || /(?:^|\s)\/\/\s/.test(before);
}

/** The opening tag starting at `start`, braces and strings respected. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (ch === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/**
 * Top-level `{…}` expressions inside a run of JSX children: the text a label
 * renders, including inside nested elements, but not a nested element's
 * attributes (`<label htmlFor={id}>`).
 */
function childExpressions(children: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let quote: string | null = null;
  let inTag = false;
  for (let i = 0; i < children.length; i++) {
    const ch = children[i];
    if (quote) {
      if (ch === quote && children[i - 1] !== "\\") quote = null;
      continue;
    }
    if (depth > 0 && (ch === '"' || ch === "'" || ch === "`")) quote = ch;
    else if (inTag && depth === 0 && (ch === '"' || ch === "'")) quote = ch;
    else if (depth === 0 && ch === "<") inTag = true;
    else if (depth === 0 && inTag && ch === ">") inTag = false;
    else if (ch === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0 && !inTag) out.push(children.slice(start, i).trim());
    }
  }
  return out;
}

/** Names imported from lucide-react in this file (aliases included). */
function lucideNames(content: string): Set<string> {
  const names = new Set<string>();
  const re = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']lucide-react["']/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: regex-drain idiom
  while ((m = re.exec(content))) {
    for (const part of m[1].split(",")) {
      const alias = part.trim().split(/\s+as\s+/);
      const name = (alias[1] ?? alias[0]).trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/**
 * The JSX element whose opening tag holds `index` (a class on that element),
 * or null when `index` sits anywhere else (a `const` of classes, a child).
 */
function owningTag(content: string, index: number): string | null {
  const from = Math.max(0, index - 3000);
  const re = /<([A-Za-z][\w.]*)\b/g;
  let last: { tag: string; at: number } | null = null;
  let m: RegExpExecArray | null;
  const before = content.slice(from, index);
  // biome-ignore lint/suspicious/noAssignInExpressions: regex-drain idiom
  while ((m = re.exec(before))) last = { tag: m[1], at: from + m.index };
  if (!last) return null;
  const open = openingTag(content, last.at);
  return last.at + open.length > index ? last.tag : null;
}

function isIconTag(tag: string | null, icons: Set<string>): boolean {
  if (!tag) return false;
  return (
    tag === "svg" || icons.has(tag) || /Icon$/.test(tag) || /^(?:Chevron|Arrow|Caret)/.test(tag)
  );
}

/**
 * An expression that plainly isn't words: a literal, a count, a length, a
 * template whose holes are counts, or a choice between two such values.
 */
function isNotWords(expr: string): boolean {
  const e = expr.trim();
  if (e === "" || e.startsWith("/*")) return true;
  if (/^(["'])(?:(?!\1).)*\1$/.test(e)) return true;
  if (/^\d+$/.test(e)) return true;
  if (/\.length$/.test(e)) return true;
  // A count: the last segment is `count` / `total` or ends in `…Count` /
  // `…Total` (`openCount`, `item.count`), never a name that merely contains
  // the letters (`accountName`, `contact.country`, `discount`).
  const last = e.split(/\?\.|\./).pop() ?? "";
  if (/^(?:count|total)s?$/.test(last) || /[a-z0-9](?:Count|Total)s?$/.test(last)) return true;
  const template = /^`([^`]*)`$/.exec(e);
  if (template) {
    return [...template[1].matchAll(/\$\{([^}]*)\}/g)].every((hole) => isNotWords(hole[1]));
  }
  // cond ? a : b, both branches plainly not words (the condition isn't shown).
  const choice = /^[^?]+\?\s*((["'`])[\s\S]*?\2)\s*:\s*((["'`])[\s\S]*?\4)$/.exec(e);
  if (choice) return isNotWords(choice[1]) && isNotWords(choice[3]);
  return false;
}

const normalise = (expr: string) => expr.replace(/\s+/g, " ").trim();

/** How many sites of `expr` the allowlists excuse in `file`. */
function allowance(file: string, expr: string): number {
  const key = normalise(expr);
  const count = (list: Record<string, string[]>) =>
    (list[file] ?? []).filter((e) => e === key).length;
  return count(SMALL_CAPS_CHROME) + count(SMALL_CAPS_DEBT);
}

// ── the scan ─────────────────────────────────────────────────────────────────

/**
 * Every rotated-text and small-caps hit in one file. `useAllowlist: false`
 * reports the allowlisted sites too (the "allowlists stay honest" test).
 */
function scanTextRules(
  content: string,
  file: string,
  { useAllowlist = true }: { useAllowlist?: boolean } = {},
): TextHit[] {
  const hits: TextHit[] = [];
  const push = (index: number, pattern: string, match: string, expr?: string) =>
    hits.push({ ...lineCol(content, index), pattern, match, ...(expr ? { expr } : {}) });
  // Each allowlist entry excuses one site, in file order.
  const used = new Map<string, number>();
  const allowlisted = (_file: string, expr: string) => {
    if (!useAllowlist) return false;
    const key = normalise(expr);
    const n = used.get(key) ?? 0;
    if (n >= allowance(file, key)) return false;
    used.set(key, n + 1);
    return true;
  };

  const icons = lucideNames(content);
  for (const m of content.matchAll(ROTATION)) {
    if (inComment(content, m.index ?? 0)) continue;
    if (isIconTag(owningTag(content, m.index ?? 0), icons)) continue;
    push(m.index ?? 0, "rotated-text", m[0]);
  }
  for (const m of content.matchAll(VERTICAL_TEXT)) {
    if (inComment(content, m.index ?? 0)) continue;
    push(m.index ?? 0, "rotated-text", m[0]);
  }
  for (const m of content.matchAll(SMALL_CAPS_SHAPES)) {
    if (inComment(content, m.index ?? 0) || allowlisted(file, m[0])) continue;
    push(m.index ?? 0, "small-caps", m[0], m[0]);
  }

  const tagRe = new RegExp(`<(${SMALL_CAPS_TAGS.join("|")})\\b`, "g");
  for (const m of content.matchAll(tagRe)) {
    const start = m.index ?? 0;
    const open = openingTag(content, start);
    if (open.endsWith("/>")) continue;
    const close = content.indexOf(`</${m[1]}>`, start + open.length);
    if (close < 0) continue;
    for (const expr of childExpressions(content.slice(start + open.length, close))) {
      if (isNotWords(expr) || allowlisted(file, expr)) continue;
      push(start, "small-caps-user-words", `<${m[1]}>{${normalise(expr)}}`, normalise(expr));
    }
  }

  for (const [tag, prop] of Object.entries(SMALL_CAPS_PROPS)) {
    for (const m of content.matchAll(new RegExp(`<${tag}\\b`, "g"))) {
      const start = m.index ?? 0;
      const open = openingTag(content, start);
      const attr = new RegExp(`\\b${prop}=\\{`).exec(open);
      if (!attr) continue;
      const expr = childExpressions(open.slice(attr.index + prop.length + 1))[0] ?? "";
      if (isNotWords(expr) || allowlisted(file, expr)) continue;
      push(
        start,
        "small-caps-user-words",
        `<${tag} ${prop}={${normalise(expr)}}>`,
        normalise(expr),
      );
    }
  }

  if (!file.startsWith("src/components/ui/")) {
    for (const m of content.matchAll(/\beyebrowVariants\(/g)) {
      const index = m.index ?? 0;
      const lineStart = content.lastIndexOf("\n", index) + 1;
      if (/^\s*(?:import|\/\/|\*|\/\*)/.test(content.slice(lineStart, index))) continue;
      if (allowlisted(file, "eyebrowVariants()")) continue;
      push(index, "small-caps-user-words", "eyebrowVariants()", "eyebrowVariants()");
    }
  }
  return hits;
}

export type { TextHit };
export {
  childExpressions,
  isNotWords,
  openingTag,
  SMALL_CAPS_CHROME,
  SMALL_CAPS_DEBT,
  scanTextRules,
};
