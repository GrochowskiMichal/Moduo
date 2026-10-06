# Manual test checklist — billing on the Stripe Sync Engine (4 plans, Free tier, founders)

Branch: `t/mike/billing-stripe-sync`. DB/Stripe/edge changes are already live on the Moduo Supabase project + Stripe sandbox; the app ships with this branch.

## Founders (mike@moduo.app, maciej@moduo.app)
- [ ] Sign in as mike@moduo.app → app opens, no trial banner, no paywall. Settings → Billing: plan "Founder", "Everything included — no charge", no Manage-billing button. _(web + desktop)_
- [ ] Invite maciej@moduo.app from Supabase (Auth → Add user → Send invitation) → he accepts the link → lands in onboarding as **Founder** (no trial started). _(web)_
- [ ] `/paywall` as a founder: "You're a Founder", all CTAs disabled. _(web)_

## New invited user (anyone else)
- [ ] Accept an invite → onboarding → app. Within ~10 s Settings → Billing shows **Pro — Trial, 14 days**; trial banner "14 days left… Add a card to extend to 30 days". _(web)_
- [ ] Stripe sandbox shows one subscription for them on `pro_monthly`, trialing, no card. _(Stripe)_
- [ ] Reload several times: still exactly one subscription (start-trial is idempotent). _(Stripe)_

## Plans page (`/paywall`, also reached from Billing → See plans)
- [ ] Four cards: Free $0 · Pro $12 · Duo $20 /mo for two ("New") · Team $15 /seat/mo, each with the landing's bullets and founding-price line. Yearly toggle → $10 / $16 / $12. _(web)_
- [ ] Trialing user clicks Duo → "Redirecting…" is NOT shown; page reloads to `/?upgrade=success`; Billing shows Duo, trial end unchanged (no new trial, no second subscription). _(web)_
- [ ] Team seats box can't go below 3. _(web)_
- [ ] Free user (no sub) → "Start free trial" starts the 14-day trial; "Add a card for 30 days instead" → Stripe Checkout with card required, 30-day trial. _(web)_

## Trial → card → 30 days
- [ ] Trialing user → Billing → Manage billing → Stripe portal → add test card `4242…` → Return → Billing shows trial ending 30 days after start. _(web)_

## Trial ends / cancel
- [ ] Cancel in the portal (or let a no-card trial lapse) → within seconds profile becomes Free; app still opens (Free is a real tier); `/paywall` says "Your trial has ended". Choosing a plan now requires a card and gives no new trial. _(web)_

## Limits (RLS)
- [ ] Free/Pro owner: inviting a member to a workspace is rejected (seat cap 1). Duo owner: 1 invite OK, 2nd rejected. Team (3 seats): 2 invites OK. Founder: unlimited. _(web + desktop)_
- [ ] A Free user can't create a 2nd workspace. _(web)_
- [ ] From the browser console, `supabase.from("profiles").update({plan_tier:"founder"}).eq("id", me)` → permission denied. _(web)_

## Desktop
- [ ] Desktop signed in as a paid/trial/founder user: cloud sync starts; as Free: worker stays off. _(desktop)_

## Known gaps
- Not live-clicked by the agent (no logged-in session): the Checkout/portal round-trips and the invite acceptance. DB trigger was verified with a rolled-back simulation (trial → team tier, cancel → free/canceled).
- Deployed `sync-subscription` and `trial-extension` are now 410 stubs — delete them in the Supabase dashboard. `create-portal-session` still runs the old build (no redirect allow-list); redeploy from the repo to pick that up.
- Other test accounts (icloud, foraplot, gmail…) still carry pre-migration plan values with no Stripe subscription behind them; they'll resolve to Free the next time Stripe touches them.
- Not enforced anywhere yet: "1 email account" on Free, read-only AI keys on Free, "short history".
