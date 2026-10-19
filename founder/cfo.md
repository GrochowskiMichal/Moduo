# CFO note: Moduo Pro, day-loop wedge (draft 2026-10-19)

> **How to read this.** The unit is one paid seat for one month. The tool counts "units a day", so `days_per_month` is set to 1: every "a day" figure below means paid seats held that month. Each number is tagged in [numbers.json](./numbers.json) as a public price, an estimate or TBD; [cfo-sources.md](./cfo-sources.md) has the sources. This run assumes **the founders take no pay**, so it answers roadmap Q3's question ("what does it cost to run?"), not "can it pay us?". Not financial, tax or legal advice: an accountant should check the company structure, VAT on EU sales and founder payroll before money moves.

- **The margin.** At $12, each paid seat leaves **$11.13** (93%) after Stripe fees, storage and its share of free users. At the $8 founding price it leaves **$7.13** (89%). The per-seat cost is about $0.87, and $0.73 of that is Stripe.
- **What it costs to run.** About **$98 a month** of infrastructure: Supabase Pro plus a compute step-up, Cloudflare, Resend, GitHub Actions, Apple and the domain. **9 paid seats at $12** (14 at $8) cover it. A free user costs about **$0.01–0.04 a month**, because email sync runs on the user's device and mail bodies never reach Supabase. So the free tier is close to free to carry until Supabase Pro's quotas run out.
- **The line to watch: the founders' pay.** Every **$1,000 a month** the founders pay themselves needs about **90 more paid seats at $12, or 140 at $8** (that's $1,000 divided by the contribution per seat). Infrastructure is a rounding error next to it.
- **Second line to watch: real-time features.** The planned Calls/Meet stack was estimated at **$330–380 a month base plus usage** ([specs/moduo-meet.md](../specs/moduo-meet.md)). That alone would quadruple fixed costs, so price Duo and Team (the only plans with chat or calls) with it in.
- **Cash.** No startup spend has been entered, so the tool reports $0 needed. Incorporating the company (required before the first payment) and the Apple Organization enrolment are **TBD**.
- **Three ways to improve the margin** (each run as a what-if):
  1. **Yearly billing.** Stripe's $0.30 fixed fee is charged once a year instead of 12 times, so the fee per seat-month drops from $0.65 to about $0.37 at $12. Contribution rises by about $0.28 a seat (about 3 points of margin).
  2. **Keep $12 as the list price and reserve $8 for founders only.** At $8 the year-1 profit falls from $9,503 to **$2,240** on the same placeholder ramp, and break-even moves from 9 to 14 seats.
  3. **Volume matters less than pay.** At 20% fewer seats the year-1 profit falls only from $9,503 to $7,366. The month-by-month ramp barely moves the result next to the founders' pay line.
- **Board conditions.** `founder/board.md` doesn't exist yet (`/founder-board` hasn't run), so there are no conditions to check.
- **The ramp is a placeholder.** It runs from 10 paid seats in month 1 to 160 in month 12. The panel can't anchor it (0 buys out of 80), and the waitlist size and founding-cohort conversion are TBD. Replace it once the founding offer has run.

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

Fixed costs: $98 a month (Supabase Pro (one project; Micro compute covered by credits) [public price] $25, Supabase compute step-up to Small for Realtime headroom [estimate] $15, Cloudflare Workers Paid (app, landing, update server, R2) [public price] $5, Resend Pro (transactional email) [public price] $20, GitHub Pro + metered Actions minutes for macOS/Windows builds [estimate] $24, Apple Developer Program ($99/yr) [public price] $8, moduo.app domain (~$15/yr) [estimate] $1, Founders' pay [TBD, founders only; 0 in this run] $0, Founders' tooling, e.g. Claude Max [TBD; 0 in this run] $0).

- **Break-even: 9 paid seats that month.** Below that you lose money every month.
- **Profit margin at your plan** (200 paid seats): **89%** of every sale, after every cost.

## Year 1, month by month

| month | paid seats that month | revenue | profit | cumulative (after $0 startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | $120 | $13 | $13 |
| 2 | 20 | $240 | $124 | $137 |
| 3 | 30 | $360 | $235 | $372 |
| 4 | 40 | $480 | $347 | $719 |
| 5 | 55 | $660 | $514 | $1,233 |
| 6 | 70 | $840 | $681 | $1,913 |
| 7 | 85 | $1,020 | $848 | $2,761 |
| 8 | 100 | $1,200 | $1,014 | $3,775 |
| 9 | 115 | $1,380 | $1,181 | $4,957 |
| 10 | 130 | $1,560 | $1,348 | $6,305 |
| 11 | 145 | $1,740 | $1,515 | $7,820 |
| 12 | 160 | $1,920 | $1,682 | $9,503 |

- **Year 1 operating profit: $9,503** on $11,520 of revenue.
- After the $0 startup spend: $9,503.
- Startup money earned back: month 1.
- Cash you need before it pays for itself: **$0**.

## What if

| scenario | margin at plan | break-even (paid seats) | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | 89% | 9 | $9,503 |
| Price -10% | 87% | 10 | $8,351 |
| Volume -20% | 88% | 9 | $7,366 |
| Unit costs +15% | 88% | 9 | $9,378 |

No red flags in these numbers. They are only as good as the inputs: check every cost against a real quote.
