# Wedge test: which first customer should Moduo lead with?

Four pitches for the same product, each aimed at a different first customer. Each folder has a `customer.json` (who the simulated buyers are) and a `pitch.md` (what every buyer sees, word for word). The founder-consumer skill runs each one past 20 simulated buyers.

| Wedge | First customer | Promise | Plan |
| --- | --- | --- | --- |
| [client-hub](./client-hub/) | Solo freelancers and consultants | Every client in one place, no logging | Pro $12 |
| [day-loop](./day-loop/) | Time-blockers who churned off Motion/Sunsama/Morgen | A plan that survives the day | Pro $12 |
| [duo](./duo/) | Co-founder and partner pairs | One workspace for both of you, chat included | Duo $20 for two |
| [studio](./studio/) | Agencies and studios of 3–5 | One workspace for the studio | Team $15/seat, min 3 |

## Before running

- **Correct the customers.** Every `customer.json` has a `_notes` line saying which parts come from research and which are guesses (income ranges, behaviour shares). The skill says to show the profile and let the founders correct it. A wrong customer makes the whole panel wrong.
- **Check the pitches stay true.** Nothing in a pitch should promise more than the app does today (see "What's already built" in [../idea.md](../idea.md)).
- **Cost:** `--quick` is 20 sub-agents per wedge, so 80 for all four. Switch Claude Code to accept-edits mode, or approve 80 file writes one by one.

## How to run (one wedge at a time, same seed for all four)

`panel.py` takes `--dir` *before* the subcommand. That keeps each wedge's panel in its own folder. Use `python` on Windows (`python3` hits the Microsoft Store alias); `python3` works on macOS.

```bash
P=.claude/skills/founder-consumer/panel.py
W=founder/wedges/client-hub        # then day-loop, duo, studio
python $P --dir $W/panel init --customer $W/customer.json --pitch $W/pitch.md --n 20 --seed 7
python $P --dir $W/panel prompts   # then one Agent call per brief, in waves of 10
python $P --dir $W/panel check
python $P --dir $W/panel tally     # writes $W/panel/results.md + results.json
```

Or ask Claude: "run /founder-consumer --quick on founder/wedges/<name>, using `--dir founder/wedges/<name>/panel` and seed 7."

## How to compare

The four wedges are different populations, so **don't pick the winner on buy rate alone**. Language-model buyers lean agreeable, so treat every buy rate as an upper bound. For each wedge, write down:

1. Buy rate (upper bound) and buys in the first month.
2. The top three reasons buyers pass. Are any of them **fatal** (for example, a missing feature we won't build) or **fixable** (wording, offer, price)?
3. What would flip a no. Can we deliver it cheaply?
4. Price answers: does the plan's price fall inside the acceptable range? (`/founder-pricing` can run on `$W/panel/answers`.)

Put the comparison in `founder/wedges/comparison.md`. Then copy the winner's `customer.json` and `pitch.md` to `founder/` and continue the pack: `/founder-board` → `/founder-competitors` → `/founder-pricing` → `/founder-offer` → `/founder-cfo` → `/founder-launch` → `/founder-plan`.

Simulated buyers find objections and wording; they don't predict conversion. Confirm the winner with real people: invite 10–20 people from the waitlist who match the wedge, and offer a founding-member price paid up front.
