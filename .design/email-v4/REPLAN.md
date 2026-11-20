# Mail v4: the rethink

> **Status (2026-11-21): round 1 being prepared.** Phase 1 (design, with Maciej). No product code, no migrations.
> - Branch `t/maciej/email-plan` (from `origin/maciej` @ e566e71ef). Plan file: this one. Research lanes: [`research/`](./research/).
> - **Open:** everything in §8 round 1.
> - **Next:** Maciej answers round 1 → round 2a (every surface, state by state) → 2b → reconcile → final prototype through the critic loop → spec `specs/mail-v4.md` → Ready.
> - **Re-entry point for a fresh session:** this status block, then §8.

## 0. How to read this

| § | What it covers |
| --- | --- |
| §1 | Diagnosis: what Mail is today, what's strong, what's missing |
| §2 | The benchmark: Spark and Superhuman, feature by feature (summary; full tables in `research/`) |
| §3 | The proposed shape of Mail v4 |
| §4 | What only Moduo can do: the links |
| §5 | Technical decisions taken by the agent (never asked) |
| §6 | Calls for Mike (performance and reliability, in product terms) |
| §7 | Cross-module asks (Calendar and others) |
| §8 | The calls, by round |
| §9 | What happens next |

Who decides: Maciej decides product (features, UX, UI, copy, keys, feel). Mike owns systems; his Mail rebuild (MR), v3 (MV) and improve (MI) are the foundation. Agent's choices are marked as such.

(Sections are filled in below.)
