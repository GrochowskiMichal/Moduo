# Wedge comparison: which first customer should Moduo lead with?

Four panels run on 2026-10-19 with `/founder-consumer --quick`: 20 simulated buyers each, seed 7, customer profiles as corrected by the founders the same day. Raw results are in each wedge's `panel/results.md`; the answers are in `panel/answers/`.

**Simulated buyers are not customers.** Use this for objections and wording, not for forecasts. Confirm the winner with 10–20 real waitlist people at a founding price paid up front.

## Headline: 0 buy out of 80, so buy rate can't pick the winner

| Wedge | Buy rate (upper bound) | Buys in month 1 | Said they'd try the free plan or trial* | Plan price | Median price answers: bargain · expensive · too expensive |
| --- | ---: | ---: | ---: | --- | --- |
| client-hub | 0 / 20 | 0 | 10 / 20 | $12 | $6 · $15 · $25 |
| day-loop | 0 / 20 | 0 | **16 / 20** | $12 | $5.50 · **$12** · $18 |
| duo | 0 / 20 | 0 | 6 / 20 | $20 for two | $10 · $25 · $40 |
| studio | 0 / 20 | 0 | 3 / 20 | $15 / seat, min 3 | $8 · $18 · $28 (mixed units, see below) |

\* The try count is my reading of the buyers' own words: they mention a trial, the free plan or trying it. The panel tool doesn't produce it.

**Why every wedge reads 0%.** This is mostly the test, not the market:

- **The question doesn't fit the offer.** Buyers were asked how many times they'd *buy in the first month*. Every pitch offers a 14-day trial with no card, so a sensible buyer answers "I'd try it free" and logs 0 purchases. Many did exactly that.
- **The brief pushes answers down.** It tells every buyer that "most people do not buy most things" and not to be agreeable. The README expected the opposite bias (agreeable buyers, so treat buy rate as an upper bound). Here the floor won instead.

So buy rate ties at zero. The ranking below uses the other three signals: how many buyers would try it, whether the reasons to pass are fixable, and whether the price fits.

## Seeded doubts vs. real signal

Each buyer's brief handed them one objection from `customer.json` as "the first thing that comes to mind". By a rough word-overlap check, most buyers made that seeded doubt their main objection: client-hub 12/20, day-loop 9/20, duo 16/20, studio 15/20. Those objections are **echo**: they confirm the profile, not the market.

Signals nobody seeded carry more weight:

- **day-loop:** the main feature itself, the done / push / shrink / drop check-in, read to 9 buyers as "nagging" or as "Sunsama's shutdown ritual again". That's the pitch's wording, not the product.
- **All four wedges:** "pull in my Gmail and calendar and have me set up in under an hour" or "one-click import from Notion / Todoist / Trello". Switching cost is the shared blocker.
- **duo:** voice notes. They were seeded only as a habit, never as an objection, and still came up in 8 answers.
- **studio:** estimate vs. actual hours per client project. This goes past the seeded "time tracking" doubt.
- **client-hub:** where client email is stored. 2 buyers asked for local-only or encrypted mail.

## Wedge by wedge

Counts in the tables are buyers whose reason, objection or "what would flip it" mentions the theme (keyword matches I checked by hand). One buyer can count toward several rows, so the counts are approximate.

### client-hub: solo freelancers and consultants ($12)

**Top reasons to pass**

| Reason | Buyers | Fatal or fixable |
| --- | ---: | --- |
| Habit / switching: the current stack works, and moving is a weekend | 10 | **Fixable.** Auto-import from Gmail, calendar and contacts, plus importers for Notion, Todoist and spreadsheets. |
| No time tracking or invoicing, so it adds an app instead of replacing one | 7 | **Fatal for now.** Time per client is on the "Not yet" list; invoicing isn't planned at all. |
| Outlook / Microsoft 365 | 2 | **Fatal for that slice.** Outlook is "Not yet". |
| Trust: where client email lives, and startup risk | 3 | **Fixable if true.** State plainly where mail is stored. Needs a fact check before it goes in the pitch. |

**What would flip a no:** invoicing from tracked time (5), a setup in under an hour with auto-import (4), proof that the email client is good enough to quit their current one (3).

**Price:** $12 sits under the "expensive" median of $15. Price isn't the problem.

### day-loop: time-blockers who churned off Motion, Sunsama and the like ($12)

**Top reasons to pass**

| Reason | Buyers | Fatal or fixable |
| --- | ---: | --- |
| Habit: "I've churned off planners before; prove this one sticks" | 11 | **Partly fixable.** A free plan that runs the whole loop for a month. Some said "the app was never the problem, I am", and no product fixes that. |
| Two-way sync with a *work* Google or Outlook calendar, iCloud alongside, or sitting on top of Google Calendar | 12 | **Fixable, nearest of all the gaps.** Google/Outlook OAuth is "built, not proven end-to-end". Prove it, then say it. |
| The end-of-block prompt sounds like nagging | 9 | **Fixable in the pitch.** Say it's one quiet prompt that can be ignored or batched into an end-of-day review, and check the app really behaves that way. |
| Doesn't want notes, contacts and email inside a planner | 10 | **Fixable in the pitch.** Lead with the planner and mention the rest as optional. |
| No phone app, or no keyboard-first flow and integrations | 4 | Mobile is out of scope (fatal for 1 buyer). Keyboard-first is partly there already. |

