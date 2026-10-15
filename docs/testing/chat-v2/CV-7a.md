# Manual test checklist — CV-7a The stream

> Generated 2026-10-15 · branch `t/maciej/cv-checkpoint-3`, folded from the record [`CV-7a`](../../build/chat-v2/CV-7a.md) (block branch `t/maciej/cv-7a-stream`) · **Live-verified:** partly. `tests/chat-stream.spec.ts` (5/5), the perf spec (1/1) and the visual spec (1/1) passed on a Chromium dev build; a production build in WKWebView with a trackpad was not run. Client-only, no migration.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** `scripts/agent/e2e.sh tests/chat-stream.spec.ts` → **Expect:** 5 passed _(terminal)_

## In Chat

- [ ] **Do:** open a busy channel; scroll up a few screens and have someone post → **Expect:** it opens at the newest; "1 new ↓" appears and nothing moves; click it → you're at the bottom _(Chat)_
- [ ] **Do:** open a link to an old message (`/chat?c=…&m=…`) → **Expect:** the message is lit in the middle with "Viewing messages from …" at the bottom; Jump to present → newest _(Chat)_
- [ ] **Do:** hover a message → **Expect:** the toolbar floats over its top edge (👍 ✅ 👀 · Reply · Task · ⋯); right-click → the menu with six reactions _(Chat)_
- [ ] **Do:** ↑ in an empty composer → **Expect:** your last message opens for editing; ⏎ saves with "(edited)"; Esc cancels _(Chat)_
- [ ] **Do:** delete your message → **Expect:** it vanishes with "Deleted · Undo"; Undo brings it back; let it go → it's gone for the other person after 8 s _(Chat, two browsers)_
- [ ] **Do:** turn the network off and send → **Expect:** "Waiting to send"; back on → sent once _(Chat)_
- [ ] **Do:** switch density (dense, compact, comfortable) while reading history → **Expect:** the line you're reading stays put _(Chat)_
- [ ] **Do:** send just "🎉" → **Expect:** it draws large _(Chat)_
- [ ] **Do:** select a message with ↑↓ and press R, E, +, P, T, ⌘⌫, ⏎, Esc → **Expect:** reply opens the chain, edit (own), the six reactions, pin, the capture, delete with Undo, back to the composer _(Chat)_

## Edge cases

- [ ] **Do:** a refused send (plan paused) → **Expect:** "Not sent · Retry · Delete"; Retry sends once allowed _(Chat)_
- [ ] **Do:** let Undo's toast sit under a hover or in a hidden tab → **Expect:** the server delete runs only when the toast closes _(Chat)_
- [ ] **Do:** send while scrolled up → **Expect:** you land on your own message at the newest _(Chat)_

## Verify before release

- [ ] **Do:** run the perf budgets on a production build in the desktop app (WKWebView) with a real trackpad → **Expect:** warm open ≤ 100 ms, own message ≤ 50 ms, worst frame ≤ 50 ms, no anchor drift _(desktop app)_
- [ ] **Do:** read the stream in two tabs → **Expect:** the read mark (the last message wholly on screen in either) moves forward only _(Chat)_
- [ ] **Do:** change a task from another session, watch its chip in a message on the real project → **Expect:** it updates live (locally a service-role change took over 20 s) _(prod)_

## Known gaps / not-yet-testable

- The deep-link e2e target isn't a reply; opening a chain panel is CV-12's. Feed a11y is finished by CV-7b.
- ⇧D (decision), H (remind me), Make a note and Move wait for CV-13 to CV-16.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-7a](../../build/chat-v2/CV-7a.md).*
