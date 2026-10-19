> Full-time view: both founders paid $8k a month each. The unit is one paid seat for one month; every "a day" means paid seats that month. The plan of 2,000 seats is illustrative; the break-even is the number that matters. The note and context are in [cfo.md](./cfo.md).

# Unit economics: Moduo Pro (day-loop wedge): founders full-time at $8k each

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

Fixed costs: $16,498 a month (Supabase Pro (one project; Micro compute covered by credits) [public price] $25, Supabase compute step-up to Small for Realtime headroom [estimate] $15, Cloudflare Workers Paid (app, landing, update server, R2) [public price] $5, Resend Pro (transactional email) [public price] $20, GitHub Pro + metered Actions minutes for macOS/Windows builds [estimate] $24, Apple Developer Program ($99/yr) [public price] $8, moduo.app domain (~$15/yr) [estimate] $1, Founders' pay, 2 x $8,000 (low end of the $8-10k baseline; gross, before employer costs, which depend on the country) [founders 2026-10-19] $16,000, Claude Max 20x, two seats at $200 (founders' own spend; Startup-program credits not counted) [founders 2026-10-19; seat count to confirm] $400).

- **Break-even: 1,483 paid seats a month.** Below that you lose money every month.
- **Profit margin at your plan** (2,000 a day): **24%** of every sale, after every cost.

## Year 1, month by month

| month | paid seats a month | revenue | profit | cumulative (after $0 startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 2,000 | $24,000 | $5,762 | $5,762 |
| 2 | 2,000 | $24,000 | $5,762 | $11,523 |
| 3 | 2,000 | $24,000 | $5,762 | $17,284 |
| 4 | 2,000 | $24,000 | $5,762 | $23,046 |
| 5 | 2,000 | $24,000 | $5,762 | $28,808 |
| 6 | 2,000 | $24,000 | $5,762 | $34,569 |
| 7 | 2,000 | $24,000 | $5,762 | $40,330 |
| 8 | 2,000 | $24,000 | $5,762 | $46,092 |
| 9 | 2,000 | $24,000 | $5,762 | $51,854 |
| 10 | 2,000 | $24,000 | $5,762 | $57,615 |
| 11 | 2,000 | $24,000 | $5,762 | $63,376 |
| 12 | 2,000 | $24,000 | $5,762 | $69,138 |

- **Year 1 operating profit: $69,138** on $288,000 of revenue.
- After the $0 startup spend: $69,138.
- Startup money earned back: month 1.
- Cash you need before it pays for itself: **$0**.

## What if

| scenario | margin at plan | break-even (paid seats) | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | 24% | 1,483 | $69,138 |
| Price -10% | 16% | 1,662 | $40,338 |
| Volume -20% | 7% | 1,483 | $15,714 |
| Unit costs +15% | 23% | 1,500 | $66,006 |

No red flags in these numbers. They are only as good as the inputs: check every cost against a real quote.
