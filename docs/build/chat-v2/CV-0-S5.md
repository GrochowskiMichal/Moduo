# CV-0-S5 — Spike 5: message search at 100,000 messages

> Branch `t/maciej/cv-0-s5-search` · head: the commit that adds this file (base `e066e2d6`) · status: built, not landed
> Migration: none. Draft SQL for CV-1 and CV-19 in [`drafts/search.sql`](drafts/search.sql); the 100,000-row fixture generator in [`drafts/search-fixture.py`](drafts/search-fixture.py). `unaccent` is now installed on the local stack (schema `extensions`; CV-1 needs it anyway). The scratch schema `spike_s5` is dropped; nothing in `public` was written.

## Delivered against the row

Spec Assumption #9 and round-3 §2.5 hold: `simple` + the immutable `chat__unaccent` wrapper + a stored generated `search_tsv` + a partial GIN index are fast enough by a wide margin (p95 4.3 ms against a 150 ms bar). Two things change in how `chat_search` is built, both measured below: the read rule is applied **once per call as the set of readable conversations inside the indexed query** (not per match), and the snippet uses a **display-only text search config** so "żółw" is highlighted for "zolw".

**Set-up (local stack, Postgres 17.11, 18-core Mac, shared_buffers 128 MB, warm):** a copy of `chat_messages`' shape plus `body_text`, the wrapper, the generated column, the GIN index and the round-3 `(channel_id, created_at, id)` btree; stand-in tables for workspace members, channels and channel members, and a stand-in read rule with `chat_can_read_channel`'s shape (workspace member, then public-or-member). The fixture (`search-fixture.py`, seeded): 100,000 messages in 3 workspaces (60 / 30 / 10 k), 50 conversations (34 public channels, 7 private, 9 DMs), Zipf traffic per channel, Polish and English work chat with diacritics plus a long Zipf tail (36,135 distinct lexemes), 1,180 deleted rows, v1 tokens (`<@uuid>`, `<!channel>`, `<moduo:…|label>`) stripped from `body_text`. Workspace 1's private `ops` carries most of the newest 15 % of its traffic (the starvation case). Heap 51 MB, GIN 8 MB.

## Pass bars

| # | Bar | Measured | Result |
| --- | --- | --- | --- |
| 1 | `create extension if not exists unaccent with schema extensions` on the local stack | `unaccent 1.1` in `extensions` | **pass** |
| 2 | scratch schema with the shape, wrapper, column, index; 100,000 PL/EN messages, ~50 channels, 3 workspaces, a membership stand-in | as above, never in `public` | **pass** |
| 3a | p95 ≤ 150 ms, 1–3 words, 200 mixed queries | warm: **p50 2.47 · p95 4.31 · p99 5.92 · max 7.18 ms**; cold first pass: p50 2.48 · p95 5.35 · max 20.9 ms. By words: 1 → p95 4.31, 2 → 4.40, 3 → 3.91. By kind (p95): common 5.93, prefix 4.47, two-word 4.47, three-word 3.77, mid 3.61, special 3.48, unaccented 3.18, rare 3.02 | **pass** |
| 3b | "zolw" finds "żółw" | 2,968 rows, every one containing "żółw"; typing "żółw" returns the same 2,968 | **pass** |
| 3c | "zadan" finds "zadania" and "zadaniem" | 11,252 rows: zadaniem 3,015 · zadania 2,916 · zadań 2,909 · zadanie 1,506 · zadaniu 1,447; equal to an unaccented `\mzadan` regex over the corpus | **pass** |
| 3d | a 2-letter prefix handled sanely | words of 3+ letters are prefixes; 1–2-letter words match whole words only (choice below) | **pass** |
| 4a | a private channel's message never reaches a non-member | 200 queries × 4 callers against workspace 1: member 6,761 rows (3,045 from private `ops`), plain member of other channels 6,616 rows (0 from `ops`), member of another workspace 0, nobody 0; **0 rows from an unreadable conversation**. Scoped to `ops` (`p_channel_id`) by the plain member: 0; by its member: 50 | **pass** |
| 4b | "index first, then filter, until the limit" doesn't starve | readable-set prefilter: 50 rows in **2.2 / 2.4 / 3.0 ms** with 500 / 5,000 / 20,000 unreadable newest matches (table below) | **pass** (strategy C) |
| 5a | ≤ 1 ms added per insert | 10,000 single-row inserts × 3 rounds: plain 15.4 µs, + generated column **+15.8 µs**, + column and GIN (fastupdate, default) **+17.5 µs**, + column and GIN with fastupdate off +41.1 µs | **pass** |
| 5b | backfill of the research workspace's 3,032 real rows ≤ 1 s | CV-1's shape (rows first, then the columns): add `body_text` 0.4 ms + fill it 21 ms + add the generated column 15 ms + GIN 5 ms + commit 4.5 ms = **46 ms**; straight `INSERT … SELECT` into a table that already has both: 38 ms | **pass** |
| 6 | drop `spike_s5`; draft CV-1 and CV-19 SQL | dropped (28 objects, `chat_headline` config included); drafts in `drafts/` | **pass** |

