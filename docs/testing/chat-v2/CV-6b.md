# Manual test checklist — CV-6b One device rings

> Generated 2026-10-15 · branch `t/maciej/cv-checkpoint-3`, folded from the record [`CV-6b`](../../build/chat-v2/CV-6b.md) (block branch `t/maciej/cv-6b-device-rings`) · **Live-verified:** no. Client-only; `tests/chat-notify.spec.ts` (2 passed) simulates the desktop with a stub; a real Web Push and two real clients were not exercised.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** `PUBLIC_VAPID_PUBLIC_KEY=<any P-256 public key, base64url> scripts/agent/e2e.sh tests/chat-notify.spec.ts` → **Expect:** 2 passed _(terminal)_

## Desktop and browser

- [ ] **Do:** desktop app on Chat in workspace A; a teammate DMs you there → **Expect:** no notification and no browser notice; the message appears _(desktop + browser)_
- [ ] **Do:** desktop on Tasks, a browser tab in the background → **Expect:** one desktop notification "Sofia · A"; nothing in the browser _(desktop)_
- [ ] **Do:** three quick DMs, then a fourth more than a minute after the first notice → **Expect:** one notification, then one "… · 4 messages: <text>" (Show message text off: "4 messages") _(desktop)_
- [ ] **Do:** desktop on Tasks rings; switch to another app and back within 10 s → **Expect:** Moduo stays on Tasks (a click lands only when it rang from the background) _(desktop)_
- [ ] **Do:** desktop on Chat of that workspace, untouched for 5+ minutes, then a DM → **Expect:** it rings (idle isn't in front) _(desktop)_
- [ ] **Do:** browser tab focused and used, desktop in the background → **Expect:** the desktop stays silent; the browser's push rings after about 8 s _(desktop + browser)_
- [ ] **Do:** a DM in workspace B while in A → **Expect:** the notification says B; click it → Moduo opens B on that message; a running Focus keeps running _(desktop)_
- [ ] **Do:** desktop quit, browser tab in the background with notifications on → **Expect:** after about 8 s a browser notification; click → the message _(browser)_
- [ ] **Do:** first Chat open in a fresh browser → **Expect:** "Get a notice when someone messages you · Allow · Not now"; reload → not asked again _(browser)_
- [ ] **Do:** refuse in the browser → **Expect:** Settings → Preferences reads "Not allowed by the browser" _(browser)_
- [ ] **Do:** Settings → Preferences → Chat → Sound on → **Expect:** a DM rings with a soft sound; off → silent _(desktop)_
- [ ] **Do:** Show message text off → **Expect:** the next notification has no text _(desktop/browser)_
- [ ] **Do:** look at the dock badge and the workspace switcher → **Expect:** the badge is the sum of Catch up items across workspaces and the switcher shows each _(desktop)_

## Verify before release

- [ ] **Do:** with a desktop and a browser, prove exactly one rings in each case above (round-3 §5 risk 7) → **Expect:** one ring per case _(two real clients)_
- [ ] **Do:** build the desktop app → **Expect:** the capability `core:window:allow-set-badge-count` is accepted _(desktop build)_
- [ ] **Do:** with the new `push-sw.js`, a chat push while a Moduo tab is focused on Tasks → **Expect:** it shows _(browser)_

## Known gaps / not-yet-testable

- Builds from before CV-6b never stamp `user_clients` nor acknowledge chat rows, so they neither ring chat notices nor block the browser's.
- The switches silence only what the latest open client shows; the server doesn't read them yet (CV-18 or its owner). The Windows taskbar overlay isn't built.
- A client clock 8 s or more off changes which notices ring; a client never focused is never "latest".

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-6b](../../build/chat-v2/CV-6b.md).*
