# Manual test checklist — app analytics: safe by default + consent gate

> Generated 2026-10-07 · branch `t/maciej/app-analytics-consent` · **Live-verified:** yes, in the web preview. A temporary harness (deleted before commit) rendered the real Settings → Preferences section for two fake signed-in people, with a dummy key and a local stand-in for PostHog. The full flow passed: off before consent → opt in → page view → switch person → opt in → sign out. Nothing was sent to PostHog.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

**Setup for everything below "With a test key".** Add these two lines to the checkout's `.env.local`, then restart `bun run dev:web`. The host is a dead local port, so events fail on your machine and nothing reaches PostHog:

```
PUBLIC_POSTHOG_KEY=phc_local_test
PUBLIC_POSTHOG_HOST=http://127.0.0.1:9
```

Remove both lines when you're done. Never set `PUBLIC_POSTHOG_KEY` on Vercel or another live build until the privacy policy has been updated (docs/decisions.md, 2026-10-07).

## Today's builds (no key) — nothing changes
- [ ] **Do:** Without the setup lines, sign in and open Settings → Preferences. → **Expect:** No "Privacy" group at the bottom; the section ends with Sounds & motion. _(both)_
- [ ] **Do:** DevTools → Network, type `posthog` in the filter, reload. → **Expect:** No posthog file is downloaded and nothing goes to a PostHog host. _(web)_

## With a test key — off until you say yes
- [ ] **Do:** Sign in, open Settings → Preferences, scroll to the bottom. → **Expect:** A "Privacy" group ("Saved on this device, for your account only.") with "Share usage analytics", switched **off**. _(both)_
- [ ] **Do:** DevTools → Network, filter `127.0.0.1:9`. Use the app for a minute. → **Expect:** No requests. In Application → Local Storage, no `ph_moduo_app` keys. _(web)_
- [ ] **Do:** Switch it **on**. → **Expect:** A request to `127.0.0.1:9/e/` appears (it fails, which is expected). Local Storage now has `moduo:consent:<your user id>` = `granted`, `ph_moduo_app` and `__ph_opt_in_out_moduo_app`. _(web)_
- [ ] **Do:** Reload the app. → **Expect:** The switch is still on, and an event goes to `127.0.0.1:9/e/` within a few seconds. _(web)_
- [ ] **Do:** Switch it **off**. → **Expect:** `moduo:consent:<id>` = `denied`. Every `ph_moduo_app…` key and `__ph_opt_in_out_moduo_app` is gone from Local Storage *and* Session Storage. No more requests. _(web)_

## Sign-out, other people, other tabs
- [ ] **Do:** Switch it on, then sign out. → **Expect:** One last request (the sign-out event), then every `ph_moduo_app…` key is gone. `moduo:consent:<id>` stays, so your choice is remembered next time. _(web)_
- [ ] **Do:** In the same browser, sign in as a different account. → **Expect:** The switch is **off** for them and no requests go out. Their "yes" or "no" is separate from yours. _(web)_
- [ ] **Do:** Open the app in two tabs, open Settings in both, flip the switch in one. → **Expect:** The other tab's switch follows on its own. _(web)_
- [ ] **Do:** Turn on your browser's "Do Not Track" setting (in Chrome it's under Settings → Privacy and security), then reload. → **Expect:** No Privacy group and no requests, even if you'd switched it on before. _(web)_

## Desktop
- [ ] **Do:** `bun run dev:desktop` with the same two setup lines, then Settings → Preferences. → **Expect:** Same Privacy row, same behaviour. Switching it on doesn't break anything else in the app. _(desktop)_

## Known gaps / not-yet-testable
- **Real PostHog was never contacted** (deliberate: no key is set anywhere). What the payloads contain was checked two ways: an automated test that runs the real posthog-js library with the network stubbed (`src/lib/analytics.posthog.test.ts`), and the agent's live run against a local stand-in. Both confirmed: user id only, no email, URLs cut to the route root, no tokens, campaign tags or click ids. You can't easily read payloads in DevTools because they're gzip-compressed. The first real enable should be checked in PostHog's live events view with a test account.
- **Desktop wasn't run by the agent.** The code is shared; `tauri://` URLs are covered by a unit test.
- **The real sign-in path wasn't driven live.** The app only offers emailed-code sign-in, so the agent used fake signed-in people in a harness. The auth-provider wiring is covered by typecheck and the unit tests.
- **The privacy policy still says the app has no analytics.** Update `landing/privacy.html` §05, §07 and §11 before enabling (docs/decisions.md, 2026-10-07).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