**What would flip a no:** still opening it every day after a month on the free plan (6), proven two-way work-calendar sync (6), a layer on top of Google Calendar rather than a replacement (3), a planner-only price of about $5–6 (2).

**Price:** the tightest fit of the four. $12 sits exactly at the "expensive" median, and the "too expensive" median is $18. The founding-member Pro price of $8 (locked 2026-10-02) lands inside the acceptable band.

### duo: co-founder and partner pairs ($20 for two)

**Top reasons to pass**

| Reason | Buyers | Fatal or fixable |
| --- | ---: | --- |
| Getting the partner to switch: one person moving isn't enough | most | **Structural.** Every tool for two has this. Only the partner's own pull fixes it. |
| Losing the Notion setup and templates | 10 | **Fixable.** A Notion importer. |
| Voice notes; the chat isn't as reliable as WhatsApp or Slack | 8 | **Fatal for now.** Voice notes aren't built. Pulling in WhatsApp won't happen. |
| No phone app | 2 | **Fatal for this group.** Mobile is out of scope. |

**What would flip a no:** a one-click Notion import (6), voice notes in the chat (5), the partner asking to switch (3), connecting into Google Workspace instead of replacing it (3).

**Price:** the most headroom. $20 for two is under the $25 "expensive" median. Price isn't what stops this group; habit does (17 of 20 passed for habit).

### studio: agencies and studios of 3–5 ($15 a seat, minimum 3)

**Top reasons to pass**

| Reason | Buyers | Fatal or fixable |
| --- | ---: | --- |
| No time tracked per client, or estimate vs. actual | 9 | **Fatal for now.** On the "Not yet" list. |
| Per-seat pricing; contractors and clients need free guest access; Basecamp is $59 flat | 11 | **Fatal unless the founders reopen pricing.** Team is per seat with a minimum of 3 (decided 2026-10-02). A viewer role exists, but whether viewers are free seats is a pricing call, not a fact the pitch can state today. |
| Moving the team off Slack and Trello at once | 6 | **Fixable.** A Trello importer, a Slack bridge. |
| No reviews or track record (G2, Capterra) | 4 | Only time fixes this. |
| No "waiting on client" state or client status view | 3 | **Fatal for now.** Both are "Not yet". |

**What would flip a no:** time per client with estimate vs. actual (9), free guests or a flat price (7), Trello and Slack import (3).

**Price:** per seat, $15 sits under the $18 "expensive" median. **Mixed units:** P001, P005 and P009 answered for the whole workspace ($30/$59/$90, $40/$90/$150, $30/$60/$99), and the rest answered per seat. Remove or rescale those three before running `van_westendorp.py` on this folder.

## Recommendation: lead with **day-loop**

**The rule:** pick the wedge where (1) the most buyers would try it, (2) the top reasons to pass are mostly fixable with what's built or nearly built, and (3) the plan price falls inside the acceptable band, or a price already decided does.

| | Would try | Top 3 reasons fixable? | Price fits? |
| --- | --- | --- | --- |
| **day-loop** | **16 / 20** | **Mostly:** calendar-sync proof and pitch wording (nagging, planner first). The churner habit is only partly fixable. | Tight at $12; the founding $8 fits |
| client-hub | 10 / 20 | Mixed: switching is fixable, invoicing and time per client aren't built | Yes |
| duo | 6 / 20 | Mostly not: partner adoption, voice notes, mobile | Yes, most headroom |
| studio | 3 / 20 | Mostly not: time per client, and pricing contradicts a locked decision | Yes per seat |

Day-loop wins on the first two and trails on price. That's the cheapest gap to close, because the founding price is already decided.

**Why day-loop:** the feature buyers react to (the check-in, roll-forward and reflow) is already shipped, and it's what they want to try. What stops them is mostly proof and wording: show two-way work-calendar sync working, recast the prompt as calm rather than nagging, and lead with the planner, not the whole suite.

**The risks to test with real people:**

1. **Proven calendar sync is the precondition.** Twelve of 20 mentioned two-way sync with a work Google or Outlook calendar. Until desktop OAuth is proven end-to-end, the pitch can't promise it and this wedge stays capped.
2. **Churners are trial-happy but cheap.** "Would try free" may turn into free-plan users who never pay. The real test is whether founding members pay $8 up front.
3. **"The app was never the problem, I am."** Some planner churners can't be won by any product. Expect real conversion well below the try rate.

**Runner-up:** client-hub. Its price fits and switching cost is fixable, but until time per client and invoicing are on the roadmap, half the group sees Moduo as one more app rather than one fewer. Duo and studio both hit gaps that are out of scope (mobile, voice notes) or would mean reopening a locked pricing decision.

## Before copying the winner to `founder/`

- Re-run day-loop once the pitch is reworded (calm check-in, planner first, the sync that is actually proven). Same seed, to see whether the try count holds.
- Confirm with 10–20 matching waitlist people at the $8 founding price paid up front.
- Pricing (`/founder-pricing`) waits on roadmap Q3, which is blocked on a cost model (`/founder-cfo`).
