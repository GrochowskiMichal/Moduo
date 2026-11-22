# Failed prefs, uploads and profile reads read as empty, then overwrite or delete; a user switch drops unsynced prefs

**Mechanism:** `error-read-as-empty` (variant of seed 509-1).

**Escaped in:** `origin/mike`; found by HV-15 nightly variant hunts 2026-10-23 → 2026-11-15 (draft PRs #774, #777, #793, #810, #813, #814) and the parked 509-3 prefs proof.
**Fix commit:** [`7f9e78283`](https://github.com/GrochowskiMichal/Moduo/commit/7f9e78283963e13ac056f23f24a526112ec403cf) (PR #822). `getAuthedUserOrThrow` tells a failed auth lookup from signed-out, so prefs and Home layout reads error instead of answering "no row"; another person's unsynced prefs are parked under them (their own copy, via `localValueOf`) and pushed when they return; Reset keeps unsynced prefs and is blocked when the uploads DB can't be read; a failed profile read uploads no avatar and saves no booking-link host.

**Sites fixed:**
- `apps/app/src/lib/runtime.web.shared.ts`
- `apps/app/src/lib/runtime.web.preferences.ts`
- `apps/app/src/lib/prefs-sync.ts`
- `apps/app/src/lib/uploads/store.ts`
- `apps/app/src/lib/uploads/index.ts`
- `apps/app/src/features/settings/advanced.ts`
- `apps/app/src/features/branding/profile-avatar.ts`
- `apps/app/src/features/calendar/ui/booking-links.tsx`

**Regression test** (fails with the fix reverted):
- `apps/app/src/lib/prefs-sync.509-1.test.ts` · "a new device that boots offline never pushes its defaults over the account's prefs"  
  `bun run --cwd apps/app test src/lib/prefs-sync.509-1.test.ts`
- `apps/app/src/lib/prefs-sync.509-3.test.ts` · "A's offline preferences change reaches A's account after B used the browser in between"  
  `bun run --cwd apps/app test src/lib/prefs-sync.509-3.test.ts`
- `apps/app/src/lib/uploads/store.645-3.test.ts` · "a file waiting on disk still blocks the reset when the uploads database fails to open"  
  `bun run --cwd apps/app test src/lib/uploads/store.645-3.test.ts`
- `apps/app/src/features/branding/profile-avatar.509-1.test.ts` · "keeps the account's picture when the profile read fails"  
  `bun run --cwd apps/app test src/features/branding/profile-avatar.509-1.test.ts`
- `apps/app/src/features/calendar/ui/booking-links.644-1.test.tsx` · "saving a link while the profile read fails never replaces the host's name and photo with fallbacks"  
  `bun run --cwd apps/app test src/features/calendar/ui/booking-links.644-1.test.tsx`

**What a variant looks like:** A read whose error is dropped (`const { data } = await …`, `catch { return null }`) right before a write: does a failure write fallbacks over the real values?