The draft itself (`drafts/search.sql`, with `public.` rewritten to the scratch schema and stand-ins for `chat_can_access_workspace`, `perm_can_view`, `perm_actor_id`, `chat_can_read_channel` reading `request.jwt.claims` like the real ones) was loaded and re-run: the same rows for every caller, 0 unreadable rows, readable-set parity with the read rule 0 mismatches over 5 callers × 50 conversations, 50 of 50 "zolw" snippets highlight "żółw", p95 5.6–6.4 ms, no session → no rows.

## Query plans (EXPLAIN ANALYZE, BUFFERS)

Every query takes the same plan: Bitmap Index Scan on the partial GIN → Bitmap Heap Scan with `channel_id = any(readable)` as a filter → top-N heapsort → limit 50; `ts_headline` runs on the 50 rows only.

- **Common word** "the" (35,252 matches in all workspaces, 12,131 readable): index scan 1.9 ms on 13 buffers; heap 6,305 blocks, 23,121 rows removed by the channel filter; **10.0 ms**, 6,324 buffers hit.
- **Rare word** (3 matches): 7 buffers, **0.03 ms**.
- **Prefix** "zadan" (5 lexemes, 11,252 matches): **5.4 ms**, 4,960 buffers.
- The cost driver is the number of matching rows (heap visits, ~0.28 ms per 1,000), not the prefix expansion: "the" (3 lexemes, 35 k rows) costs more than "po" (796 lexemes, 21 k rows). A GIN pending list of 5,000 fresh rows changed nothing measurable (the: 10.6 → 7.9 → 6.9 ms before / pending / after vacuum).

## Agent's choices (deferred to by Maciej: confirmed for building, may be reconsidered)

- **Minimum prefix length 3; shorter words match whole words only:** "zad" finds zadania, "za" finds only the word "za", "ok"/"UI"/"PR" stay findable. Why: at 100,000 rows every variant passes the bar (even a 1-letter prefix took 10–13 ms), so the choice is about meaning and growth. A 2-letter prefix matched 20–38 % of all rows ("pr" 30,117 rows, "th" 38,145, "za" 20,659 vs 2,974 exact), so newest-first shows near-arbitrary messages, and the cost grows with matched rows (a 2-letter prefix in a 1M-message workspace would land near 100 ms). Rejected: prefixes from 2 letters (noise, and cost that grows with the workspace); dropping short words (loses "ok", "UI", "QA", "PR"); only the last word a prefix (the spec makes each word a prefix). The client may still choose to start ⌘K's Messages at 2 characters: the server takes any input.

  | query | lexemes it expands to | rows matched | median ms |
  | --- | --- | --- | --- |
  | `z` prefix / exact | 2,451 / 1 | 54,700 / 10,130 | 10.5 / 3.4 |
  | `pr` prefix | 107 | 30,117 | 8.6 |
  | `th` prefix | 12 | 38,145 | 7.3 |
  | `za` prefix / exact | 36 / 1 | 20,659 / 2,974 | 5.7 / 2.0 |
  | `po` prefix / exact | 796 / 1 | 21,541 / 4,344 | 6.5 / 2.3 |
  | `zad` prefix | 5 | 11,252 | 4.3 |
  | `pod` prefix | 64 | 6,667 | 3.4 |
  | any 1–2-letter prefix AND a rarer word | — | 1–30 | 1.4–3.7 |

