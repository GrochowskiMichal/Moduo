# CV-0-S4 — Spike 4: the stored form of a message, round trip

> Branch `t/maciej/cv-0-s4-stored-form` · head: see `git log` (pushed with this file) · status: built, not landed
> Migration: none (the SQL converter is a draft: `docs/build/chat-v2/drafts/chat_v1_to_v2.sql`, run only in a scratch schema `spike_s4`, dropped)

## Delivered against the row

- **Pure stored-form module** `src/features/chat/markup-v2/` (no UI, nothing wired): `parse.ts` (stored text → tree), `serialize.ts` (tree → stored text, with escaping), `canonical.ts` (the one canonical tree), `plan.ts` (where marks open and close, shared by the serializer and the canonical rules), `tokens.ts` (URLs, `@channel`, `:name:` inside text), `cache.ts` (tree per message id + `updated_at`), `text.ts` (`body_text`, mentions), `index.ts` (pure exports).
- **Lexical bridge** `lexical.ts`: `CHAT_EDITOR_NODES`, `$editorToBlocks` / `$exportStored` (editor → stored), `$importStored` / `$importBlocks` / `$blocksToNodes` (stored → editor, also what a clean paste inserts), `$canonicalizeEditor`, `chatReferenceDisplay`.
- **Clean paste** `paste.ts`: `htmlToBlocks`, `plainTextToBlocks`, `pastedBlocks` (HTML → tree; keeps text, lines, links, lists, quotes, code blocks; drops every style).
- **⏎ / IME** `enter.ts`: `enterIntent` + `registerSendOnEnter`.
- **Conversion check** `v1-compare.ts` (v1's own parser vs v2's, both as canonical v2 trees) + `v1-fixture.ts` (the 50 hand-made v1 bodies and what the draft SQL made of each).
- **SQL converter draft** `docs/build/chat-v2/drafts/chat_v1_to_v2.sql` (`chat__v1_to_v2`, `chat__v1_inline`, both IMMUTABLE plpgsql) and its runner `docs/build/chat-v2/drafts/check_v1_to_v2.ts`.

## Pass bars (round-3 §5, spike 4) — measured

