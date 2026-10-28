# Spec: Global search (⌘K)

> Status: **Ready** · Owner: mike (product: maciej; answers given by Mike on Maciej's behalf, with his acceptance, 2026-10-28) · Build: now, all of GS-1 to GS-10, independent of the alpha and beta schedule
> Related: [.design/connective-tissue/BRIEF.md](../.design/connective-tissue/BRIEF.md) §85, §202 · [.design/connective-tissue/DESIGN_BRIEF.md](../.design/connective-tissue/DESIGN_BRIEF.md) §33, §76, §122, §233 · [specs/connective-tissue.md](./connective-tissue.md) :13, :93, :116 (deferred "Cmd-K Search mode") · DF-10 ([decisions/spine.md](../docs/decisions/spine.md)) · CV-19 ([decisions/chat.md](../docs/decisions/chat.md)) · ROADMAP :129 ("Global cross-module search")

## Scope

⌘K becomes the one place to find anything you can see in a workspace: tasks, projects, notes, contacts, companies, events, chat messages and conversations, and on desktop your mail. Matching covers bodies as well as titles; words are matched by their start, in any order and ignoring accents. Results are ranked, show where they live, show a highlighted snippet, and open where they belong. Today ⌘K matches only entity titles (`entities.label ILIKE`, sorted A–Z, `apps/app/src/lib/runtime.web.spine.ts:190`). Chat has its own good search, and every other module has its own dialect or none.

The technical heart is a **shared search contract**:
- every module answers `<module>__search(ws, query, limit)` with one row shape;
- `search_all` merges and ranks those answers;
- one set of `search__*` text primitives, lifted from Chat's CV-19 work, makes matching identical everywhere.

**Notes is the first module on the contract.** The same contract later backs one MCP `search` tool, which is the "RAG" that fits the product brief: the user's own AI retrieves through MCP, and Moduo never generates answers (PRODUCT_BRIEF :95, :115). Sub-200 ms search is a P0 performance budget (PRODUCT_BRIEF :105).

## Product behavior & UX

Every `Q#` below refers to a ratified answer under *Product answers*.

1. **Open.** ⌘K from anywhere, and the bottom-bar Search when no module claims it. This is unchanged.
2. **Empty query.** You see *Recent* (the last 8 things you opened in this workspace, on any device; Q11–Q13), then the existing actions (Navigate, New note, …).
3. **Typing.** After 150 ms, results replace the previous ones in place. The old results stay up until the new ones arrive, so the list never flashes empty. A thin progress line appears only if the reply takes longer than 300 ms (Q22).
4. **Results layout.**
   - One **Top result** row: the single best match across all types (Q1).
   - Then **groups** in a fixed order: Tasks, Projects, Notes, Contacts, Events, Messages, Conversations, Email (Q2).
   - Each group shows up to 3 rows, plus a "Show all N" row that filters to that type (Q3).
   - Actions whose label matches still appear, under the results (Q4).
5. **A row.**
   - Type icon.
   - The title, with the matched word-starts highlighted.
   - A **context** line: the note's parent path, the task's project, the message's conversation, the contact's company, the event's date (Q5).
   - A one-line **snippet** with the hit highlighted, shown only when the match is in the body rather than the title (Q6).
   - At the right, how long ago the item changed.
   - Trashed and archived items: see Q7, Q8.
6. **Matching.**
   - All words must match, in any order. Each word of 3+ letters matches word-starts ("plan" finds "planning"); words of 1–2 letters match whole words.
   - Accents are ignored both ways ("zolw" ↔ "żółw").
   - A task ID ("MOD-142", "mod 142") finds that task first.
   - Small typos in **titles** are forgiven ("meetng" finds "Meeting") when exact matching finds little (Q9).
   - Quotes give a phrase and `-word` excludes. No other query language (DESIGN_BRIEF :233; Q10).
7. **Filter by type.** A row of chips under the input: All · Tasks · Notes · Contacts · Events · Chat · Email. Tab and Shift+Tab move between chips; "Show all N" selects that group's chip (Q14, Q15).
8. **Open a result.** Enter opens it where it belongs (the DF-10 entity-open grammar). A note opened from a body hit scrolls to the first match and highlights the query's word-starts until you click or type (Q16; this one is a later block, GS-10). Dragging a result onto an item creates a link (DESIGN_BRIEF :122, unchanged).
9. **What you can't see never appears**, not even as a count. Modules you can't reach never appear as groups or chips.
10. **Email.**
    - **Desktop:** your local mail joins in, as its own group, searched on this device.
    - **Web:** only threads already pulled into Moduo (linked, snoozed, converted) are searchable (Q17).
11. **Your own AI.** The MCP `search` tool returns the same results your key may see, with a snippet and a link (Q18, Q19).

## Edge cases

- **No results.** "No matches for '…'". If a type chip is active, there is a "Search everything" row. On web, Email is never offered as a hint (Q20).
- **Offline or server error.** Actions still work, and task IDs still match from this device's Tasks copy. One quiet line reads "Search needs a connection; showing what's on this device" (Q21). There are no error toasts.
- **A slow reply.** An out-of-order reply is dropped (the last request wins). After 5 s the server gives up, and the row reads "Search took too long, try fewer words".
- **One-letter, empty or only-negative queries** (`-x`). Results are not searched; the palette shows the empty-query view.
- **A very long query or paste.** Only the first 256 characters and 32 words are used, silently.
- **Notes you can see only through a parent's sharing.** These are found. A note that inherits from a parent you can't see is not.
- **Someone else's private calendar event** never matches by its title, description or attendees. It isn't searchable at all (Q23).
- **A private conversation or DM you left, or one you're not in**, is never matched. A public channel is matched whether you joined it, never joined it or left it (Q24), as Chat's own Search reads it. (Amended in GS-6.)
- **A trashed item** is hidden by default (Q7). An archived item appears under its group with an "Archived" tag (Q8).
- **A renamed project** is found by its new name at once. Today its registry label goes stale; GS-4 fixes that.
- **The same item reached two ways** (a task is also a top result) appears once.
- **An API key with view scope on Notes only** finds only notes, never chat DMs. A key without `include_private_chat` finds only public channels.
- **Typo forgiveness never beats an exact hit.** Fuzzy title matches rank below every exact match.
- **Polish text.** "ł" ↔ "l", "ż" ↔ "z". Stemming ("spotkania" finding "spotkanie") is not promised (Q9b).
- **A deleted workspace member's content** follows the existing visibility rules. Search adds no rule of its own.

## Acceptance criteria

- **AC1.** Typing a word that appears only in a note's body finds that note. The row shows a snippet with the word highlighted and the note's parent path.
- **AC2.** Matching ignores accents in both directions. Words of 3+ letters match word-starts, all words must match in any order, and the 256-character / 32-word bounds hold.
- **AC3.** A person never sees a result they couldn't open. This holds for each type's rule: inherited note sharing, task and project access, contact and company access, private events, chat readability, and email ownership. It holds equally for an MCP key with its own scopes.
- **AC4.** A search never returns fewer visible results than exist because invisible items crowded them out. Visibility is applied before the limit.
- **AC5.** The palette shows one Top result, then groups in the fixed order, each up to 3 rows with "Show all N". Type chips filter, and Tab moves between them.
- **AC6.** A task ID finds that task first. A typo in a title finds the item only when exact matching finds fewer than 3 hits, and ranked below them.
- **AC7.** With an empty query, ⌘K lists your last 8 opened items in this workspace. They follow you across devices and no one else can read them.
- **AC8.** The server answers within p95 ≤ 60 ms, and the palette paints within 200 ms of the last keystroke. This is measured at 10,000 notes, 10,000 tasks and 1,000 contacts in one workspace.
- **AC9.** Offline or on error, the palette keeps working with its actions and the local task-ID match, and shows one quiet line.
- **AC10.** Notes' own sidebar search, the MCP `notes_search` and the palette return the same notes for the same query.
- **AC11.** The MCP `search` tool returns the same rows as the palette for that key's visibility, capped at 50 per call.
- **AC12.** On desktop, local mail matches appear as an Email group. On web, only pulled-in threads appear.
- **AC13.** Opening a note from a body hit scrolls to the first match and highlights it (GS-10).

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `supabase/tests/search_primitives.test.sql` · "unaccent, prefixes, bounds, negation" | AC2 | "zolw" finds "żółw" and the reverse. "pla" finds "planning" but "pl" doesn't. "-x" alone returns nothing. A 1,000-character paste is cut without an error. |
| `supabase/functions/_shared/contracts/search.test.ts` · "search hit row and match vocabulary" | AC5, AC11 | The one row shape and its closed `match` values parse strictly and normalise loosely, the same as every other contract. |
| `supabase/tests/notes_visible_ids.test.sql` · "visible set equals can_access" | AC3, AC4 | For a random tree of shared, inherited and private notes and 4 people, a note is in someone's visible set exactly when `can_access` says they can view it. |
| `supabase/tests/notes_search.test.sql` · "body hit, snippet, parent path, no crowding" | AC1, AC4, AC10 | A body-only word finds the note with a highlighted snippet and its parent path. 300 newer invisible matches don't push out the 1 visible match. |
| `supabase/tests/notes_search_perf.test.sql` · "10k notes p95" | AC8 | Seeds 10,000 notes, runs 50 mixed queries, and fails if the 95th percentile exceeds 60 ms. |
| `supabase/functions/moduo-mcp/modules/notes.test.ts` · "notes_search uses notes__search" | AC10, AC3 | The MCP notes search returns the same ids as the SQL function, and a view-only key never sees a private note. |
| `supabase/tests/search_all.test.sql` · "merge, top result, per-type limits, dedupe" | AC4, AC5, AC6 | Results from every adopted module merge into one ranked list. A task ID ranks first. A fuzzy title ranks below exact hits. Nothing appears twice. |
| `supabase/tests/search_all_visibility.test.sql` · "owner, member, outsider, key" | AC3 | Every adopted type is run as owner, sharee, member without a share, outsider and a scoped API key; each sees exactly what they could open. |
| `apps/app/src/lib/palette-search.test.ts` · "top result, groups, show all, chips" | AC5 | The palette's pure model turns hits into a Top result and fixed groups of 3 with correct "Show all N" counts, and a chip narrows to one type. |
| `apps/app/src/components/app/global-command-palette.test.tsx` · "keeps results while typing; offline line" | AC5, AC9 | Typing doesn't flash the list empty. A failed search shows the quiet line and keeps the actions and the task-ID hit. |
| `apps/storybook` · `GlobalSearchPalette` stories (populated, empty query with Recent, no results, offline, long titles) | AC5, AC7, AC9 | The visual states exist for the design review and the token lint. |
| `supabase/tests/tasks_search_v2.test.sql` · "tasks and projects on the contract" | AC1–AC4 | A task's description word finds it, a renamed project is found by its new name, and handle hits rank first. |
| `supabase/tests/contacts_events_search.test.sql` · "contacts, companies, events; private events never match" | AC3 | Someone else's private event is never found by its title. A company is found through a visible person. |
| `supabase/tests/chat_search_hits.test.sql` · "chat through the contract" | AC3 | Chat results through `search_all` equal `chat_search` for people, and `chat__key_channel_ids` for keys. |
| `supabase/functions/moduo-mcp/modules/search.test.ts` · "one search tool" | AC11, AC3 | The tool returns `search_all` rows for the key, caps at 50, and a key without chat scope gets no chat rows. |
| `supabase/tests/search_recents.test.sql` · "recents are private, capped, erased" | AC7 | Opening items records them, only the owner can read them, the list keeps 8 per workspace, and account erasure removes them. |
| `apps/app/src/features/email/search-palette.test.ts` · "desktop mail group, web pulled-in only" | AC12 | On desktop the palette adds local mail matches as an Email group; on web only `email_refs` threads appear. |
| `e2e/search/palette.spec.ts` · "find a note by a body word and open it" | AC1, AC8, AC13 | Live smoke: type a body word, see the note with a snippet, press Enter, land in the note with the match highlighted. |

## Assumptions & technical decisions

The agent decided these on the team's behalf. Each is the decision, a one-clause rationale, and the alternative rejected.

1. **Federated, not a central index.** Each module answers its own `<module>__search`, and `search_all` merges. *Why:* visibility differs per module (inherited note sharing, private-event masking, chat readable channels, email owner-only, the key path), and CV19-2 set "one read rule, not a parallel one". A central copy would have to re-implement every rule, and that is where leaks happen. *Rejected:* one `search_index` table fed by triggers, which also duplicates private content.
2. **The row shape** (`SearchHit`, in `supabase/functions/_shared/contracts/search.ts`):
   ```
   entity_type text, entity_id uuid, title text, context text|null, snippet text|null,
   icon text|null, match text, rank real, updated_at timestamptz, archived boolean
   ```
   - `archived` (amended in GS-3, Q8): the item is archived (a note, a task in an archived project, a project). The palette tags it "Archived" and it ranks lower; MCP `notes_search` returns it again.
   - A `search_all` row is a `SearchHit` plus `score real` (0..1), `type_total integer` (the "Show all N" count, capped at 50) and `top boolean` (the one Top result).
   - `match` is closed (`handle | title | title_fuzzy | body`). It lives in `vocabularies.ts`, with `parse*`/`normalize*`/`is*`.
   - There is no table, so there is no CHECK. `search_all.test.sql` asserts that every returned `match` is in the vocabulary, as the drift gate.
   - `entity_type` stays an open string (polymorphic types, AGENTS.md §Domain contracts).
   - `rank` is normalised to 0..1 within the module.
   - `snippet` uses the CV-19 markers U+E000/U+E001, so the client highlights without HTML.
3. **Shared primitives, lifted from Chat** (`search__unaccent`, `search__query`, the `search_headline` text search config, `search__snippet`). They copy `chat__unaccent`, `chat__search_query` and `chat_headline` (`20261017117000_chat_v2_search.sql`):
   - unaccent through `extensions.unaccent` behind an IMMUTABLE wrapper;
   - websearch syntax;
   - `:*` on lexemes of 3+ letters;
   - 256-character / 32-word bounds;
   - NULL for empty or only-negative input.

   Chat keeps `chat__unaccent`, because its GIN index expression names it and swapping the function would mean rebuilding that index. Chat's `chat__search_query` becomes a one-line call to `search__query` in GS-6. *Rejected:* each module keeping its own dialect (today's state).
