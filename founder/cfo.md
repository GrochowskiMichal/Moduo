# CFO note: Moduo Pro, day-loop wedge (updated 2026-10-19 with the founders' numbers)

> **How to read this.** The unit is one paid seat for one month. The tool counts "units a day", so `days_per_month` is 1: every "a day" figure means paid seats held that month. There are two views:
> - this file, **run cost** ([numbers.json](./numbers.json)): what Moduo costs while you two are paid from other projects;
> - [cfo-fulltime.md](./cfo-fulltime.md) ([numbers-fulltime.json](./numbers-fulltime.json)): what it takes to pay you both $8k a month and work on it full-time.
>
> Each input is tagged as a public price, an estimate, the founders' own number or TBD. The sources are in [cfo-sources.md](./cfo-sources.md). Not financial, tax or legal advice: an accountant in whichever country you incorporate (Poland, the USA or Japan) should check structure, employer costs and VAT/sales tax before money moves.

## The answer to roadmap Q3: what does Moduo cost to run?

- **Per paid seat: about $0.87 a month**, of which $0.73 is Stripe. At $12 each seat leaves **$11.13** (93%); at the $8 founding price, **$7.13**.
- **Per free user: about $0.01–0.04 a month.** Email sync runs on the user's device and mail bodies never reach Supabase. The free tier is close to free until Supabase Pro's quotas (100,000 monthly active users) run out.
- **Fixed: about $498 a month.** About $98 is infrastructure (Supabase Pro plus a compute step-up, Cloudflare, Resend, GitHub Actions, Apple, the domain); **$400 is your two Claude Max 20x seats**. Claude via the Startup program is free and isn't counted.
- **45 paid seats at $12 cover it** (70 at $8). With the placeholder ramp (10 → 160 seats in year 1, not anchored on anything), you would need **$881** before it pays for itself, earned back in month 8.

## The real number: going full-time

You each want a stable **$8–10k a month** before you stop other projects. That's **$16–20k a month** for the two of you, gross, before employer costs. Those costs depend on the country and can add a meaningful share on top.

| Pay for two | Paid seats needed at $8 (founding) | at $12 (Pro) | at $15 | at $20 per paying account |
| --- | ---: | ---: | ---: | ---: |
| $16k/month | 2,314 | **1,483** | 1,168 | 863 |
| $20k/month | 2,875 | **1,842** | 1,451 | 1,072 |

(These are the tool's break-even counts with --price. The Stripe line is held at its $12 level, so the counts are slightly conservative at $15–20 and slightly optimistic at $8. "$20 per paying account" is roughly a Duo account or a blend of Pro and Team.)

- **The line to watch is pay, not infrastructure.** Every $1,000 a month of founder pay needs about **90 more paid seats at $12**, or 140 at $8. Infrastructure is under 3% of the full-time cost base.
- **How far away that is.** You have no waitlist yet, so there's no real ramp to model. Freemium tools often convert **about 2–5% of free signups** to paid (an estimate, not a Moduo number). At that rate, 1,500 paid seats means roughly **30,000–75,000 people trying the free plan**.
- **Founding pricing is expensive at this scale.** Locking the first ~1,000 members at $8 for as long as they stay subscribed raises the full-time break-even from 1,483 seats to about **1,800** (1,000 at $8 plus about 800 more at $12).

## Three ways to bring the full-time target closer

1. **Sell more per account.** At $20 per paying account (Duo, or a mix of Pro and Team), the break-even for $16k drops from 1,483 to **863**. That makes Duo and Team more valuable than the panel suggested, even though day-loop leads the pitch.
2. **Cap the founding cohort, or time-limit the price.** Make founding $8 for year one only (Team already works this way), or cap it at a few hundred seats. Each founding seat converted to $12 later adds $4 a month.
3. **Bill yearly by default.** Stripe's $0.30 fixed fee is charged once a year instead of 12 times, which saves about $0.28 per seat-month (arithmetic on the Stripe line). It's small, but it also cuts churn.

## Cash and what's still open

- **Startup spend: TBD.** You don't know the country yet: Poland, the USA or Japan. Incorporation, accounting and employer costs differ a lot between them. Decide the country before the first payment (Moduo can't take money while Ringdove is the interim controller).
- **The placeholder ramp stays until real signal exists.** Replace it after the first private beta or founding offer.
- **Calls/Meet** (planned at $330–380 a month base plus usage) isn't in the model. Add it when Calls is specced.
- **Board conditions:** `/founder-board` hasn't run, so there are none to check.

---

# Unit economics: Moduo Pro (day-loop wedge): run-cost model, founders unpaid

Every number below comes from the input file. Nothing is looked up or guessed.

## One paid seat

| line | per paid seat |
| --- | ---: |
| Price | $12.00 |
| Stripe card fee (2.9% + $0.30, US standard) [public price] | -$0.65 |
| Stripe Billing (0.7% of billing volume) [public price] | -$0.08 |
| Storage for the seat's files (~2 GB avg x $0.021/GB over Supabase Pro quota) [estimate] | -$0.04 |
| Share of free users carried per paid seat (~5 free users x ~$0.02) [estimate] | -$0.10 |
| **Contribution** (what each paid seat leaves to pay the fixed costs) | **$11.13** (93%) |

## The margin that matters

Fixed costs: $498 a month (Supabase Pro (one project; Micro compute covered by credits) [public price] $25, Supabase compute step-up to Small for Realtime headroom [estimate] $15, Cloudflare Workers Paid (app, landing, update server, R2) [public price] $5, Resend Pro (transactional email) [public price] $20, GitHub Pro + metered Actions minutes for macOS/Windows builds [estimate] $24, Apple Developer Program ($99/yr) [public price] $8, moduo.app domain (~$15/yr) [estimate] $1, Founders' pay [0 in this run: the run-cost view; see numbers-fulltime.json] $0, Claude Max 20x, two seats at $200 (founders' own spend; Startup-program credits not counted) [founders 2026-10-19; seat count to confirm] $400).

- **Break-even: 45 paid seats a month.** Below that you lose money every month.
- **Profit margin at your plan** (200 paid seats): **72%** of every sale, after every cost.

## Year 1, month by month

| month | paid seats a month | revenue | profit | cumulative (after $0 startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | $120 | -$387 | -$387 |
| 2 | 20 | $240 | -$276 | -$663 |
| 3 | 30 | $360 | -$165 | -$828 |
| 4 | 40 | $480 | -$53 | -$881 |
| 5 | 55 | $660 | $114 | -$767 |
| 6 | 70 | $840 | $281 | -$487 |
| 7 | 85 | $1,020 | $448 | -$39 |
| 8 | 100 | $1,200 | $614 | $575 |
| 9 | 115 | $1,380 | $781 | $1,357 |
| 10 | 130 | $1,560 | $948 | $2,305 |
| 11 | 145 | $1,740 | $1,115 | $3,420 |
| 12 | 160 | $1,920 | $1,282 | $4,703 |

- **Year 1 operating profit: $4,703** on $11,520 of revenue.
- After the $0 startup spend: $4,703.
- Startup money earned back: month 8.
- Cash you need before it pays for itself: **$881**.

## What if

| scenario | margin at plan | break-even (paid seats) | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | 72% | 45 | $4,703 |
| Price -10% | 69% | 51 | $3,551 |
| Volume -20% | 67% | 45 | $2,566 |
| Unit costs +15% | 71% | 46 | $4,578 |

No red flags in these numbers. They are only as good as the inputs: check every cost against a real quote.