| # | Bar | Result | Numbers |
| --- | --- | --- | --- |
| 1 | One written list of supported constructs | **pass** | §Constructs below; one test per construct in `parse.test.ts` (18 tests) |
| 2 | Parser + serializer, pure TS, tree cached per (id, updated_at); Lexical export and import for edits | **pass** | `parse.ts`, `serialize.ts`, `cache.ts` (LRU, 2,000), `lexical.ts`; round trip proven headlessly with `@lexical/headless` |
| 3a | 200+ case corpus, 100 % parity editor → stored → parser → editor | **pass** | 254 editor-origin cases (237 built + 17 pastes) + 24 stored-input cases, all pass. 218 + 17 come back **node for node**; 19 are documented canonicalisations (each asserted to change, §Canonical form). Plus fuzz: 60,000 random trees (serialize → parse) and 20,000 through Lexical, 0 failures; exhaustive: all 69,904 sequences of ≤ 4 leaves × 8 mark sets × text/code, 0 failures |
| 3b | 30 rows parsed (tree build) ≤ 5 ms | **pass** | 30 realistic rows cold: first (JIT-cold) run 2.07 ms, median 0.135 ms, p95 0.344 ms over 200 screens (`perf.test.ts`, jsdom, M-series Mac) |
| 3c | ⏎ never sends during IME composition | **pass** | `enter.test.ts`: `isComposing`, `keyCode` 229 (WebKit/WKWebView's committing Enter) and Lexical's own composition key all swallow ⏎ without sending or cancelling the key |
| 4 | `chat__v1_to_v2` over the research workspace's 3,032 messages, read-only, scratch schema | **pass** | 3,032 rows in 119–133 ms; 6 bodies change text; 3,032 parse, 3,032 are serializer fixed points, 0 v1 tokens left, 0 labels left, **3,032 draw exactly as v1 drew them** (0 meaning changes; 0 dash / numbered / `[text](url)` lines in that data). Hand fixture (50 bodies): 50 parse, 0 tokens or labels left, 42 draw the same, 8 differ, each named (§Converter run). Old bell excerpts: 6 rows, 4 would change, all draw the same. Both functions `provolatile = i`. `spike_s4` dropped (0 left) |

## Constructs (the supported list)

**Inline** (marks combine freely; a line break ends every mark):

| Construct | Stored spelling | Notes |
| --- | --- | --- |
| Bold · italic · strike | `**b**` · `*i*` · `~~s~~` | `*` may sit inside a word (`un*believ*able`); a run opens only before a non-space and closes only after one, so `5 * 3` is text; `_` and `__` mean nothing; a single `~` is text |
| Inline code | `` `x` `` | fence longer than any backtick run inside; one padding space when the code starts or ends with a backtick or with spaces on both sides; nothing parsed inside; never spans a line |
| Link | `[label](https://…)` | http(s) and `mailto:` only, no whitespace in the target (`()<>\` escaped); the label holds text and inline code |
| Bare URL | `https://…` | text in the composer; drawn as a link; trailing `.,:;!?"'*_~` and unbalanced `)]}` stay outside |
| Reference | `moduo://<type>/<uuid>` | exactly a uuid (lower-cased); types as RF-1 writes them: `task`, `note`, `contact`, `company`, `event`, `email_thread`, `bucket` (a project), `tag`, plus `person`, `team`, `chat_channel`, `chat_message`; never a title. `[title](moduo://…)` reads as the bare reference (title dropped) |
| Person mention | `moduo://person/<profiles.id>` | §Choices |
| Team mention | `moduo://team/<teams.id>` | |
| Date chip | `moduo://date/YYYY-MM-DD` | RF-1's spelling (`references/text.ts dateUri`); a real calendar day only |
| `@channel` | `@channel` | at a token start (line start or after whitespace, `spine/grammar.ts`) and as a whole word; `@channels`, `x@channel.com` are text; `@here` / `@everyone` are text |
| Custom emoji | `:name:` | 2–32 of `a-z 0-9 _ + -` with a letter, not glued to a letter, digit or colon (`10:30:45` is text); drawn as text when the workspace has no such emoji |
| Native emoji | the characters | ZWJ sequences, flags, skin tones as typed |
| Escape | `\` + ASCII punctuation | the serializer escapes every literal `\ * `` [`, `]` in a label, `~` next to `~`, `<` before a letter, `!` before a link, the `:` of a literal `moduo://`, and a line-start `- + > # 1.` `---` `===` |

**Blocks** (set off from each other by one blank line, which the parser consumes; any other blank line is content):

| Construct | Stored spelling |
| --- | --- |
| Lines | every `\n` is a line break (chat's meaning, not CommonMark's soft break) |
| Quote | `> ` per line (`>` alone for an empty line); inline content only |
| Code block | ```` ```lang ```` … ```` ``` ```` (longer fence when the code holds backticks); `lang` is one word `[A-Za-z0-9_+#.-]{1,32}` |
| Bulleted list | `- ` per item |
| Numbered list | `1. ` per item, from its start number; continuation lines indented to the item's text (`10. x` → 4 spaces); one level |

Not supported (read as text): headings, tables, images, HTML, indented code, nested lists, titles on links, `<url>` autolinks, tilde fences.

## Canonical form

`canonical.ts` is the one shape every path agrees on; parity is exact against it. What it changes, each a corpus case asserted to change (19 cases):

1. Bold / italic / strike come off whitespace where the stored form opens or closes them (`**a **` can't be written): e.g. `t("a ") t(" b ", B) t(" c")` → `a  **b**  c`. Overlapping marks close and reopen, and the reopen point is an edge too (`**a *b*** *c*`). References, dates, links and line breaks end every run of marks.
2. Two paragraphs in a row become one, joined by a line break; two lists of one kind in a row become one (Lexical merges those itself).
3. The message's edges are trimmed: leading and trailing blank lines and spaces.
4. A nested list flattens to one level.
5. Links keep http(s) and mailto targets without whitespace; anything else becomes its label text. An auto-link node becomes text.
6. Underline, highlight and the other Lexical formats drop; a reference's display follows the rule (alone on its line in a paragraph → card where RF-1 shows cards, a tag → link, else chip).

## Converter run (round-3 §2.6, step 4 rehearsal)

- Run: `psql -f` of a scratch script: `create schema spike_s4`, the draft created there (`set search_path from current`), a 50-row hand fixture, JSON exports of `(id, v1, chat__v1_to_v2(v1))`, `drop schema spike_s4 cascade`. No public table or function was written.
- Research workspace (3,032 rows): 6 bodies change text (`<!channel>` ×1, `_Friday_` ×1, `<@id>` ×3, `<moduo:task:…|Ship the onboarding checklist>` ×1); every result parses, is a fixed point, leaves no token or label, and draws as v1 drew it.
- **v1 lines that change meaning as Markdown, counted:** research workspace 0 dash lines, 0 numbered lines, 0 `[text](url)`; the fixture's deliberate examples: 2 dash lines (1 body), 2 numbered lines (1 body), 1 `[text](url)`.
- Fixture, drawn differently on purpose (8 of 50): `f04` `hi<!channel>s` → `hi @channel s` (spaces keep the token a token); `f14`, `f46`, `f47`, `f48` fences — a one-line ```` ```code``` ```` (v1 read `code` as the language of an empty block: a v1 bug; the conversion keeps it as the code) and mid-line fences rewritten onto their own lines; `f22` dash lines, `f23` numbered lines, `f24` a `[text](url)` (accepted as better formatting).
- Kept literal, not converted: v1 tokens inside code spans and fences (they were literal in v1 too).
- Escaped so v2 draws what v1 drew: stray `*` (`2*3*4`), `` ` ``, `~`, a backslash before punctuation, a literal `moduo://`, `*`/`~`/`` ` `` inside URLs. Spaces at the inner edges of v1 bold/strike move outside.
- A second pass over converted text changes 19 of 50 fixture bodies (escapes get escaped again): the function is **not** idempotent by itself; the migration must gate on `format_version = 1` (as round-3 §2.6 says).

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **Person URI `moduo://person/<profiles.id>`, team `moduo://team/<id>`**: RF-1 has no person node (its `@` person pick inserts plain `@Name` text and notifies); the blueprint proposed `person`; the reference grammar (`references/text.ts`) already parses any `moduo://<type>/<uuid>`, so people are references like everything else. · *Rejected:* `user`/`profile` (the column is `profiles.id` but "person" is the product word), a separate `<@id>` syntax.
- **Emphasis is a stack mirroring the serializer, not CommonMark's delimiter algorithm**: CommonMark's algorithm mis-pairs runs the composer produces (`**a***b**c***` for bold, italic, bold-italic); the stack reads each run as "close innermost, then open", fewest closes first, unclosed openers back to text. Exhaustively proven for ≤ 4 leaves and fuzzed. · *Rejected:* CommonMark's process-emphasis (208 of 4,368 three-leaf sequences failed), `@lexical/markdown` (doesn't escape literal syntax; a second dialect).
- **`*` may open inside a word** (CommonMark-like) so intraword italic from the editor survives; v1's `2*3*4` (text in v1) is escaped by the converter instead. · *Rejected:* v1's word-boundary rule (intraword formatting couldn't be stored).
- **`_` means nothing**: the converter rewrites v1's `_italic_`; snake_case never needs escaping. · *Rejected:* `_` as an alternate italic.
- **Every `\n` is a line break; blocks are set off by one blank line; paragraphs merge**: the composer makes lines with ⇧⏎, so one paragraph with breaks is canonical. · *Rejected:* CommonMark paragraphs (soft breaks), which would make `a\nb` one line.
- **Flat marks per leaf (like Lexical's formats), not v1's nested `bold{c}` tree**: one shape per formatting, which is what the editor holds; the renderer wraps a leaf. · *Rejected:* nested emphasis nodes (two shapes for one meaning).
- **A reference's display isn't stored**: RF-1's insert rule decides it from position (alone on its line in a paragraph → card where `canShowAsCard`, a tag → link, else chip). · *Rejected:* `?display=card` on the URI (the spec says `moduo://<type>/<id>` only).
- **Bare URLs and `@channel`, `:name:` are text in the composer**; the parser finds them. · *Rejected:* AutoLinkNode in the stored round trip (a typed URL that the plugin didn't wrap would flip node types).
- **Clean paste keeps text, lines, links, lists, quotes and code blocks and drops every style, inline code included** (CH15 "clean text"; dodges Google Docs' all-bold wrapper). Tables become tab-separated lines; emoji images become their `:name:` or character. · *Rejected:* Lexical's `$generateNodesFromDOM` (imports styles, the GDocs trap).
- **Link targets: http(s) and mailto only, no whitespace.** · *Rejected:* relative and other schemes (`javascript:`), encoding spaces silently.
- **The converter fixes two v1 drawing bugs instead of copying them**: one-line ```` ```x``` ```` keeps `x` as code (v1 drew an empty block labelled `x`); a `<!channel>` glued to a word gets spaces so it still reaches everyone. · *Rejected:* reproducing v1's output exactly.

## Gotchas (area: chat / editor)

- Lexical's list transform merges two adjacent lists of one kind in the editor itself: any tree that holds two must merge them or parity breaks.
- `KeyboardEventInit` has no `keyCode`: tests set it with `Object.defineProperty`; WebKit's IME-committing Enter is `keyCode` 229 with `isComposing` false.
- `editor.read()` is read-only: building nodes from a read (`$createParagraphNode`) throws; take the tree in a read, build in an `update`.
- PostgreSQL regex alternation is leftmost-**longest** and non-greedy quantifiers follow the whole RE's greediness: the converter's patterns exclude their own delimiters (`(?:[^*\n]|\*(?!\*))+`) instead of relying on `+?`.
- psql: build the SQL in a file (`psql -f`); heredocs and `-F'|'` are refused by the worktree guard.

## For later blocks

- **CV-1 (conversion):** adopt `chat__v1_inline` + `chat__v1_to_v2` from the draft into `…_chat_v2_convert_v1` (switch `set search_path from current` to `set search_path = ''` and schema-qualify the inner call); gate on `format_version = 1` (not idempotent); also rewrite `module_activity.payload->>'excerpt'` for `chat.mention` / `chat.reply` (6 local rows). Reuse `check_v1_to_v2.ts` + `compareConversion` for the round trip (step 4) and assert the SQL against `V1_FIXTURE` (a SQL test can embed the 50 pairs). Re-run on prod data at the release train: the research data had none of the accepted-change kinds, so the real counts are unknown until then.
- **CV-1 (`body_text` trigger):** the SQL stripper must agree with `toBodyText` (references and dates read as nothing, Markdown and escapes stripped, `@channel` / `:name:` kept, link labels kept, URLs kept); check it on the corpus' stored strings.
- **CV-1 / CV-2 (send op):** the server should normalise agent input `[title](moduo://…)` to the bare URI (the parser already drops the title when drawing) so no title is stored; `mentioned_user_ids` can come from `mentionsOf(tree).people`.
- **CV-7a (stream):** draw rows from `messageTree(id, updated_at, body)`; a leaf's marks are a bitmask (wrap `<strong>/<em>/<s>`); `url` → link, `channel` → the `@channel` pill, `emoji` → the custom image or its text; `ref` with `person` / `team` needs RF-1 kinds (today `referenceKind` says `other`); `chat_channel` / `chat_message` kinds come with CV-10.
- **CV-7b (composer):** register `CHAT_EDITOR_NODES`; send with `registerSendOnEnter` (menus keep ⏎ at a higher priority); wire `PASTE_COMMAND` to `pastedBlocks` → `$insertNodes($blocksToNodes(…))`; the `@` person pick must insert a `person` ReferenceNode (not text); turn "Show as" off (display follows position); block Tab-indent (one list level); the `- ` list shortcut should also fire after a ⇧⏎ line break (Lexical's only fires at a block start, so "Plan:⇧⏎- one" stays text today); Markdown shortcuts may use `@lexical/markdown` transformers for typing only. Edit = `$importStored(body)`.
- **CV-20 (custom emoji):** the name rule here (2–32 of `a-z 0-9 _ + -`, one letter) should become the contract's `REACTION_KEY` name part.
- **Spec test map:** names `src/features/chat/markup/parity.test.ts`; the code is in `markup-v2/` per this brief.

## Manual checklist (step → expect → surface)

- [ ] None for this spike: nothing is wired into the app. CV-7a/7b's checklists cover typing, pasting and drawing.

## Verify before release

- Re-run `chat__v1_to_v2` + `check_v1_to_v2.ts` over prod's v1 messages (read-only) and record the accepted-change counts before CV-1 applies.
- After CV-7b wires the composer: a live IME check (macOS Japanese input) in Safari and the desktop app (WKWebView).
