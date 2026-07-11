# Before refactoring the backend — a decision memo

**Audience:** Mike (and anyone weighing a backend change before alpha).
**Written:** 2026-07-11.
**Stance:** this is **not** a "no." It's a framework so the decision is *informed*. A backend refactor pre-alpha is sometimes exactly right — and sometimes it's the most expensive way to feel productive. The goal here is to make sure we can tell which one this is, together, against concrete triggers rather than taste.

> The one thing this memo can't do is read your reasons. If you want to change the backend, the most useful thing you can do is **name the concrete problem** you're solving and test it against §4/§5 below. If it clears that bar, you'll have my agreement; if it doesn't, you'll have saved months.

---

## 1. First: "refactor the backend" is four different proposals

They share a phrase and almost nothing else. Cost and merit differ by an order of magnitude. Pin down *which* before anything else:

| # | The proposal | Rough cost | My read |
|---|---|---|---|
| **A** | **Replace Supabase** with a custom backend (own Postgres + app server, or another BaaS) | **Very high** — re-implement auth, RLS, 35 migrations' worth of schema + intent ops, re-verify every invariant on live data, rebuild the MCP layer | **Hard to justify pre-alpha.** See §4/§5. |
| **B** | **Refactor *within* Supabase** — move business logic out of plpgsql intent-ops into edge functions / a thin app layer | **Medium** — real work, but incremental and reversible; the seam already supports it | **Legitimately debatable.** This is the real conversation (§6). |
| **C** | **Prune the dead Rust sidecar** — delete the graph/embeddings subsystem, feature-gate the paused local-auth/workspace vault + vestigial sync worker | **Low** — deletion behind a clean seam, ~1–2 days | **Do this. It's a genuine win** regardless of the bigger question (§3). |
| **D** | **Reshape the data model** — e.g. the polymorphic `entities` registry, the single `permissions_tasks` lane, the derived-notifications design | **Varies** — some are one-migration tweaks (per-module permission lanes), some are foundational (the registry) | **Case by case.** Some are already on the someday-list; ripping the registry would hit the moat. |

If the ask is **C**, we're aligned — let's just do it. If it's **A**, the bar in §4 is high and (I'll argue) not met pre-alpha. **B** and **D** are where the honest debate lives.

---

## 2. What the backend actually is today (so we're arguing about the real thing)

This is not accreted legacy spaghetti. It has a deliberate, consistent signature — worth understanding before deciding it needs replacing:

- **One seam.** All data flows through `getRuntime()` → `ModuoRuntime`. `runtime.web.ts` is the *only* file that talks to Supabase. Feature code never touches the client directly. That seam is exactly what makes any of B/C/D *incremental* instead of a rewrite.
- **One write pattern.** Every state change is a `SECURITY DEFINER` RPC (`<module>_op_<name>`) that checks permission, enforces invariants, and logs activity in a single transaction. Reads are RLS-filtered selects.
- **One integrity model.** A central `entities` registry; `entity_links`/`comments`/`tags` FK into it. One indexed query powers search, @mention, roll-up; deletes cascade cleanly.
- **Consistent RLS.** Member-`SELECT` only; no direct write policies; writes flow through the ops. Same shape on every module table.

**What's already done and in production:** 35 migrations applied, 7+ modules cloud-first, the spine (the moat) built Supabase-native, ~60 MCP tools across 6 modules, async multiplayer, Notes CRDT↔Postgres sync. This is months of decisions, not a prototype.

**Where the real debt actually is:** concentrated in **Rust**, not Supabase — a dormant tasks store, a paused local-auth/workspace vault, a near-vestigial sync worker, and a **fully dead graph + embeddings subsystem still booting in `AppState` with no caller**. That's proposal **C**, and it's cheap. The *cloud* backend is the coherent part.

---

## 3. Do the cheap win first, regardless (proposal C)

Independent of the big question: **prune the dead Rust.** Delete `graph_helix/` + `embeddings/` (no frontend caller), and feature-gate the paused local-auth/workspace/mnemonic vault + the `sync/mod.rs` remnant behind the future "lite" build. The clean `ModuoRuntime` seam means this touches **zero feature code**. It removes the single biggest chunk of misleading debt, shrinks the binary and `AppState` boot, and makes the actual architecture legible. If any refactor energy exists, spend it here first — it's all upside.

---

## 4. When a pre-alpha backend refactor IS justified (the honest bar)

Refactor the backend (proposal A or a foundational D) when at least one of these is **concretely, presently true** — not anticipated, not aesthetic:

