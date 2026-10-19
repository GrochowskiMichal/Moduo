> Full-time view: both founders paid $8k a month gross through a Polish sp. z o.o., with employer costs at their upper bound. The unit is one paid seat for one month; every "a day" means paid seats that month. The plan of 2,000 seats is illustrative; the break-even is the number that matters. The note is in [cfo.md](./cfo.md).

# Unit economics: Moduo Pro (Polish sp. z o.o.) (day-loop wedge): founders full-time at $8k each

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

Fixed costs: $20,248 a month (Supabase Pro (one project; Micro compute covered by credits) [public price] $25, Supabase compute step-up to Small for Realtime headroom [estimate] $15, Cloudflare Workers Paid (app, landing, update server, R2) [public price] $5, Resend Pro (transactional email) [public price] $20, GitHub Pro + metered Actions minutes for macOS/Windows builds [estimate] $24, Apple Developer Program ($99/yr) [public price] $8, moduo.app domain (~$15/yr) [estimate] $1, Founders' pay, 2 x $8,000 gross (low end of the $8-10k baseline) [founders 2026-10-19] $16,000, Claude Max 20x, two seats at $200 (founders' own spend; Startup-program credits not counted) [founders 2026-10-19; seat count to confirm] $400, Accounting office in Poland (full books for a sp. z o.o., ~PLN 600-1,500/month) [estimate] $250, Employer costs in Poland on an employment contract (ZUS ~20.5% + PPK 1.5% of gross; upper bound, lower above the ZUS cap or with B2B or board-appointment pay) [public rates, 2026] $3,500).

- **Break-even: 1,820 paid seats a month.** Below that you lose money every month.
- **Profit margin at your plan** (2,000 a day): **8%** of every sale, after every cost.

## Year 1, month by month

| month | paid seats a month | revenue | profit | cumulative (after $75 startup) |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 2,000 | $24,000 | $2,012 | $1,936 |
| 2 | 2,000 | $24,000 | $2,012 | $3,948 |
| 3 | 2,000 | $24,000 | $2,012 | $5,960 |
| 4 | 2,000 | $24,000 | $2,012 | $7,971 |
| 5 | 2,000 | $24,000 | $2,012 | $9,982 |
| 6 | 2,000 | $24,000 | $2,012 | $11,994 |
| 7 | 2,000 | $24,000 | $2,012 | $14,006 |
| 8 | 2,000 | $24,000 | $2,012 | $16,017 |
| 9 | 2,000 | $24,000 | $2,012 | $18,028 |
| 10 | 2,000 | $24,000 | $2,012 | $20,040 |
| 11 | 2,000 | $24,000 | $2,012 | $22,052 |
| 12 | 2,000 | $24,000 | $2,012 | $24,063 |

- **Year 1 operating profit: $24,138** on $288,000 of revenue.
- After the $75 startup spend: $24,063.
- Startup money earned back: month 1.
- Cash you need before it pays for itself: **$75**.

## What if

| scenario | margin at plan | break-even (paid seats) | year 1 profit |
| --- | ---: | ---: | ---: |
| Base plan | 8% | 1,820 | $24,138 |
| Price -10% | -2% | 2,040 | -$4,662 |
| Volume -20% | -13% | 1,820 | -$29,286 |
| Unit costs +15% | 7% | 1,841 | $21,006 |

No red flags in these numbers. They are only as good as the inputs: check every cost against a real quote.
