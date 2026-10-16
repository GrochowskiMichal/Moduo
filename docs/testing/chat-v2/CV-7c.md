# Manual test checklist — CV-7c Reactions widened

> Generated 2026-10-15 · branch `t/maciej/cv-checkpoint-3`, folded from the record [`CV-7c`](../../build/chat-v2/CV-7c.md) (block branch `t/maciej/cv-7c-reactions`) · **Live-verified:** partly. `chat_reactions.test.sql` and the unit tests pass; `tests/reactions.spec.ts` ran green with `tasks-detail.spec.ts` and `chat-stream.spec.ts` (11 passed); the visual kit spec was not run. Tier 2 (migration).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Server checks (terminal, local stack up)

- [ ] **Do:** with `20261017108000_chat_v2_reactions.sql` applied, run `bun run db:test chat` → **Expect:** every chat file passes, among them `chat_reactions` _(terminal)_
- [ ] **Do:** `bunx playwright test --project=visual tests/visual/kit.spec.ts` → **Expect:** the Reactions story passes at three densities _(terminal)_

## In the app

- [ ] **Do:** hover a chat message → **Expect:** 👍 ✅ 👀 · Reply · Task · ⋯ _(Chat stream)_
- [ ] **Do:** right-click a message → **Expect:** all six on top, "Customize…" under them, which opens Settings → Chat _(Chat)_
- [ ] **Do:** Settings → Chat, click slot 1, paste 🎉, "Use it" → **Expect:** slot 1 is 🎉; hovering a message shows 🎉 first _(Settings, Chat)_
- [ ] **Do:** type "party" in a slot → **Expect:** "That isn't an emoji." and "Use it" disabled _(Settings)_
- [ ] **Do:** task comment → ☺ → your row; pick one → **Expect:** a chip with a count; hover says "You" _(Task detail)_
- [ ] **Do:** note comment → ☺ and chips → **Expect:** they work the same _(Notes comments panel)_
- [ ] **Do:** "Use Moduo's six" → **Expect:** 👍 ✅ 👀 🙏 ❤️ 😄 _(Settings → Chat)_
- [ ] **Do:** look at the chips at Comfortable, Compact and Dense → **Expect:** all three read well _(Storybook `components-ui-reactions--densities`)_

## Edge cases

- [ ] **Do:** react as a viewer, and try a 21st kind → **Expect:** a viewer may react; the 21st is refused _(psql)_
- [ ] **Do:** react to a message you can't read → **Expect:** "That message no longer exists." (the same as a missing one) _(psql)_

## Verify before release

- [ ] **Do:** release order → **Expect:** the migration and the app ship on the same train; web promoted and the desktop release cut together, with `src/lib/min-build.ts` raised, because an app from before CV-7c shows no comment reactions once the rewrite runs _(release)_
- [ ] **Do:** count chat reaction keys on prod that aren't keys at all (v1 text keys) → **Expect:** none; if any, clear them in a data step (they count toward the 20 kinds and can't be taken off) _(prod)_
- [ ] **Do:** note that the data step gives respelled chat messages a new `updated_at` _(prod)_

## Known gaps / not-yet-testable

- The chat hover and menu quick buttons are still drawn in `message-actions.tsx` (no pressed state), not through `QuickReactionRow`; the app doesn't stop a 21st kind before the server does; the quick row is fetched once per session.
- `chat/timeline.ts`'s jumbo "only emoji" rule differs from the reaction key at the edges.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). The record holds the numbers: [CV-7c](../../build/chat-v2/CV-7c.md).*
