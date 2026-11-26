---
paths: ["supabase/functions/_shared/contracts/**", "apps/app/src/features/*/model.ts"]
incident: "Parallel unions of plan tiers and task statuses drifted from the Postgres CHECKs before the contracts folder existed (AGENTS.md rule 4)."
expires: 2027-05-26
---

# Domain contracts (Zod + enums)

Closed vocabularies (plan tier, task status, roles, link origins, …) live in `supabase/functions/_shared/contracts/` (`vocabularies.ts`, `primitives.ts`, `errors.ts`); app code imports `@contracts/*`, Edge Functions import relatively. To add or change a value: (1) const array + Zod schema + type in `vocabularies.ts`; (2) keep `parse*` (strict, writes), `normalize*` (lax, reads) and `is*` in lockstep; (3) migrate the Postgres CHECK/enum in the same change; (4) when a value dies, remove it everywhere, no zombie unions. Leave **open** strings alone (polymorphic entity types, renamable contact statuses, IMAP folders, Stripe events, opaque prefs). Never invent a parallel union in `apps/app/src/features/*/model.ts`.
