# Manual test checklist — CV-8b The panel and the dialogs

> Generated 2026-10-16 · branch `t/maciej/cv-checkpoint-4`, folded from the record [`CV-8b`](../../build/chat-v2/CV-8b.md) (block branch `t/maciej/cv-8b-panel-dialogs`, landed `48035483`) · **Live-verified:** by `tests/chat-details.spec.ts` and the unit tests; the steps below are the human pass. No migration.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## In the app

- [ ] **Do:** open a channel → **Expect:** the right panel shows Details: About, Linked to, People (you first, a green dot for who's online), Your notifications, Reply chains, Decisions, Pinned, History _(web)_
- [ ] **Do:** change Notify me to Nothing → **Expect:** the left panel's row stops counting; Details shows Nothing _(web)_
- [ ] **Do:** turn Pin to sidebar on → **Expect:** a Pinned section appears in the left panel _(web)_
- [ ] **Do:** pin a message → **Expect:** it appears under Pinned and "You pinned a message" in History _(web)_
- [ ] **Do:** click a pinned message → **Expect:** "← Details" with the message lit and ten around it; Open in conversation lands on it _(web)_
- [ ] **Do:** hover a message author's name, then click it → **Expect:** a card on hover; the card in the panel on click; Message opens your DM _(web)_
- [ ] **Do:** ⌘N → **Expect:** New conversation; make a channel with a person, Private off; it opens and both see it _(web)_
- [ ] **Do:** New conversation → Direct message → pick only yourself → **Expect:** "Capture a note" opens the capture as a note _(web)_
- [ ] **Do:** hairline ⋯ → Browse channels → Join a public channel → **Expect:** it opens and joins the left panel _(web)_
- [ ] **Do:** as a viewer → **Expect:** no "New conversation", no Archive, no Message on cards; Notify me still works _(web)_
- [ ] **Do:** leave a channel, come back to a conversation you'd read → **Expect:** the "New" pill sits where you stopped _(web)_

## Verify before release

- [ ] **Do:** on staging, a member of a private channel and a non-member open its Details → **Expect:** the member sees its history, the non-member doesn't (History reads `module_activity` under its existing rule) _(staging)_
- [ ] **Do:** a workspace with more than 100 public channels → **Expect:** Browse counts correct (`memberCounts` batches by 100 and pages 1,000 rows) _(staging)_
- [ ] **Do:** watch the request count in a busy channel → **Expect:** Details re-reads members, pins and history only on pins, edits, deletes and event lines (three small reads) _(staging)_

## Known gaps / not-yet-testable

- The author name in the stream isn't a keyboard stop; the New conversation people picker has no combobox semantics (↵ adds the first match); History reads the newest 50; a failed read shows the empty line, not an error; on a warm reopen of a short conversation the "Today" separator once overlapped the start block in a screenshot (not reproduced).

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-8b](../../build/chat-v2/CV-8b.md).*
