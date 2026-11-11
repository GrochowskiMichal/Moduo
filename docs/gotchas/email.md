# Gotchas: Email engine and import

Read before working in `apps/app/src/features/email/`, `apps/desktop/src-tauri/src/mail/`, `supabase/functions/_shared/email/` and the auth hooks. Index of all areas: [docs/gotchas.md](../gotchas.md).

Compiled on 2026-10-27 (HV-14c, specs/harness-v3.md AC30): every entry became an ast-grep rule, a test, a comment at the trap, a path rule or a doc, or was deleted as stale. A path rule loads by itself when you open a file it covers.

## Where the traps live now

- **Rebuilt engine (`apps/desktop/src-tauri/src/mail/`, specs/mail-rebuild.md):** traps are commented at their code and the decisions are in [docs/decisions/email.md](../decisions/email.md) (MR-0…MR-16). The legacy engine (`commands/email/`, `email_sync/`, redb mail tables) and its page were deleted in MR-16; `scripts/ci/legacy-email.test.ts` keeps them out, and its traps went with it. Those that still apply to the rebuilt engine (async OAuth refresh before IMAP/SMTP use, `References` from header fields, `UIDVALIDITY` resets) are commented in `src/mail/`.

- **Path rules:** [email](../../.claude/rules/email.md) (the half-patched follow-up guard, outbox retention and kick, auth hook setup and testing, payloads naming other people, the Deno connector), [supabase-sql](../../.claude/rules/supabase-sql.md) §Across modules (self-reminders, checking a deployed definition, `now()` in a transaction).
- **Comments at the trap**, by trap:
  - App (`apps/app/src/features/email/`): spine gestures record what they created and undo only that (`commands/spine.ts`); reply-all keeps Cc (`compose.ts`); the web page reads only the `email_refs` tissue (`hooks/use-email-tissue.ts`); the reader's two no-script layers and srcset detection (`utils/email-html.ts`); prefs sync is whole-object LWW (`prefs.ts`); depth copy (`history-depth.ts`, `ui/email-history-depth-select.tsx`). Also `apps/app/src/lib/prefs-columns.ts` (deploy-gated prefs column), `apps/app/src/lib/entity-open.ts` (id-less open), `apps/app/src/components/auth/otp-send-error.ts` (invite-only refusal), `apps/app/src/components/ui/select.tsx` (`aria-label` on a trigger).
  - Transactional kit and hooks: Outlook dark-mode attributes and the "auto" look (`supabase/functions/_shared/email/render.ts`), image sizes, transparent ink artwork and 200-for-missing-files (`assets.ts`), payload-only rendering and the template union (`templates/index.ts`), sender-name allow-list (`templates/names.ts`), Resend's delivered time (`resend-webhook.ts`), the 5-second hook budget, reversed `email_change` tokens and the no-FK log (`supabase/functions/auth-email-hook/handler.ts`), invite links (`templates/auth-variants.ts`), ", "-joined signatures (`supabase/functions/_shared/standard-webhooks.ts`), `email_thread` ids (`supabase/functions/moduo-mcp/modules/email.ts`).
- **Tests and the compiler:** `classify.test.ts` pins the smart-inbox order; lettre's private header fields and the typed `.select()` literal fail to compile.
- **Docs:** [docs/email-runbook.md](../email-runbook.md) (deploys and hook setup).

## Open entries

A new trap goes here (the trap, why, what to do instead) only until it has a better home; one that bites twice becomes a hook, a lint rule or a test.

- **The lab's Mail states open the first row, and pinned threads head the list.** The fixture pins about one thread in ten, so "the newest Personal thread" is below the Pinned group; a scenario that dresses one thread (`intro`, `bodyOffline`) also pins it so it is the first row (`testing/fake-engine.ts` `headTheList`).