- **The read rule applied as a set, inside the indexed query (strategy C):** `chat_search` computes the caller's readable conversations in the workspace once and filters `channel_id = any(…)` in the GIN query, so the 50 rows it returns are the newest 50 readable ones however many unreadable matches are newer. Why: round-3 §2.5's per-match loop (the `tasks_search` pattern) is linear in the unreadable newer matches, and the real `chat_can_read_channel` costs **~83 µs a call** (measured read-only as a research-workspace member, with the plan check short-circuiting, so a lower bound); a candidate cap makes it starve. Rejected: A, the per-match loop; B, the loop with a cap.

  | newest matches the caller can't read (300 readable older ones exist) | A loop, stand-in rule (4 µs) | A loop, real rule's cost | B loop, cap 500 / 2,000 | C readable set |
  | --- | --- | --- | --- | --- |
  | 0 | — | 7.5 ms | — | 0.9 ms |
  | 500 | 4.2 ms | **80 ms** | **0 rows** / 50 rows | 2.2 ms |
  | 5,000 | 20.8 ms | **713 ms** | **0 rows** / **0 rows** | 2.4 ms |
  | 20,000 | 70.9 ms | **2,812 ms** | **0 rows** / **0 rows** | 3.0 ms |

- **The readable set is set-based, guarded by a parity test:** `chat__readable_channel_ids(ws)` runs the workspace gate once (as InitPlans) and the per-conversation part as one query; a test asserts it equals `chat_can_read_channel` for every caller and conversation. Why: calling `chat_can_read_channel` per conversation costs ~83 µs each (4 ms at 50 conversations, ~170 ms at 2,025, e.g. a 100-person hackathon workspace's DMs); the set-based form took 0.7 ms at 2,025 and `= any` over 2,025 ids stayed at 2–3 ms of filter. Rejected: per-conversation calls (simplest, no duplicated logic, but they scale with DMs); a semi-join on the set (a generic plan after the 3rd call doubled it to 20 ms).
- **A display-only text search config for the snippet** (`chat_headline`: `simple` with `unaccent` as a filter for `word`, `hword`, `hword_part`), the index keeping the specced wrapper. Why: `ts_headline('simple', body_text, 'zolw':*)` can't match "żółw", so the snippet showed the message's first words with no mark; with the config every snippet highlights (50 of 50), and its lexemes and positions equal `search_tsv` on all 100,000 rows. Rejected: a headline over `chat__unaccent(body_text)` (the snippet loses Polish letters); the config for the index too (it tokenizes before unaccenting, so it depends on the database's ctype; the wrapper doesn't). This adds an object to Assumption #9; it doesn't change it.
- **Snippet markers are U+E000 / U+E001, not HTML:** the client splits on them and renders text nodes. Why: `body_text` is what people typed; `<b>` markers would make every drawing of the snippet an escaping problem. Rejected: `<b>`/`<mark>`; offsets (`ts_headline` gives none).
- **Keyset paging by `(p_before, p_before_id)`:** the next page passes the last row's `(created_at, message_id)`; three pages of 50 gave 150 distinct rows equal to the first 150 of one ordered query. Why: the spec's `before?` alone repeats or skips rows that share a timestamp at a page boundary (the stream's own rule, AC1.4). Rejected: offset; a timestamp alone.
- **FilterBar's "from" and the date's lower bound are parameters now** (`p_from`, `p_after`, same plan, 5 ms); "has a file" waits for CV-9's table.
- **The query builder:** `websearch_to_tsquery('simple', chat__unaccent(left(q, 256)))`, then each quoted lexeme of 3+ letters after a start, space or `(` gets `:*` (a negated word stays exact: "-test" doesn't exclude "testy"); punctuation-only input → null → no rows; if the rewritten text ever fails to cast, the plain query is used, so user input never raises. Checked on `''`, `' - '`, `!!!`, `<-> & | !`, `a:* & b | !c <-> d`, backslashes, an unclosed quote, emoji, `ﬁnal ½`, `C++ C#`, a URL and 200 repeated words.
- **The wrapper:** SQL-standard body with `set search_path = ''`. Per row over the corpus: `to_tsvector` alone 4.5 µs, the wrapper ~1 µs more, the `SET` clause ≤ 0.2 µs (noise). Rejected: no `SET` (the Supabase linter flags it for nothing).

## Gotchas (area: supabase · agent)

- **supabase:** a regex that adds `:*` to tsquery text must anchor on the lexeme's opening quote (start, space or `(`): the naive `'([^']{3,})'` matched the gap between two lexemes and produced `'na' <-> ':*jutro'`.
- **supabase:** `ts_headline` with `simple` never highlights an unaccented match ("zolw" → "żółw"); use a config that unaccents per token for the headline only.
- **supabase:** `simple` parses "MOD-142" as `mod` + `-142` and "2026-10-14" as `2026`, `-10`, `-14`: "142" alone doesn't find "MOD-142". Low impact (a typed task key becomes a reference, and references add no words), but say it if someone reports it.
- **supabase:** on the local stack the research workspace's owner is on Free, so `chat_can_read_channel` returns false for everyone there until CV-1 drops the plan from reads; tests of the real read rule need a plan or CV-1's body.
- **supabase:** never call `chat_can_read_channel` per message in a loop (~83 µs a call); per conversation is fine for tens, not thousands.
- **agent:** the worktree guard refuses heredocs, compound `cd … &&` commands and computed arguments in Bash: write SQL to a file with the Write tool and run `psql -X -f <absolute path>`.

## For later blocks

- **CV-1:** part 1 of `drafts/search.sql` (extension, wrapper, `body_text`, `search_tsv`, GIN). The table rewrite takes 0.8 s and the index 0.3 s at 100,000 rows locally: run it with `set local lock_timeout = '5s'` at the train's quiet hour. `body_text` must never hold a person's id or a reference's label (spike 4's stripping rules), which is what keeps people out of message-text search. `search_tsv` averages 202 bytes a row (body 107) and the `supabase_realtime` publication ships every column of `chat_messages` today: give it a column list without `search_tsv` (and decide `body_text`) with §2.7's Realtime design, and never `select *` in the store. When re-scoping `chat_can_read_channel` (no plan, people who left, deleted channels), keep the workspace gate and the per-conversation part separable so `chat__readable_channel_ids` mirrors it exactly.
- **CV-19:** part 2 of `drafts/search.sql`, rebuilt from CV-1's live `chat_can_read_channel`; the test list at the end of the draft (parity, starvation with 20,000 unreadable newest matches, callers, edge inputs, paging, the 100,000-row timing with `search-fixture.py`). ⌘K calls with `p_limit 5`; an error reads "Search isn't available", never "No messages match" (AC1.10). The spike's numbers are an 18-core Mac with the 75 MB table and index in shared_buffers: re-measure p95 on the real instance before calling the bar met in prod.
- **CV-21:** in `chat__readable_channel_ids`, a key reads as its creator (`perm_actor_id()`): public channels, private ones the creator is in only with the key's switch, never a DM (the hook is a comment in the draft).
- **CV-15:** `chat_channels.deleted_at` drops a channel out of the readable set; an archived channel stays searchable.
- **CV-9:** "has a file" joins the files table in the same query.
- **Scale path (not needed now):** cost grows with matching rows, so a workspace past ~1M messages could push very common words toward the bar; then add RUM (orders by `created_at` inside the index) or `btree_gin` on `(workspace_id, search_tsv)`. Both are available on the local stack.

## Manual checklist (step → expect → surface)

No UI in this spike; for CV-19's checklist:

- [ ] ⌘K, type "zolw" → messages with "żółw", the word highlighted → ⌘K Messages
- [ ] type "za", then "zad" → whole-word "za" first, then zadania, zadaniem, zadań → Chat's Search
- [ ] as someone outside a private channel, search a word only it contains → nothing, also with "in: that channel" → Chat's Search
- [ ] scroll to the bottom of a long result list → the next page continues with no repeat or gap → Chat's Search

## Verify before release

- `unaccent` is in prod's `pg_available_extensions` before CV-1 applies (risk 10).
- On prod, `select alias from ts_debug('public.chat_headline', 'żółw')` gives one `word` token (the headline config tokenizes accented text; the index doesn't depend on it).
- The CV-1 rewrite's lock time at prod's row count (0.8 s per 100,000 rows locally).
- `chat_search` p95 on the real instance with the 100,000-row fixture (≤ 150 ms).
