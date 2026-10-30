---
paths: ["apps/app/src/features/notes/editor/**", "apps/app/src/features/notes/ui/**", "apps/app/src/features/spine/editor/**", "apps/app/src/features/spine/references/**", "apps/app/src/features/chat/markup-v2/**", "apps/app/src/features/chat/composer/**", "apps/app/src/features/tasks/capture/**", "apps/app/src/features/email/ui/email-compose-editor.tsx", "supabase/functions/_shared/description-markdown.ts"]
incident: "A nested editor.update in a command handler bit twice (TV-U14 mention picks, NR-8 orphan comment marks), and HistoryPlugin undid teammates' text in collaborative notes (NR-3)"
expires: 2027-01-31
---

# Lexical editors (notes, descriptions, chat, capture)

Compiled from the notes gotchas (HV-14b). `lint:ast` fails the mechanical forms: `lexical-update-in-command`, `lexical-history-in-collab`, `lexical-dom-lookup-in-state-read`.

## Updates, commands and reads
- A command handler already runs inside an update: do the `$` work in it and decide synchronously; a nested `editor.update` is queued. A menu's pick returns the edit to run (`MentionMenuPlugin`'s `onPick`).
- Commands registered once see first-render props: route actions through a ref refreshed each render.
- `editor.read()` is read-only: building nodes there throws. DOM-to-node lookups need `editor.read`, not `editorState.read`.
- A node object goes stale the moment the node is written: read positions (`getIndexWithinParent()`, `getNextSiblings()`) before changing anything, and compare with `.is()`.
- Removing a list's last item removes the list: insert replacements first, then remove.
- `registerRootListener`: define DOM handlers per effect run outside the callback, and remove them from `editor.getRootElement()` in cleanup.
- Updates that load stored text are tagged `moduo-seed`; a change listener that skips them still moves its baseline. A commit-on-blur baselines against the serialized seed, not the stored string, and also listens for `focusout` (a check-list click focuses the item, not the root).

## Focus and surfaces next to the editor
- Lexical's post-update focus restore steals focus from a portal opened by a key: open it after the update settles through `afterFocusRestore` (`apps/app/src/features/notes/editor/after-focus-restore.ts`), and own its Escape and outside-click.
- Never render React into DOM that Lexical created (its observer reclaims it, then React's unmount throws and the two loop): chrome around lines goes in an overlay next to the contenteditable, re-measured on update and resize. Overlays find the reading column by mark (`apps/app/src/features/notes/editor/note-column.ts` `noteColumn`).
- Three `MentionMenuPlugin`s (`@`, `/`, `#`) share one editor: each claims Enter, Tab and arrows only while its own menu is open. `source` may be null (an unsent email): insert the chip, skip the link.

## Nodes
- There is one Reference node (`ReferenceNode`, exported also as `EntityRefNode`): change it in place, never add a second reference type. Keep `isInline()` true; a card is an inline node whose DOM span is `block`.
- A custom `DecoratorNode` is in every editor's `nodes` that may hold it, sets `contentEditable="false"` in `createDOM` if inline, declares `isInline()` explicitly (0.49 made it opt-in), and has `exportDOM`/`importDOM` if it rides an HTML surface.
- Rich `description` HTML shares its column with plain text from external sync: never `dangerouslySetInnerHTML`; `looksLikeRichHtml` decides and `EntityRichText` renders through an allowlist walk (`apps/app/src/features/spine/ui/entity-rich-text.tsx`).

## Markdown
- `@lexical/markdown`'s import is quadratic in one block's size and in crafted delimiters: workspace text goes through the capped reader (`apps/app/src/features/spine/editor/description-markdown.ts` `$importDescription`), never straight into `$convertFromMarkdownString`.
- Text-match import ignores Markdown escapes and unescapes afterwards (numeric references too): never decide what is a reference by an escape; descriptions defuse `](moduo:` on export (`defuseReferences`) and refuse `moduo:` links.
- The default element transformers lack `CHECK_LIST` (add it before the list transformers) and an HR transformer; element transformers run only on top-level blocks, so `- [ ]` can never become a checkbox (the gesture is `[] `).
- Empty list items export as a bare marker: drop trailing empty items on the tree (`$withoutTrailingEmptyItems`), not the text. Adjacent non-empty lines import as one paragraph with a break. Stored markdown escapes only what would read as syntax (`apps/app/src/features/notes/editor/markdown-escape.ts`): assert that text reads back through both readers, not bytes; the importer reads any line-final backslash as a hard break, escaped or not; adjacent lists of one kind merge in the editor, so any tree must merge them too.
- A theme needs the full `text.*` class map (bold, italic, strikethrough, underline, underlineStrikethrough), or combined formats render invisibly.

## Collaboration (notes)
- Never mount `HistoryPlugin` in a collab editor: undo is the Yjs manager (`apps/app/src/features/notes/editor/collab-undo.ts` `collabUndoManager`); doc writes add their origin (`asUndoStep`) or skip undo (`updateWithoutUndo`).
- Never move a block with `insertBefore`/`insertAfter` in a collab note (the binding rewrites text in place, so a peer's typing lands in the neighbour): move on the Yjs doc (`apps/app/src/features/notes/editor/block-move.ts` `moveBlockInDoc`) and assert on the doc.
- Mounting the collab editor on an empty doc writes a paragraph into it that pushes like typing: mount from cache only when the cached doc has content.
- The v2 binding writes element properties `__`-prefixed and only when they differ from a default node (an ordered list carries no `__listType`): read `__name ?? name`, and build test docs as the binding emits them (`buildDocStateFromMarkdown`), never raw `Y.XmlText` in `root-v2`.
- A headless editor needs `editor.update(fn, { discrete: true })` and a provider with a real `Awareness`; `syncLexicalUpdateToYjsV2__EXPERIMENTAL` takes `dirtyLeaves` since 0.49, and headless `exportJSON()` returns no children.
