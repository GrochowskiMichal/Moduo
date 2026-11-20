# A Chat edit jumps its own message's waiting send

**Mechanism:** `queue-bypass`.

**Escaped in:** `origin/mike`; found by HV-15 variant hunt 2026-10-23 (MOD-562).
**Fix commit:** [`fd2ac715c`](https://github.com/GrochowskiMichal/Moduo/commit/fd2ac715c706763af7e76c11a8d2dcfa7ae0a7e3) (PR #645). `edit()` of a message still in the outbox changes the words the send carries; one whose send already went out (`attempted`) keeps them as `edited` and is edited on the server once it lands (answer, echo or resend); a delete after a lost answer is deleted there the same way.

**Sites fixed:**
- `apps/app/src/features/chat/store/store.ts`

**Regression test** (fails with the fix reverted):
- `apps/app/src/features/chat/store/store.509-2.variant.test.ts` · "editing a message while it is being sent keeps the edited words on the server"  
  `bun run --cwd apps/app test src/features/chat/store/store.509-2.variant.test.ts`
- `apps/app/src/features/chat/store/store.509-2.variant.test.ts` · "editing a send still waiting for the network sends the edited words, with no edit call"  
  `bun run --cwd apps/app test src/features/chat/store/store.509-2.variant.test.ts`
- `apps/app/src/features/chat/store/store.509-2.variant.test.ts` · "edited while sending and the answer is lost: edited once its echo lands"  
  `bun run --cwd apps/app test src/features/chat/store/store.509-2.variant.test.ts`
- `apps/app/src/features/chat/store/store.509-2.variant.test.ts` · "an edit after a send whose answer was lost reaches the server when the resend lands"  
  `bun run --cwd apps/app test src/features/chat/store/store.509-2.variant.test.ts`
- `apps/app/src/features/chat/store/store.509-2.variant.test.ts` · "a delete after a send whose answer was lost deletes it on the server once the resend lands"  
  `bun run --cwd apps/app test src/features/chat/store/store.509-2.variant.test.ts`

**What a variant looks like:** A write over a row (`react`, `pin`, `wrapUp`, …) on a message that is still in the outbox: does it wait for the send?
