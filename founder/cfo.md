# CFO note: Moduo Pro, day-loop wedge (updated 2026-10-19: Polish company, calls costed)

> **How to read this.** The unit is one paid seat for one month. The tool counts "units a day", so `days_per_month` is 1: every "a day" figure means paid seats held that month. There are two views:
> - this file, **run cost** ([numbers.json](./numbers.json)): what Moduo costs while you two are paid from other projects;
> - [cfo-fulltime.md](./cfo-fulltime.md) ([numbers-fulltime.json](./numbers-fulltime.json)): paying you both $8k a month and working on it full-time.
>
> Inputs are tagged as a public price, an estimate, the founders' own number or TBD; the sources are in [cfo-sources.md](./cfo-sources.md). Not financial, tax or legal advice. A Polish accountant should choose how you're paid (employment, board appointment or B2B invoices), because that choice moves the full-time cost by up to $3,500 a month.

## Assumptions decided 2026-10-19

- **The company is a Polish sp. z o.o.** A Japanese company could own it later if you stay in Japan.
- **Calls stay in the plan if the cost is manageable.** See the calls section below.

## Roadmap Q3: what does Moduo cost to run?

- **Per paid seat: about $0.87 a month**, of which $0.73 is Stripe. At $12, each seat leaves **$11.13** (93%); at the $8 founding price, **$7.13**.
- **Per free user: about $0.01–0.04 a month.** Email bodies stay on the user's device.
- **Fixed: about $748 a month.** That's ~$98 of infrastructure, $400 for two Claude Max 20x seats and ~$250 for a Polish accounting office (an estimate; a sp. z o.o. needs full books).
- **68 paid seats at $12 cover it** (105 at $8). On the placeholder ramp, that means **$2,092** of cash before it pays for itself, earned back in month 11.
- **Setting up the company costs ~$75** (PLN 274 through S24). You also pay in **PLN 5,000 of share capital (~$1,370)**. That money stays in the company's account to spend, so it isn't a cost.

## Going full-time

You each take $8k gross. A Polish employment contract adds up to **~22%** on top (ZUS ~20.5% plus PPK 1.5%), modelled as **$3,500 a month** as an upper bound. The real figure is lower above the ZUS cap (PLN 23,550 a month for pension and disability), and different again with board-appointment or B2B pay. Fixed costs come to **$20,248 a month**.

| | At $8 (founding) | At $12 (Pro) | At $15 | At $20 per paying account |
| --- | ---: | ---: | ---: | ---: |
| Paid seats to break even | 2,840 | **1,820** | 1,434 | 1,059 |

At $10k each, add about **450 seats at $12** (another $5,000 a month of pay and on-costs ÷ $11.13 a seat).

- **The line to watch is pay, and how it's structured.** Infrastructure is under 1% of the full-time cost base. Choosing B2B or board-appointment pay over employment could save up to ~$3,500 a month, the same as ~315 paid seats at $12. That's an accountant's call, not a product one.
- **Funnel size.** At a 2–5% free-to-paid conversion (a common freemium range, not a Moduo number), 1,800 paid seats means roughly **36,000–90,000 free signups**.

## Calls and Meet: affordable, if they run on a managed service

The old plan (self-hosted LiveKit on Azure, [specs/moduo-meet.md](../specs/moduo-meet.md)) carried a **$330–380 a month base** before anyone made a call. A managed media relay has **no base**: Cloudflare Realtime, which Moduo already uses for hosting, charges $0.05 per GB sent to callers, and the first 1,000 GB a month is free. My arithmetic, assuming ~1.5 Mbps per 720p video stream (audio barely counts):

| Call | Data per hour | Cost per hour |
| --- | ---: | ---: |
| 2 people (Duo) | ~1.35 GB | ~$0.07 |
| 4 people (Team) | ~8.1 GB | ~$0.41 |

- **The free 1,000 GB covers early use:** about 740 hours of Duo calls or 120 hours of four-person calls a month.
- **Heavy use, after the free allowance:**
  - a Duo pair on a one-hour call every workday costs about **$1.50 a month** against $20 of revenue (7%);
  - a Team of 4 on a one-hour call every workday costs about **$8.90 a month** against $60 (15%).
- **What that means.** Calls are cheap for Duo and noticeable for Team, but they never threaten the margin as long as calls stay on paid Duo and Team plans. Keeping them off Free and Pro is already the plan.
- **Transcripts or captions** (Azure AI Speech in the old plan) would add roughly **$1 per call-hour**. That's an estimate, so make them opt-in.
- **Verdict:** keep Calls, and build them on a managed relay rather than an always-on server. A self-hosted server only becomes cheaper above ~7,600 GB a month (about 940 four-person hours). The provider choice belongs in the Calls spec; these numbers should hold for any usage-priced relay.

## Three ways to bring the full-time target closer

1. **Sell more per account.** At $20 per paying account (Duo, or a mix of Pro and Team), the full-time break-even drops from 1,820 to **1,059**.
2. **Get the pay structure right.** Up to ~$3,500 a month (about 315 seats) depends on how a Polish accountant sets up your pay.
3. **Keep founding pricing to year one.** If the first 1,000 seats stay at $8 for as long as members stay subscribed, the target rises to about **2,170 seats**: 1,000 at $8 plus about 1,170 at $12.

## Still open

- **The ramp is a placeholder.** There's no waitlist yet; replace it after the first private beta or founding offer.
- **The accounting-office price is an estimate.** Get a real quote.
- **The Claude Max seat count is assumed to be two.**
- **Board conditions:** `/founder-board` hasn't run, so there are none to check.

---

