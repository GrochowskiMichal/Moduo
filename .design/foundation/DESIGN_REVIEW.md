# Design Review: Phase 4 — Notes page

Reviewed against: [.design/foundation/DESIGN_BRIEF.md](./DESIGN_BRIEF.md)
Hard rules from: [CLAUDE.md](../../CLAUDE.md)
Phase scope: Phase 4 of [.design/foundation/TASKS.md](./TASKS.md)
Branch: `design/notes-page` (parent: `design/foundation-build`)
Date: 2026-05-12

## Screenshots Captured

No screenshots of `/notes` are attached. The Rsbuild web dev server (`bun run dev:web`)
gates the entire authenticated app behind a Tauri runtime check
([auth-provider.tsx:31](../../src/providers/auth-provider.tsx:31),
[app-gate.tsx:12](../../src/routes/layouts/app-gate.tsx:12)), so the preview always
lands on `/auth` ("Rust desktop runtime is required. Run inside Tauri.") and
cannot reach `/notes` without source patches. The web preview MCP could be
started and the auth surface inspected (foundation tokens render correctly on
`/auth`), but visual capture of the Notes 3-pane layout itself requires
`bun run dev:desktop` and a real workspace.

Recommended follow-up: run `bun run dev:desktop`, create a vault, open a few
notes with tags + categories, and capture:

- `screenshots/review-notes-desktop-1280.png` (≥1280px — tri-pane)
- `screenshots/review-notes-tablet-1024.png` (1024–1280 — right rail icon mode, _will
  look broken_; Phase 6.5 deletes icon mode)
- `screenshots/review-notes-narrow-900.png` (<900 — both rails close to Sheet)
- `screenshots/review-notes-context-menu.png` (right-click on a tree row)
- `screenshots/review-notes-relation-graph.png` (a note with shared tags rendering the
  XYFlow graph)

The review below is therefore code-based. It cross-references files, lines,
and tokens. Findings that depend strictly on rendered pixels (precise contrast
ratios, motion smoothness, line-length comfort at uncommon viewport widths) are
called out as **needs visual verification**.

## Summary

Phase 4 lands the brief end-to-end on Notes: the 3-pane shell composes
correctly through `FeaturePanelsShell`, the sidebar tree uses tokens + shadcn
`ContextMenu` + lucide icons + the Pinned / Custom DB / Notes section model,
the editor reads body text in `font-sans text-base text-foreground` (the
readability fix the brief calls out), the right rail introduces a working
Relation Graph + Tags + Close Relations triptych, and the Lexical theme is now
token-driven. Two small fixes (icon colour inheritance, concentric inner
radius on the graph card) are folded into this review pass.

## Must Fix

None.

## Should Fix

1. **Right rail at the surviving `icon` breakpoint (1024–1280px) is unusable.**
   The right aside compresses to `var(--width-rail-icon)` ≈ 48px in this range
   (see [feature-panels-shell.tsx:96](../../src/components/app/feature-panels-shell.tsx:96)),
   but the Notes right rail content is sized for the full 320px width. The
   relation graph and tag input will overflow.
   _Fix:_ this is **expected to be deleted by Phase 6.5** (REVISION_DELTA §6
   removes `icon` mode entirely). No action this phase. Flag in PR description
   so reviewers don't mistake it for a regression.

## Could Improve

1. **Title input has no `:focus-visible` ring.** The title `<input>` in
   [LexicalNoteEditor.tsx:188](../../src/features/notes/editor/LexicalNoteEditor.tsx:188)
   has `focus-visible:ring-0` for a clean editorial look. Cursor caret is the
   only focus signal. Keyboard-only users may want a subtle indicator. Defensible
   either way; weak signal because the page heading is also the input.

2. **Mobile / narrow breakpoint UX of the Sheet-mounted rails.** When the viewport
   drops below 900px the FeaturePanelsShell mounts both rails inside `Sheet`s. The
   Notes content (tree DnD, ContextMenu within ContextMenu, relation graph in a
   sheet) hasn't been visually verified at this width. Recommend a manual pass
   when desktop QA happens.

3. **`useAuth()` was dead in `NotesSplitView`** — destructured `runtime`,
   `userId` but neither was used. Cleaned up in this review pass (no separate
   commit, folded into the polish commit).

4. **`NoteKindIcon` was stuck on `text-muted-foreground`** even when the row
   was hovered / selected, so the kind icon read at the wrong contrast against
   `bg-accent`. Switched to `text-current opacity-70` so the icon inherits the
   row colour and dims itself relatively. (Folded into the polish commit.)

