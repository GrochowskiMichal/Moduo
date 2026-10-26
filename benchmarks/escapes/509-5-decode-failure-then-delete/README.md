# Desktop: an undecodable store reads as empty, the next save deletes everything

**Mechanism:** `decode-as-empty-then-overwrite`. A stored value that fails to decode (old shape, corruption) is read as an empty list; the next save writes that empty list back over the real data. Separately, `wipe_all` kept its own table list and missed the cloud sync tables.

**Escaped in:** `origin/mike` before PR #509; found by the manual audit of 2026-10-20.
**Fix commit:** [`9a4590545`](https://github.com/GrochowskiMichal/Moduo/commit/9a45905456d59aab9ea8535b25c284bcd2c901ff) (PR #509). An account list that won't decode returns an error instead of an empty list; `wipe_all` and `ensure_schema` share one `ALL_TABLES` list.

**Sites fixed:**
- `apps/desktop/src-tauri/src/commands/email/storage.rs`
- `apps/desktop/src-tauri/src/store_redb/mod.rs`

**Regression test** (fails with the fix reverted):
- `apps/desktop/src-tauri/src/commands/email/storage.rs` · "unreadable_account_list_is_an_error_not_empty"  
  `cd apps/desktop/src-tauri && cargo test --lib unreadable_account_list_is_an_error_not_empty`
- `apps/desktop/src-tauri/src/store_redb/mod.rs` · "wipe_all_clears_the_cloud_sync_tables"  
  `cd apps/desktop/src-tauri && cargo test --lib wipe_all_clears_the_cloud_sync_tables`

**What a variant looks like:** `serde_json::from_str(..).unwrap_or_default()`, `.ok().unwrap_or_default()`, `JSON.parse` in a `try` that returns `[]`, schema guards that return `[]` on a bad row, followed by a read-modify-write save. Also any second hand-kept list of tables, keys or domains next to a canonical one.
