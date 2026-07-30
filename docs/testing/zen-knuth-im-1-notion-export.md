# Manual test checklist — IM-1 Notion export hardening

> Generated 2026-07-30 · branch `t/maciej/im-1-notion-export` · **Live-verified: partial.** `bun run verify` **1294** green (the 7 AC tests run against **real fflate-built zips**, including the exact nested `Part-N` shape, not mocks); the app boots in a real browser with **zero console errors** so the new modules bundle; and the new `Progress` primitive was measured in-browser (42% of a 200px track renders exactly 84px, 6px tall, `--motion-fast`/`--ease-out` resolving). **The import dialog itself was not driven** — it needs a signed-in workspace and your real export. This checklist is that confirmation.
> Run on **web or desktop**. You'll need your actual Notion export.

## The headline — drop the file exactly as downloaded
- [ ] **Do:** Export from Notion (Settings → Export → Markdown & CSV, *include subpages*). Drop the `Export-<uuid>.zip` into Moduo's note importer **without unzipping anything**. → **Expect:** The preview shows your pages — roughly 350 of them. _(Before this change it showed **zero**: the download is a zip containing another zip, and the reader only looked one level in.)_ _(both)_
- [ ] **Do:** Look at the top of the preview tree. → **Expect:** Your real top-level pages. **No** `Export-<uuid>` note, **no** `Private & Shared` note, **no** `Part 1` note. _(both)_
- [ ] **Do:** Scroll into a deeply nested branch. → **Expect:** Indentation matches Notion — nesting survives to at least 9 levels, and a page whose parent is missing sits at the root rather than disappearing. _(both)_
- [ ] **Do:** Check the skipped line under the preview. → **Expect:** A breakdown by kind, e.g. "Skipped 3 CSVs · 15 images" — not a bare number. _(both)_
- [ ] **Do:** Click Import and watch. → **Expect:** A determinate progress bar with "Imported N of 350…" that advances, then a toast with the counts. It should complete without truncating. _(both)_
- [ ] **Do:** After importing, open a handful of pages — especially ones with links, bold, checklists and headings. → **Expect:** They render properly, and still render after a hard reload. _(both)_

## Re-running (the duplicate trap)
- [ ] **Do:** Import the **same export a second time**. → **Expect:** Toast says roughly "Imported 0 notes · 350 already imported". **Your tree must not double.** _(This is the one that used to be broken: ids were random, so every re-run inserted a second copy of everything.)_ _(both)_
- [ ] **Do:** Interrupt an import (close the tab mid-way), then re-drop the same export. → **Expect:** It resumes — the pages that already landed are skipped, the rest import. No duplicates. _(both)_
- [ ] **Do:** In Notion, **move** a page to a different parent, re-export, and import again. → **Expect:** The moved page is recognised as the same page (not a second copy). It keeps its original location in Moduo — the import doesn't re-parent it. _(both)_
- [ ] **Do:** Add one new top-level teamspace/page in Notion, re-export, import. → **Expect:** Only the new page imports. The other 350 are recognised as already imported. _(both)_

## Multi-part exports
- [ ] **Do:** If your export splits into `Part-1` / `Part-2`…, drop **all parts together**. → **Expect:** One merged tree with parent/child edges intact across parts. _(both)_
- [ ] **Do:** Now try dropping the parts **one at a time**, in order. → **Expect:** Each part imports; nothing duplicates. A page whose parent lives in a part you haven't dropped yet sits at the root until that part arrives — **but it is not duplicated** when the other part lands. _(both)_

## Edge cases
- [ ] **Do:** Find two Notion pages with the **same title** under the same parent (very common — "Meeting notes"). Import and check both are present. → **Expect:** Both import as separate notes. _(They used to collapse into one: the id was derived from the cleaned filename, and same-title siblings clean to the same thing. Notion appends a 32-hex page id precisely because titles repeat — that's what the id now keys on.)_ _(both)_
- [ ] **Do:** Drop a **damaged/truncated zip** alongside a good one. → **Expect:** The good one still imports; the broken one is reported as skipped. The whole drop must not fail. _(both)_
- [ ] **Do:** Drop a loose `.md` file and a `.png` together. → **Expect:** The markdown imports, the image is counted as skipped, and no empty note is created for it. _(both)_
- [ ] **Do:** Turn on **Reduce motion** (System Settings → Accessibility → Display) and run an import. → **Expect:** The progress bar jumps rather than sliding. _(both)_

## Migrations / data
- [ ] Nothing to do — **no SQL migration, no schema change.** It rides the already-shipped `notes_op_import` RPC. The only behavioural change server-side is that row ids are now deterministic, which is what makes the op's existing per-row idempotency reachable.

## Known gaps / not-yet-testable
- **The dialog was never driven end to end here** — no signed-in workspace and no copy of your export. Everything below the unit tests is your pass.
- **Untitled pages are not counted separately.** The sample export has ~4 pages whose name cleans to empty; they import as "Untitled" and are not called out in the summary. They *are* given distinct ids, so none is lost.
- **A blank parent page flattens its children to the root.** An empty `Home.md` is skipped as an empty file, so its subtree attaches to the root instead. Reported as "1 empty file" — the children are not lost, just re-parented.
- **A note you imported and then binned cannot be re-imported.** The server's id-exists check ignores `deleted_at`, so re-dropping the export skips it silently.
- **The progress bar sits at 0 during the longest phase.** Building 350 CRDT documents happens synchronously *before* the first network chunk, so the bar only starts moving after that. It also counts rows *attempted*, so a re-import shows 100% while importing nothing.
- **The zip nesting bound is not a zip-bomb defence.** It stops at two archives deep, but `unzipSync` still materializes every entry eagerly on the main thread with no size or ratio cap.
- **`notes.list` has no explicit limit** (SCALE-1's soft edge), so a workspace past 1000 notes silently truncates on read-back — which would also truncate the `existingRootPositions` the import appends after. Not introduced here, but IM-1 is what gets you near that number.
- **Windows-written zips** (backslash separators) are normalized, but untested against a real one.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
