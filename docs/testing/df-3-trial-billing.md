# Manual test checklist — DF-3 trial/billing fix pack

> Generated 2026-07-10 · branch `t/maciej/df-3-trial-billing` · **Live-verified:** yes (hosted test account, web) — every flow below except the desktop-runtime rows was confirmed in a real browser before this checklist was written.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.
>
> Note: the hosted test account (`grzywaczmj+moduo-s2-test@gmail.com`) had its trial re-started during this session — it's trialing until **Jul 17, 2026**, so the banner flows are directly reproducible on it.

## Trial banner (fix: raw fetch → shared supabaseClient)
- [ ] **Do:** sign in as a trialing user, land on Home → **Expect:** amber banner above the top nav: "N days left in your trial. Add a card to extend to 30 days →" — the CTA now shows on **desktop too** (it used to be web-only because it navigated a web route) _(both)_
- [ ] **Do:** open devtools → Network, reload → **Expect:** the `user_entitlements` request returns 200 (no 401 with an empty `apikey` — the old bug) _(web)_
- [ ] **Do:** click the banner's ✕ → **Expect:** banner dismisses; stays dismissed on SPA navigation, returns after a full reload in a new session (per-session dismissal) _(web)_

## Settings → Billing (new section, ratified minimal)
- [ ] **Do:** click the banner CTA "Add a card to extend to 30 days →" → **Expect:** Settings modal opens **on the Billing tab** (not Appearance) over the current page _(web)_
- [ ] **Do:** look at the Billing section → **Expect:** "Current plan: Pro", status line "Trial — N days left (ends <date>)", a hint "Add a card in the billing portal to extend your trial to 30 days total.", and a **Manage billing** button _(both)_
- [ ] **Do:** click **Manage billing** → **Expect:** web: same tab navigates to Stripe's hosted portal (shows the trial, Add payment method, Cancel subscription, "Return to Moduo" link); desktop: portal opens in the system browser _(both — web verified; desktop needs a pass)_
- [ ] **Do:** in the portal, click "Return to Moduo" → **Expect:** back at the app origin _(web)_
- [ ] **Do:** open Settings via the gear/⌘, → **Expect:** "Billing" appears in the left nav between Account and Workspace with a card icon _(both)_

## Deep link (legacy `/settings?section=billing` URL)
- [ ] **Do:** paste `<origin>/settings?section=billing` into a fresh tab (cold load) → **Expect:** app boots to "/" with the Settings modal open on Billing (previously the modal never opened — the event fired before the modal mounted) _(web)_

## Onboarding copy
- [ ] **Do:** create a throwaway account (or read `onboarding-page.tsx` step 1) → **Expect:** trial card reads "Add a card any time during the trial to extend it to 30 days total — open **Settings → Billing** and choose **Manage billing**." _(web)_

## SubscriptionGate fail-open logging
- [ ] **Do:** (optional, devtools) block `rest/v1/user_entitlements*` requests via devtools request-blocking, reload → **Expect:** app still loads (fail-open, no paywall redirect) and the console shows `[app-gate] subscription check failed — failing open (no paywall redirect): …` _(web)_

## Edge cases
- [ ] **Do:** on a **free / never-trialed** account, open Settings → Billing → **Expect:** "Current plan: Free · No subscription"; clicking Manage billing shows an error toast ("No billing account found. Start a trial first.") — no crash _(web)_
- [ ] **Do:** dismiss the banner, then open Billing from Settings directly → **Expect:** section still shows live trial data (banner dismissal only hides the banner) _(web)_
- [ ] **Do:** open Settings from the ⌘K palette or user menu, close it with Esc, then switch workspace right away → **Expect:** Settings does NOT pop back open (the deep-link buffer is armed only by `/settings?…` URLs and disarmed by a user close) _(web)_
- [ ] **Do:** (devtools) block `rest/v1/user_entitlements*`, open Settings → Billing → **Expect:** status line reads "Couldn't check your subscription — try again shortly." — never "No subscription" on a read failure _(web)_
- [ ] **Do:** web: Manage billing → in the Stripe portal press the browser **Back** button (not the return link) → **Expect:** Billing section restored with the button usable again (not stuck on "Opening…") _(web)_

## Migrations / data
- None — no schema changes; the section reads the existing `user_entitlements` view and the already-deployed `create-portal-session` edge function.

## Known gaps / not-yet-testable
- **Desktop runtime pass** (banner + CTA render, Manage billing → system browser, portal return) — this session verified web only; desktop omits `returnUrl` (the edge fn's `APP_URL` fallback supplies the return link), so also confirm `APP_URL` is set to the hosted web origin in Supabase edge-function secrets.
- **Actual card-add → trial extends to 30 days** (Stripe webhook `payment_method.attached` → `trial-extension` fn) — pre-existing backend path, not touched here; needs a real test card in the portal to confirm end-to-end.
- Stripe portal is in **test mode** for the test account ("Moduo sandbox") — expected.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
