# Manual test checklist — TX-1 email kit

> Generated 2026-10-08 · branch `t/maciej/tx-1-email-kit` · **Live-verified:** partial — the Storybook gallery was opened and checked in the Browser pane (light, dark and plain text of A1; frames sized to their content). Nothing is sent to anyone yet: TX-1 has no production changes. Real mail-app rendering starts with TX-2.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Storybook email gallery
- [ ] **Do:** `bun run storybook`, open **Email → Transactional emails → Gallery** → **Expect:** the sign-in code email (A1) three times: a light card, a dark card (Reading black background), and the plain-text version. _(web)_
- [ ] **Do:** compare the light card with A1 in `.design/transactional-email/email-set.html` → **Expect:** same copy word for word: "Your sign-in code", "Enter this code in Moduo to sign in.", the code 482913 in a grey box with wide spacing, "It works once, for 10 minutes. …", the footer reason line, the Ringdove address and a Privacy link. _(web)_
- [ ] **Do:** look at the logo spot → **Expect:** a broken-image icon with "Moduo" next to it. That's expected until BRAND-1's logo files are deployed to app.moduo.app/email (see Known gaps). _(web)_
- [ ] **Do:** open **Email → Transactional emails → Single**, switch Mode between light, dark and text in the controls → **Expect:** the same email in each look; the light one stays light even if Storybook itself is dark. _(web)_
- [ ] **Do:** read the plain-text card → **Expect:** every sentence of the email, the code on its own line, "Privacy: https://www.moduo.app/privacy" written out, no HTML tags. _(web)_

## The ratified copy file
- [ ] **Do:** open `.design/transactional-email/email-set.html` (or the "Moduo email set" artifact) → **Expect:** the example host is Anna Carter (not Anna Kowalska), guest booking emails end with "Scheduled with Moduo", cancel emails say "canceled" (American spelling), and the founder email says "Reply any time." _(web)_

## Edge cases (covered by unit tests; spot-check if curious)
- [ ] **Do:** `bunx rstest run supabase/functions/_shared/email` → **Expect:** all tests pass, including "user text is inert" (a name with HTML or line breaks can't inject markup or fake a link), "palette mirrors its source" (email colors follow tokens.css), and the time-zone tests (Europe/Kyiv and Asia/Kolkata accepted, "+01:00" refused). _(terminal)_

## Migrations / data
- [ ] None. `EMAIL_KINDS` is a new code vocabulary only; its database CHECK arrives with the `email_outbox` table in TX-2.

## Known gaps / not-yet-testable
- **Logo images:** the kit points at `https://app.moduo.app/email/lockup-{light,dark}@2x.png` and `mark-{light,dark}@2x.png`. They come from BRAND-1 (PR #278, not merged yet). Until they are deployed, that URL serves the app's HTML page, so emails and the gallery show a broken image. TX-2 must check each URL answers `content-type: image/png` at 192 × 44 / 26 × 26 before going live.
- **Real mail apps:** dark-mode switching (Apple Mail, iOS Mail, Outlook.com) and Outlook desktop layout are checked only at the markup level here. TX-2's checklist sends real emails to Gmail, Apple Mail and Outlook.
- **Font:** emails no longer load Geist from Google Fonts (privacy). Readers see Geist only if it's installed; everyone else sees their system sans font.
- **Deno:** there's no local Deno; the kit follows the pure-TypeScript pattern `booking-public` already deploys with. TX-2's first deploy is its real test.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
