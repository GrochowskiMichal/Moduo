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
| Incorporation | PLN 274 (~$75) | Public price, 2026 | Polish sp. z o.o. via S24: PLN 250 court fee + 0.5% PCC on PLN 5,000 capital. The PLN 100 Monitor fee ended 2025-11-29. Share capital PLN 5,000 is paid in and stays company cash. [norman.finance](https://norman.finance/pl/en/blog/how-to-start-a-sp-z-o-o), [cost calculator](https://norman.finance/pl/en/tools/company-cost-calculator) |
| Employer costs (Poland) | ~20.5% ZUS + 1.5% PPK; modelled as $3,500/month | Public rates, 2026 | Pension 9.76%, disability 6.5%, accident ~1.67%, Labour Fund 2.45%, FGŚP 0.1%. Pension and disability stop at PLN 23,550/month, so the real figure for $8k is lower. [RemotePass](https://remotepass.com/country/poland/taxes), [Outsorcy](https://outsorcy.com/country/poland/payroll-taxes-in-poland/). Check against zus.pl. |
| Accounting office | ~$250/month | Estimate | Full books for a sp. z o.o., ~PLN 600–1,500/month. Get a quote. |
| Calls media relay | $0.05/GB after 1,000 GB free each month | Public price | [Cloudflare Realtime pricing](https://developers.cloudflare.com/realtime/pricing/). LiveKit Cloud (Ship $50/month, ~$0.0005 per participant-minute) is an alternative; third-party sources disagree on its rates. [LiveKit field guide](https://livekit.com/field-guides/guide/estimating-pricing-video-conference-livestream) |
| Call bitrate | ~1.5 Mbps per 720p stream | Estimate | Used for the calls arithmetic. |
| Calls / Meet, self-hosted (old plan) | $330–380/month base + usage | Estimate in the repo | [specs/moduo-meet.md](../specs/moduo-meet.md); now being re-planned as Calls. Compared against a managed relay in cfo.md. |
| Ramp (10 → 160 paid seats) | — | Placeholder | No real anchor: 0/80 panel buys and no waitlist yet (founders, 2026-10-19: nothing published, iterating before release). |
| Freemium conversion | 2–5% | Estimate | A common range for freemium productivity tools. Not a Moduo number; used only to size the funnel. |
