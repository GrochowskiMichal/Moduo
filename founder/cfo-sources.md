# Where the CFO numbers come from

Checked 2026-10-19. **Public prices** are list prices from memory of each vendor's pricing page as of 2026; verify each one against the live page before relying on it. **Estimates** are reasoned guesses. **TBD** means only the founders know.

| Line | Value | Type | Source / reasoning |
| --- | --- | --- | --- |
| Stripe card fee | 2.9% + $0.30 per charge | Public price | Stripe standard US card pricing. EEA cards on an EU account are cheaper (about 1.5% + €0.25), so this is the conservative case. |
| Stripe Billing | 0.7% of billing volume | Public price | Stripe Billing pay-as-you-go. Add Stripe Tax (0.5%) if it is used for VAT. |
| Storage per seat | ~$0.04/month | Estimate | ~2 GB average × $0.021/GB-month Supabase storage overage. Pools are planned at 50 GB per Pro owner ([specs/attachments.md](../specs/attachments.md)), so a heavy user costs about $1/month. |
| Free users per paid seat | 5 × ~$0.02 | Estimate | Email bodies stay on the device (redb); only metadata reaches Supabase ([docs/data-layers.md](../docs/data-layers.md)). Free users mostly take database rows and up to a 2 GB storage pool. |
| Supabase Pro | $25/month | Public price | The org is on Free today ([docs/decisions/data.md](../docs/decisions/data.md)). Pro is undecided (CH31) but recommended before load reaches 200 Realtime sockets ([docs/decisions/chat.md](../docs/decisions/chat.md)). |
| Supabase compute step-up | $15/month | Estimate | Small compute minus the $10 credit, for Realtime headroom. |
| Cloudflare Workers Paid | $5/month | Public price | Workers run the app, landing and update server; R2 holds releases ([docs/decisions/workflow.md](../docs/decisions/workflow.md)). R2 storage is small at $0.015/GB. |
| Resend Pro | $20/month | Public price | The only email sender. The free tier (3,000/month) may cover the start. |
| GitHub + Actions | $24/month | Estimate | GitHub Pro $4, plus metered macOS/Windows build minutes now that Actions isn't free ([docs/decisions/workflow.md](../docs/decisions/workflow.md)). |
| Apple Developer | $99/year | Public price | Individual today; must re-enrol as an Organization before iOS. |
| Domain | ~$15/year | Estimate | moduo.app renewal. |
| Founders' pay | $8–10k/month each (gross) | Founders, 2026-10-19 | Modelled at $16k (numbers-fulltime.json) and $20k for two. Employer costs depend on the country and aren't included. |
| Claude Max 20x | $400/month | Founders, 2026-10-19 | Assumed two seats at $200 (confirm the seat count). Claude through the Anthropic Startup program is free and not counted. |
| Incorporation | TBD | Founders, 2026-10-19 | The country isn't decided: Poland, the USA or Japan. Needed before the first payment (interim controller is Ringdove). |
| Calls / Meet (not in the model) | $330–380/month base + usage | Estimate in the repo | [specs/moduo-meet.md](../specs/moduo-meet.md); now being re-planned as Calls. |
| Ramp (10 → 160 paid seats) | — | Placeholder | No real anchor: 0/80 panel buys and no waitlist yet (founders, 2026-10-19: nothing published, iterating before release). |
| Freemium conversion | 2–5% | Estimate | A common range for freemium productivity tools. Not a Moduo number; used only to size the funnel. |
