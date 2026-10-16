# Manual test checklist — CV-7b The composer

> Generated 2026-10-15 · branch `t/maciej/cv-checkpoint-3`, folded from the record [`CV-7b`](../../build/chat-v2/CV-7b.md) (block branch `t/maciej/cv-7b-composer`) · **Live-verified:** partly. `tests/chat-keys.spec.ts` (4/4) and `tests/chat-stream.spec.ts` (5/5) passed, and the composer was screenshot-compared against round 5 frame 5 and round 4 frame 3; a real IME check was not run. Client-only, no migration.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** `scripts/agent/e2e.sh tests/chat-keys.spec.ts tests/chat-stream.spec.ts` → **Expect:** 4 and 5 passed _(terminal)_

## In Chat

- [ ] **Do:** open a channel and just type → **Expect:** the text goes into the composer _(Chat)_
- [ ] **Do:** type a long paragraph, then clear it → **Expect:** past one line the tools drop below; cleared, back to one row _(Chat)_
- [ ] **Do:** type `**bold**`, `` `code` ``, `> quote`; select text → **Expect:** they format as you type; B I S `<>` float above the selection _(Chat)_
- [ ] **Do:** `@Mi`, Tab, send → **Expect:** people first; a chip "@Mike Chen"; Mike is mentioned _(Chat)_
- [ ] **Do:** `/task Order frames` ⏎ → **Expect:** the capture opens as Task with "Order frames"; ⏎ → the task's chip appears in the composer _(Chat)_
- [ ] **Do:** press T on someone's message → **Expect:** the capture opens with its words _(Chat)_
- [ ] **Do:** `+` → Link something → pick a task; `+` → Create → Note → **Expect:** a chip; the capture as Note _(Chat)_
- [ ] **Do:** Emoji button, search "party", pick; type `:thu` → **Expect:** 🎉 at the caret; 👍 _(Chat)_
- [ ] **Do:** paste from Google Docs → **Expect:** text, lines and links only, no fonts _(Chat)_
- [ ] **Do:** write a draft, switch conversation and back (or reload) → **Expect:** the draft is there _(Chat)_
- [ ] **Do:** ↑ in an empty composer → **Expect:** your last message opens with its chips and code; ⏎ saves; Esc cancels _(Chat)_

## Edge cases

- [ ] **Do:** a message over 8,000 characters → **Expect:** refused with the count (a counter shows from 7,500) _(Chat)_
- [ ] **Do:** type `@channel` without the switch → **Expect:** it posts as typed and the composer says why once _(Chat)_
- [ ] **Do:** keep a Task capture draft, press T on a message, Esc → **Expect:** your kept draft is unchanged; a refused prefilled capture comes back through Restore _(Chat)_

## Verify before release

- [ ] **Do:** Japanese or Polish IME, ⏎ to commit a candidate (keyCode 229) with a menu open, in Safari and the desktop app (WKWebView) → **Expect:** ⏎ doesn't send; ⏎ again sends _(desktop app)_
- [ ] **Do:** emoji on Windows (flag font) and older macOS (Emoji 15 cut-off) → **Expect:** newer emoji may draw as boxes; note which _(Windows, old macOS)_

## Known gaps / not-yet-testable

- After Esc on a restored capture while another draft is kept, the refused one waits on the device with no way back until the kept draft is made or cleared (the designer's call, not built).
- No `@Team` and no drag-from-panel in the composer yet; the typed handle chip (`MOD-142`) and the Message capture's "From:" chip are CV-10's; `/remind` is CV-14's; files are CV-9's.
- A multi-line paste in the capture makes several tasks and reports none back to chat.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-7b](../../build/chat-v2/CV-7b.md).*