1. **A scaling/perf wall you can measure.** The current design misses a launch-blocking perf budget and the cause is architectural, not a missing index. *(Note: the roadmap already names cloud-pivot perf regression as a P0 risk with "optimistic local writes + perf budgets" as the mitigation — so if this is the concern, it's a tuning task, not necessarily a rearchitecture.)*
2. **A security or data-integrity hole** the current model can't close without restructuring.
3. **A required product feature the model provably can't express** — e.g. a sharing/permissions shape RLS + `workspace_members` genuinely can't represent. *(The single-`permissions_tasks`-lane simplification is a known one-migration upgrade, not a wall.)*
4. **Velocity is actually blocked** — the team demonstrably can't ship features at an acceptable rate *because of* the backend (not because it's unfamiliar).
5. **An operational reality** — cost, compliance, or vendor risk with Supabase that's disqualifying at our scale.

If one of these holds: name it, and let's go. A refactor that removes a real blocker is worth it even pre-alpha.

---

## 5. When it ISN'T (the expensive-feeling-productive trap)

These are *not* sufficient reasons to refactor a working pre-alpha backend:

- **"I'd have built it differently."** Almost always true of any backend; almost never worth a rewrite.
- **Unfamiliarity.** A backend you didn't write feels wrong for a week. That's a reading cost, not a design flaw.
- **General cleanliness / "it's not how I'd structure it."** Purity has no users. Pre-PMF, the currency is validated product, not architecture you're proud of.
- **"plpgsql feels wrong."** A real opinion — addressed head-on in §6 — but a *preference about where logic lives*, not evidence the design is broken.

**The governing principle for a pre-alpha, two-person product: you refactor a backend when it *blocks* you, not before you have users, for cleanliness.** Every week spent re-implementing working, in-prod, invariant-verified infrastructure is a week not spent getting the alpha in front of people — which is the only thing that tells you whether any of this backend was even the right shape. Rebuilding it *before* that signal risks rebuilding it *wrong*, twice.

And the concrete re-litigation cost of proposal A specifically: 35 migrations to re-express, every intent-op invariant to re-verify against live data, the RLS model to reproduce, the entire MCP/agent-access layer (a product pillar) to rebuild, and every gotcha in [`docs/gotchas.md`](../gotchas.md) to re-discover. That's the months of grilling and decisions in [`docs/decisions.md`](../decisions.md), paid again.

---

## 6. The crux: business logic in plpgsql intent-ops

This is the most likely *real* objection, so let's steelman it rather than dodge it.

**The case against (fair points):** business logic in Postgres functions is harder to unit-test than app code, harder to version/review in a normal PR flow, harder to debug and observe, and skills-scarce (fewer people write plpgsql fluently). It's a legitimate engineering discomfort.

**Why it was chosen deliberately:** putting permission-check + invariant + activity-log in one `SECURITY DEFINER` transaction means invariants **cannot** be bypassed by any client, and — critically — it's what lets **external AI agents (the MCP layer) get safe writes for free.** Agents call the *same* intent ops as the UI, through scoped keys, and physically cannot corrupt state or skip an activity log. "AI is MCP-only, agents act via intent ops only" is a **product pillar**, not an implementation detail. Move the logic to an app server and you either re-implement that safety in a second place or lose the "agents write safely for free" property.

**The honest middle path (proposal B):** you don't have to choose all-or-nothing. The `ModuoRuntime` seam + edge functions let you move selected logic out of plpgsql into TS **incrementally, without touching Supabase or feature code** — as long as agent writes keep flowing through an invariant-preserving choke point. That's a legitimate evolution and reversible. What I'd push back on is doing it *as a pre-alpha sweep* rather than *per-module when a specific op actually hurts.*

So on the crux: it's a real tradeoff, not a settled question. But it argues for **incremental B**, not **rip-and-replace A** — and probably not before alpha.

---

## 7. Recommendation

1. **Now:** do proposal **C** (prune dead Rust). Cheap, pure win, makes the real architecture legible.
2. **Through alpha:** keep Supabase + the intent-op/spine/RLS model. It's coherent, done, in prod, and invariant-verified. Don't pay for it twice before you have the user signal that tells you if it was right.
3. **If you want to change *where logic lives* (B):** do it **incrementally per-op, behind the seam, preserving the agent-safe choke point** — not as a pre-alpha rewrite.
4. **Revisit the backend as a whole only against a concrete §4 trigger.** If one is real, name it and we refactor with a clear target.

---

## 8. Questions for Mike (let's answer these before any code)

1. **Which of A/B/C/D** is the actual proposal? (They're not the same conversation.)
2. **What concrete problem** does it solve — measured, present, and traceable to the backend (§4)?
3. **What does it unblock** that the current intent-op/spine/RLS model provably can't do?
4. **What happens to the MCP/agent-safe-write property** under your proposal?
5. **Can it wait until post-alpha / first user signal** without blocking the alpha — yes or no, and why?

If the answers point at a real §4 trigger, I'm in. If they point at §5, the highest-leverage move is to ship the alpha on what's there and revisit with data.

---

*Companion to [HANDOFF.md](./HANDOFF.md). Generated with [Claude Code](https://claude.com/claude-code).*