4. **Text search config stays `simple`, with no stemming.** That matches the Notes decision. Polish stemming would need a dictionary Supabase doesn't ship (Q9b). Unaccent is applied to the indexed text and to the query.
5. **Typo forgiveness uses `pg_trgm`, titles only.** Install it into `extensions`, with a GIN trigram index on the unaccented, lower-cased title per adopted table. It is used only when exact matching returns fewer than 3 hits, at `word_similarity ≥ 0.5` (the typed words against the best-matching stretch of each title, so a typo in a long title still counts), and ranked below every exact hit. An excluded word still excludes. "Fewer than 3" counts exact hits across every module: each module function decides on its own count, and `search_all` drops every typo-forgiven row once the merged list holds 3 exact hits. (Amended in GS-3: whole-title `similarity ≥ 0.3` missed "meetng" in "Weekly meeting notes", 0.29.) *Rejected:* fuzzy bodies (noisy and slow), and pgroonga (heavy, and it sits outside the rest of Postgres' FTS).
6. **Visibility goes before the limit, set-based where it can be.**
   - Notes get `notes__visible_ids(ws, actor)`: one recursive CTE down the tree (a root's rank from creator, grants and workspace sharing; `inherit` children take their parent's rank; the module ceiling applied once). It is proven equal to `can_access('note', …, 'view')` by a property test.
   - Types not yet set-based filter their text matches with their per-row rule **before** `LIMIT`, over a candidate set capped at 500 by rank. The 0.28 ms per 1,000 rows and the starvation numbers from CV-0 spike 5 make that safe at ≤ 10k rows per type.
   - Each module moves to a set when it adopts.

   *Rejected:* `share_visible_ids`, which runs `can_access` on every row of the type in the workspace on each keystroke; and limit-then-filter (today's MCP bug, `moduo-mcp/modules/notes.ts:300`).
7. **The actor is never a parameter.** Every `<module>__search`, and `registry__search`, is SECURITY DEFINER with `search_path = ''`. It resolves the actor with `perm_actor_id()` and the module ceiling with `module_api_key_scope` for keys or the member's module permission for people. Chat keys use `chat__key_channel_ids`. The module functions are granted to `authenticated` and `service_role`, never `anon`: the app calls them directly (the Notes sidebar), and so does the MCP through the service role with its key header. `search_all` is SECURITY INVOKER, granted the same way: it holds no privilege of its own, every hit comes from a module function that resolved the caller, it checks the context item with `perm_can_see_entity`, and it reads only `entity_links` itself (under the caller's RLS, and only to boost hits already returned). Grants are re-stated in every migration that DROPs or CREATEs (`.claude/rules/supabase.md`). (Amended in GS-3.)
8. **Ranking in `search_all`.** `score = 0.55·text + 0.15·recency + 0.20·personal + 0.10·context`.
   - `text` is the module rank, with title > body and handle = 1.0.
   - `recency` is a 30-day half-life on `updated_at`.
   - `personal` is the recents frecency from GS-8, 0 until then.
   - `context` is 1 when a spine link joins the hit to the item open now (the client passes `p_context_type/id`, which is checked for visibility).

   Rows are ordered by tier first, then by score: a task's exact handle, then exact hits, then typo-forgiven titles, so neither promise ("a task ID finds that task first", "typo forgiveness never beats an exact hit") depends on the weights. The Top result is the first row. The weights are constants in one SQL function, tuned against a fixture of 40 real-shaped queries in `search_all.test.sql`. *Rejected:* type weights (any fixed type order is wrong for someone), and an ML ranker.
9. **Snippets are built only for returned rows**, with `ts_headline(search_headline, left(body_text, 20000), q, 'MaxWords=24, MinWords=8, MaxFragments=1')`, in the outer query after the limit. *Why:* headline cost grows with document size.
10. **Notes' index.** `notes.search_tsv` is re-made as a generated column over `search__unaccent(title)` (weight A) and `search__unaccent(left(body_text,150000))` (weight B), with its GIN index rebuilt. Rebuilding 129 rows in prod is instant. The cold-body table split (architecture review P10) stays later; this contract hides it when it comes.
11. **Context lines** come from each module: the note's parent path (up to 2 ancestors, "… / Parent"), the task's project name, the contact's company, the event's start date, the message's conversation name. They are computed in SQL so the MCP gets the same text.
12. **The registry keeps its job, links and mentions, and stops being the search index.** `searchEntities` stays for the @/ref pickers. The palette moves to `search_all`. Until a type adopts the contract, `search_all` covers it through a `registry__search` adapter: an unaccented word-start match on `entities.label` (indexed), a task's handle (with the workspace's earlier keys), typo-forgiven labels by Assumption 5's rule, and visibility via `perm_can_see_entity` before the limit. It walks the matches best first and stops for a type at its limit or after 500 candidates, so a common word-start doesn't cost a check per match. A key sees only the types its scopes cover. Its limit is per type. Every type therefore appears from GS-3 on; context lines for registry types come when each type adopts (GS-4, GS-5).
13. **Projects get registered.** GS-4 adds `entities_op_upsert` to project create and rename. Today projects enter the registry only at link time, and their labels go stale (`20261017116000…:237`). (Amended in GS-4: a trigger on `buckets` makes the call on insert, rename, trash and restore, so the app's direct writes and duplicates count too; the system Inbox is never registered.)
14. **Recents are `search_recents (user_id, workspace_id, entity_type, entity_id, last_opened_at, open_count)`.**
    - Owner-only: clients may only read their own rows; every write goes through `search_op_record_open`, `search_op_forget_open` or `search_op_clear_recents` (amended in GS-8).
    - Pruned to 50 rows per user per workspace.
    - Covered by `account_erase_workspace_data` and `delete-account`.
    - The empty-query view reads 8 rows, each checked for visibility.

    *Why server-side:* Q12, "follows you across devices". *Rejected:* localStorage only, which can't follow you across devices.
15. **Email stays on the device.** The palette merges the desktop's existing local search (`features/email/search.ts` plus the Rust body scan) into the Email group, client-side. `search_all` returns only `email_refs` rows, owner-only. No mail body ever reaches Supabase (Email EM-3).
16. **The MCP gets one `search` tool** over `search_all` (limit ≤ 50, an optional `types` filter). The per-module `notes_search`, `contacts_search` and `tasks_search` tools stay, backed by their module's `__search`, so agents' existing calls keep working. The `sdk-parity` snapshot is updated.
17. **No embeddings, no in-app RAG, no GraphRAG** in this spec. This follows the product brief's MCP-only AI. The spine is used as a ranking signal (decision 8). Semantic recall is a separate product decision (Q25). If it comes, it lands as a per-module chunk table behind this same contract.
18. **Timeouts and bounds:** `search_all` runs under `statement_timeout = '5s'` (declared on the function; PostgREST applies it to the request, since Postgres itself ignores a function's own SET for the running statement), at most 8 rows per type (50 for "Show all" and MCP), and keyset paging is not needed at these limits. Each module is asked for 50 rows, so "Show all N" counts up to 50 ("Show all 50+" beyond).
19. **Tier.** Every block that ships a migration is Tier 2 (`scripts/ci/tier.ts`). The RLS matrix (`bun run db:matrix`) gains every new function.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| GS-1 | **Search primitives and the hit contract** | Migration: `pg_trgm` in `extensions`; `search__unaccent`, `search__query`, the `search_headline` config, `search__snippet` (decision 3). Contracts: `search.ts` (`SearchHit`), the `match` vocabulary. SQL and contract tests. No UI, Chat untouched. **Tier 2.** | AC2 | — |
| GS-2 | **Notes on the contract** | Migration: `notes.search_tsv` rebuilt unaccented, a trigram index on the title, `notes__visible_ids`, `notes__search` (snippet, parent path, rank, fuzzy fallback). The Notes sidebar search (`runtime.web.notes.ts:555`) and the MCP `notes_search` and `notes_list` move onto it (fixes limit-then-filter). Equivalence, behaviour and 10k performance tests. **Tier 2.** | AC1, AC2, AC3, AC4, AC8 (notes), AC10 | GS-1 |
| GS-3 | **`search_all` and the new palette** | Migration: `registry__search` adapter, `search_all` (ranking per decision 8, dedupe, per-type limits, context boost). Palette: Top result, fixed groups of 3, "Show all N", type chips with Tab, title highlight, context line, snippet, keep-results-while-typing, offline line. Replaces the registry ILIKE call; Chat keeps its own calls for now. Pure model tests, component tests, stories. **Tier 2.** | AC3, AC4, AC5, AC6, AC9 | GS-2 |
| GS-4 | **Tasks and projects on the contract** | Migration: a tasks tsv (title + description with HTML stripped) and a title trigram, `tasks__search` (handle first, project as context, `tasks__visible_to` before the limit), `projects__search`, project registry upsert on create and rename. `tasks_search` (RPC and MCP) backed by it. **Tier 2.** | AC1–AC4, AC6, AC8 (tasks) | GS-3 |
| GS-5 | **Contacts, companies and events on the contract** | Migration: `contacts__search`, `companies__search`, `events__search`. Private events are never matched for non-owners, and the calendar ceiling is applied once per set. MCP `contacts_search` backed by it. **Tier 2.** | AC1–AC4 | GS-3 |
| GS-6 | **Chat through the contract** | `chat__search_hits` (messages and conversations as `SearchHit`, with the conversation as context), `chat__search_query` delegating to `search__query`. The palette drops its separate chat calls and the Messages and Conversations groups come from `search_all`. The key path uses `chat__key_channel_ids`. **Tier 2.** | AC3, AC5 | GS-3 |
| GS-7 | **One MCP `search` tool** | The `search` tool over `search_all` (types filter, ≤ 50), its manifest entry, the sdk-parity snapshot, and key-scope tests. | AC11, AC3 | GS-3 |
| GS-8 | **Recents and personal ranking** | Migration: `search_recents`, `search_op_record_open`, pruning, erasure coverage. The client records an open on every `moduo:entity:open`. Empty-query *Recent*, plus the `personal` term in the ranking. **Tier 2.** | AC7 | GS-3 |
| GS-9 | **Email in the palette** | Desktop: local mail matches merged as the Email group, newest first, capped at 3 plus "Show all". Web: `email_refs` hits only. | AC12 | GS-3 |
| GS-10 | **Open a note at the match** | Opening a note from a body hit passes the query. The editor scrolls to the first match and highlights the word-starts until you click or type. The e2e smoke. | AC13, AC1, AC8 | GS-3 |

Order: GS-1 → GS-2 → GS-3. After GS-3, the rest can run in parallel. GS-4, GS-5 and GS-6 touch different modules' migrations, so give each its own timestamp.

## Out of scope

- Embeddings, semantic search, in-app answers, and LLM-built graphs (decision 17; Q25).
- Comments, attachments' file contents, and tag pages as result types (Q26–Q28).
- A query language beyond quotes and `-word` (DESIGN_BRIEF :233).
- Searching across workspaces (Q29).
- A separate search page or route (AGENTS.md rule 7: no new top-level routes).
- Polish stemming.
- Splitting the Notes hot and cold tables (architecture review P10).

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are filled and unambiguous.
- [x] **Every acceptance criterion has at least one test**, with its plain-English note.
- [x] **Open questions is empty.** All 35 product questions are answered (every recommendation accepted), and every technical unknown is decided above.
- [x] **The data model is named and Supabase-first.** New: the `pg_trgm` extension, the `search__*` primitives, the `<module>__search` functions, `search_all`, `registry__search`, `notes__visible_ids`, `search_recents`. Re-made: `notes.search_tsv`, plus a tasks tsv.
- [x] **Module feature:** this is platform search, not a module. The contract becomes a module-contract line once GS-3 lands: "a module answers `<module>__search`". The MCP tool is listed (GS-7), and there is no dashboard widget (Q30).
- [x] **Execution blocks** are decomposed and sequenced, each context-sized and self-contained.
- [x] **Design constraints acknowledged:** tokens only, the palette built on the existing `command.tsx` shadcn primitive, DESIGN_RULES R1–R10 (the highlight uses a token, not raw colour).
- [x] **Manual-test surfaces:** ⌘K on web and desktop, the Notes sidebar search, MCP `search` from Claude, offline (devtools offline).

## Product answers

Answered 2026-10-28 by Mike on Maciej's behalf, with his acceptance ("all rec"): every recommended answer below is the decision.

**Results and layout**
- [x] **Q1.** One "Top result" row above the groups? *Rec: yes*, the single best match across all types.
- [x] **Q2.** Group order: Tasks, Projects, Notes, Contacts, Events, Messages, Conversations, Email? *Rec: yes, fixed.* Ranking changes the order inside a group, never the order of groups.
- [x] **Q3.** How many rows per group before "Show all N"? *Rec: 3* (a: 3 · b: 5 · c: no cap, one scrolling list).
- [x] **Q4.** Actions ("New note", "Settings") when they match: *Rec: below the results* (a: below · b: above · c: only with an empty query).
- [x] **Q5.** The context line per type: note parent path, task project, contact company, event date, message conversation. *Rec: yes, all five.*
- [x] **Q6.** Show a snippet only when the match is in the body, not when it's in the title? *Rec: yes.*
- [x] **Q7.** Trashed items: *Rec: hidden* (a: hidden · b: shown last with a "Trash" tag).
- [x] **Q8.** Archived items (archived tasks, notes, projects): *Rec: shown in their group with an "Archived" tag, ranked lower.*

**Matching**
- [x] **Q9.** Forgive typos in titles ("meetng" → "Meeting"), only when exact matches are few? *Rec: yes, titles only.*
- [x] **Q9b.** Is it acceptable that "spotkania" doesn't find "spotkanie" (no Polish stemming), as long as "spotk" finds both? *Rec: yes, for now.*
- [x] **Q10.** Keep quotes for a phrase and `-word` to exclude, with nothing else (no `type:`, no `@person`)? *Rec: yes.* Chips do the filtering.

**Recent and personal**
- [x] **Q11.** With an empty ⌘K, show the last things you opened? *Rec: yes, 8 items.*
- [x] **Q12.** Should Recent follow you across devices, which means Moduo stores what you opened, privately, for you only? *Rec: yes.*
- [x] **Q13.** Can you clear your Recent, or remove one item from it? *Rec: yes, "Clear" on hover, one item at a time.*
- [x] **Q13b.** Should things you open often rank higher in results? *Rec: yes, gently, below text relevance.*

**Filtering and keys**
- [x] **Q14.** Type chips under the input (All · Tasks · Notes · Contacts · Events · Chat · Email)? *Rec: yes.*
- [x] **Q15.** Tab and Shift+Tab to move between chips? *Rec: yes.* ⌘1–⌘7 are not used, because they collide with navigation.

**Opening**
- [x] **Q16.** Opening a note from a body match: jump to and highlight the match? *Rec: yes* (GS-10). If not, the note opens at the top.
- [x] **Q16b.** Opening a chat message: jump to that message in its conversation, as Chat's Search does today? *Rec: yes.*
- [x] **Q16c.** Does ⌘K remember your last query when you reopen it? *Rec: no*, it opens empty with Recent. Chat's Search keeps its own memory.

**Email**
- [x] **Q17.** On web, where mail isn't available: show only threads already in Moduo (linked, snoozed, converted), with no hint about desktop? *Rec: yes.*
- [x] **Q17b.** On desktop: a mail group from your local mailboxes, newest first, 3 rows? *Rec: yes.*

**MCP (your own AI)**
- [x] **Q18.** One `search` tool for agents that sees exactly what the key may see? *Rec: yes.*
- [x] **Q19.** Does an agent's search count toward your Recent? *Rec: no.* Only your own opens count.

**States**
- [x] **Q20.** No results: offer "Search everything" when a chip is active, and nothing else? *Rec: yes.*
- [x] **Q21.** Offline: one quiet line plus what's on this device (actions, task IDs)? *Rec: yes.* There are no toasts.
- [x] **Q22.** A progress line only after 300 ms, never a spinner? *Rec: yes.*

**Privacy**
- [x] **Q23.** Someone else's private event: not searchable at all, not even as "Busy"? *Rec: yes, not searchable.*
- [x] **Q24.** Public channels you never joined: searchable? *Rec: yes, as Chat's Search does today.*

**Later or no**
- [x] **Q25.** Semantic search ("the note about the pricing call" with none of those words) would need an embedding model run inside Supabase. Not in this spec. *Rec: decide after open alpha, with usage data.*
- [x] **Q26.** Comments as results, opening the item at the comment? *Rec: not now.*
- [x] **Q27.** Attachment file names as results? *Rec: not now.*
- [x] **Q28.** Tags as results, opening the tag page? *Rec: not now*; the tag page doesn't exist yet.
- [x] **Q29.** Search across all your workspaces at once? *Rec: no*, the current workspace only.
- [x] **Q30.** A dashboard search widget? *Rec: no*, ⌘K is the one search.

## Open questions

- [x] (none)