5. **Relation-graph card was `rounded-md` inside a `rounded-2xl` + `p-4`
   aside.** Per REVISION_DELTA §5, inner radius = max(16 − 16, 0) = 0.
   Switched the card to flat-edged in [notes-right-rail.tsx](../../src/features/notes/ui/notes-right-rail.tsx).
   Sidebar tree rows kept `rounded-md` deliberately — they're transient hover
   pills, not persistent nested cards, so concentric is not the right reference
   (Linear / Spotify keep the pill shape).

6. **Relation Graph node styling uses inline `style={{ background: 'var(--card)', ... }}`
   on ReactFlow nodes.** ReactFlow's node API does not accept className per
   node without custom node types, so the inline form is the cleanest route
   to keep colours/border/radius token-driven. Spirit of the CLAUDE.md rule
   (no hex bypass) is intact — every value is a `var(--*)`. If the design
   review wants stricter enforcement, lift the styling into a small
   `mindmap-style` custom node type.

## What Works Well

- **Single source of truth for the 3-pane geometry.** `notes-page.tsx` and
  `NotesSplitView.tsx` both route through `FeaturePanelsShell`. No bespoke grid
  remains, no duplicated panel-state subscriber.
- **Shadcn `ContextMenu` covers row + sidebar empty-space.** The 1100-line
  fixed-position portal menu is gone. Radix handles focus restoration,
  outside-click, Escape, and keyboard nav — none of which the bespoke version
  did correctly.
- **Move submenu is data-driven.** Right-clicking a note shows every other
  category as a target, plus "Top level". Current parent is disabled. This was
  on the Phase 4 ask list (TASKS.md line ~104 "Pin / Copy Link / Duplicate /
  Rename / Move / Move to Trash / Publish") and lands cleanly without ad-hoc
  modals.
- **Pinned / Custom DB / Notes section model.** Three explicit, collapsible
  sections with lucide icons (`Pin`, `Database`, `File`) and the
  `SIDEBAR_SECTION_TITLE` token-driven style. Empty states for each.
- **Body readability fix.** [LexicalNoteEditor.tsx:200](../../src/features/notes/editor/LexicalNoteEditor.tsx:200)
  now uses `font-sans text-base text-foreground` on the contenteditable, and
  the wrapper around the editor (see
  [NotesSplitView.tsx](../../src/features/notes/ui/NotesSplitView.tsx) center
  slot) caps width to `var(--width-prose-max)` (42rem). Headings flip to
  `font-display` via the title input. This is the single biggest visual
  improvement the brief asked for.
- **Lexical theme is now token-end-to-end.** Every `.notes-*` rule in
  [global.css](../../src/global.css) reads from `--foreground`, `--primary`,
  `--muted`, `--card`, `--border`, `--radius-*`, `--text-*`, `--font-*`,
  `--leading-*`. The previous raw rgba table-selection highlight is now
  `var(--accent)` + `var(--ring)`. Pixel values became rem references.
- **Sonner replaces the bespoke portal toast.** Publish / unpublish / copy-link
  emit Sonner toasts; the `fadeSlideUp` keyframe and the
  `bg-[#161616] text-[#a3c4f3]` literal are gone. The Toaster was already
  mounted at the app root in Phase 2.
- **Right rail does real work.** Tags are wired to `onUpdateTags` via the
  Phase 3 `TagInput` (Badge-backed pills). The Close Relations list shows
  tag-shared neighbours with a `Badge` count, sorted by overlap. The XYFlow
  graph places the open note at centre with up to 8 neighbours arrayed in a
  circle; clicking a neighbour selects that note. All of this falls back to
  legible empty states ("Add tags to surface connections.",
  "Open a note to see its relations.", "No notes share tags with this one yet.").
- **Lint hygiene held.** `bun run typecheck` clean. `bun run lint:tw` shows
  zero violations across the four files Phase 4 touched
  (`notes-page.tsx`, `NotesSplitView.tsx`, `notes-right-rail.tsx`,
  `LexicalNoteEditor.tsx`). `bun run lint:css` errors stayed at 0 (warnings:
  214, down from 216).

## Files in scope

- `src/routes/pages/notes-page.tsx` (Phase 4 task 1)
- `src/features/notes/ui/NotesSplitView.tsx` (tasks 1–3, 5)
- `src/features/notes/ui/notes-right-rail.tsx` (task 5 — new)
- `src/features/notes/editor/LexicalNoteEditor.tsx` (tasks 3–4)
- `src/global.css` (task 4)

## Files explicitly out of scope (left as-is)

- `src/features/notes/editor/nodes/EmbeddedMindmap.tsx` — embedded-content
  surface; still on raw hex. Migrates with the mindmap brief.
- `src/features/notes/editor/nodes/EmbeddedTask.tsx` — same.
- `src/features/notes/editor/plugins/SlashCommandPlugin.tsx` — same.
- `src/tw/` — RN compatibility shim per CLAUDE.md.
