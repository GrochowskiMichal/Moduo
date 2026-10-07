# Manual test checklist — app analytics: one-time question, opt-in, safe by default

> Generated 2026-10-07 · branch `t/maciej/app-analytics-consent` (+ `t/maciej/privacy-app-analytics` for the policy) · **Live-verified:** yes, in the web preview. A temporary harness (deleted before commit) rendered the real question, toaster and Settings → Preferences for two fake signed-in people. It used a dummy key and a local stand-in for PostHog, so nothing was sent to PostHog. Covered: asked after the settle delay; Share → events tagged `surface: "app"`; never asked again; a second person asked separately; Don't share → nothing sent. The policy page was checked in a local preview.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

**Setup for everything below "With a test key".** Add these two lines to the checkout's `.env.local`, then restart `bun run dev:web`. The host is a dead local port, so events fail on your machine and nothing reaches PostHog:

```
PUBLIC_POSTHOG_KEY=phc_local_test
PUBLIC_POSTHOG_HOST=http://127.0.0.1:9
```

Remove both lines when you're done. Setting the real key on a live build is now unblocked (the privacy policy describes app analytics). Do that in the Vercel and desktop build settings, not in git.

## Today's builds (no key) — nothing changes
- [ ] **Do:** Without the setup lines, sign in and wait a few seconds. → **Expect:** No question appears. Settings → Preferences has no "Privacy" group. _(both)_
- [ ] **Do:** DevTools → Network, filter `posthog`, reload. → **Expect:** No posthog file is downloaded (not even prefetched) and nothing goes to a PostHog host. _(web)_

## With a test key — the one-time question
- [ ] **Do:** Sign in and wait about 2 seconds. → **Expect:** A card at the bottom right: "Help us improve Moduo?", a short explanation, a "Privacy policy" link, and two equal buttons, "Don't share" and "Share". You can keep using the app around it. _(both)_
- [ ] **Do:** Before answering, check DevTools → Network (filter `posthog` and `127.0.0.1:9`). → **Expect:** Nothing: no posthog file and no requests. _(web)_
- [ ] **Do:** Click "Privacy policy". → **Expect:** moduo.app/privacy opens at "In the Moduo app" (web: a new tab; desktop: your browser). _(both)_
- [ ] **Do:** Click **Share**. → **Expect:** The card closes, and a request goes to `127.0.0.1:9/e/` (it fails, which is expected). Local Storage has `moduo:consent:<your user id>` = `granted`, `ph_moduo_app` and `__ph_opt_in_out_moduo_app`. Settings → Preferences → Privacy shows the switch on. _(web)_
- [ ] **Do:** Reload, or quit and reopen. → **Expect:** No question again. An event goes to `127.0.0.1:9/e/` within a few seconds. _(both)_
- [ ] **Do:** Sign in as another account in the same browser. → **Expect:** They get the question, because each person answers for themselves. Click **Don't share**: the card closes, nothing is sent, and no `ph_moduo_app…` keys appear. _(web)_
- [ ] **Do:** Ignore the card and reload. → **Expect:** It comes back until you answer. Answering is the only way it stops. _(web)_

## Changing your mind
- [ ] **Do:** Settings → Preferences → Privacy → switch it **off**, then open a few pages. → **Expect:** `moduo:consent:<id>` = `denied`. Every `ph_moduo_app…` key and `__ph_opt_in_out_moduo_app` is gone from Local Storage *and* Session Storage. No new requests to `/e/`. _(web)_
  - Requests whose URL has `retry_count=` are fine. The dead port makes every send fail, and PostHog keeps retrying events captured *before* you switched off until you reload. A request **without** `retry_count=` after switching off would be a real bug.
- [ ] **Do:** Switch it on again, then sign out. → **Expect:** One last new request (the sign-out event), plus any `retry_count=` retries. Every `ph_moduo_app…` key is gone. `moduo:consent:<id>` stays, so you're not asked again next time. _(web)_
- [ ] **Do:** Open two tabs, with Settings open in one. Answer the question (or flip the switch) in the other. → **Expect:** The first tab follows on its own, and its card closes. _(web)_
- [ ] **Do:** Turn on your browser's "Do Not Track" setting (in Chrome it's under Settings → Privacy and security), then reload. → **Expect:** No question, no Privacy group, no requests. _(web)_

## Desktop
- [ ] **Do:** `bun run dev:desktop` with the same two setup lines. → **Expect:** The same question after sign-in and the same Settings row. "Privacy policy" opens in your browser, not inside the app. _(desktop)_

## The privacy policy (moduo.app/privacy)
- [ ] **Do:** Open moduo.app/privacy after the `prod-landing` deploy. → **Expect:** "The short version" says analytics run only if you say yes, on the website or in the app. §04 Analytics has two parts, "On our website" and "In the Moduo app". §05 no longer says the app has no analytics. §07 lists PostHog for the website and the app. §11 "In the Moduo app" lists `moduo:consent:<your account ID>` and PostHog's `ph_moduo_app` entries. "Your choices" points to Settings → Preferences → Privacy. _(web)_

## In PostHog, once a real key is live
- [ ] **Do:** In the project's activity view, filter by `surface`. → **Expect:** The landing's events have `surface = landing`; the app's have `surface = app`, plus `platform` (web/desktop), `environment` (production, staging, preview, development) and `app_version`. Build app insights with `surface = app`. _(PostHog)_
- [ ] **Do:** Check the project's settings. → **Expect:** Decide on "Discard client IP data". The policy says PostHog may use the IP for location, which stays true either way. _(PostHog)_

## Known gaps / not-yet-testable
- **Real PostHog was never contacted** (deliberate: no key is set anywhere). Payloads were checked by `src/lib/analytics.posthog.test.ts`, which runs the real posthog-js with the network stubbed, and by the live run against a local stand-in. The first real enable should be checked in PostHog's live events view with a test account.
- **Desktop wasn't run by the agent.** The code is shared; `tauri://` URLs and the desktop policy link are covered by unit tests.
- **The real sign-in path wasn't driven live.** The app only offers emailed-code sign-in, so the harness used fake signed-in people. The auth-provider wiring is covered by typecheck and unit tests.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Wrap". One file per sprint/branch so history is preserved.*
