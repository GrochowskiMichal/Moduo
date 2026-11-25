# An undecodable mail follow-up is deleted on read

**Mechanism:** `decode-failure-then-delete` (variant of seed 509-5).

**Escaped in:** `origin/mike`; found by HV-15 nightly variant hunt 2026-11-07 (draft PR #801).
**Fix commit:** [`d71a171f6`](https://github.com/GrochowskiMichal/Moduo/commit/d71a171f68c333d0abb45eb9555a3a7b0b982983) (PR #822). `followup_rows` skips a `followup:<thread>` value it can't decode and leaves it in place instead of `kv_delete`.

**Sites fixed:**
- `apps/desktop/src-tauri/src/mail/host/reader.rs`

**Regression test** (fails with the fix reverted):
- `apps/desktop/src-tauri/src/mail/host/reader/unreadable_followup.rs` · "an_unreadable_follow_up_survives_the_followups_read"  
  `cd apps/desktop/src-tauri && cargo test --lib an_unreadable_follow_up_survives_the_followups_read`

**What a variant looks like:** A read that deletes what it can't decode: is the blob left alone (or surfaced) instead?
