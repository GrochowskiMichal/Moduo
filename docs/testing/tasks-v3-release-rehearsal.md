# Tasks v3 release rehearsal

> Last run 2026-10-14 on `t/maciej/tv-release-fixes` (from `t/maciej/tasks-v3-build` at `363fc9e6`, AT-3 and TV-U18 included). It used a throwaway Supabase stack only: the shared local stack (54321/54322) was read with read-only sessions and never written, and the cloud project was not touched. The first run on `d6d9f649` found the problems that §2 lists as fixed.

## Released 2026-10-14

- **One more replay first,** on a prod snapshot refreshed that morning, in prod order with TV-SEC1 added after file 28.
  - It caught one thing: Notes' `note_favorites_own_read` policy, live on prod since 10-13, also calls `can_access`. SEC1 now expects 18 policies.
  - Two test-base notes: the base needs prod's two `storage.buckets` rows, and `access_check.test.sql` accepts a refused anonymous read of `exposed_slot_links`, because prod grants `anon` nothing there.
- **Prod also had** Notes' `20261014120000_notes_agent_writes` (NR-6, from `mike`). No release file touches its objects.
- **Before the push:** 22 read-only checks of prod's rows against everything the release validates, all at 0.
- **The push:** a single `supabase db push --include-all --skip-vault` from a scratch folder (decision 2026-10-14 in decisions/workflow.md), so prod's history has the file versions.

## Summary

| Question | Answer |
| --- | --- |
| Do the migrations apply to a fresh database? | **Yes, with the fixes in §2.** In prod's order: the 9 migrations prod received after the snapshot, then the 32 release files. In timestamp order: the 35 repo files newer than the snapshot. No failures and no workarounds. |
| SQL suite (`supabase/tests`, 36 files) | 36/36 pass in both orders (1,871 checks). |
| Does the release order change the end state? | No. Prod order and timestamp order end identical, apart from the changes prod got from other branches, which the release leaves intact. |
| Grants on v3 objects | No v3 function is executable by `anon` or `PUBLIC`. Every table v3 creates has RLS and gives clients `SELECT` at most. One flag in §5. |
| Shared stack vs fresh | Columns, triggers, constraints, indexes, cron jobs and views match. The release files' functions match except one comment line. The other differences are ownership, the snapshot's broader grants on older tables, and work not yet on the integration branch (§6). |

## 1. How it was run (repeatable)

1. **A second stack.** Copy `supabase/` to a temp folder, set `project_id = "moduo-rehearsal"` and move every port to 55xxx (api 55321, db 55322, shadow 55320, pooler 55329, studio 55323, smtp 55324, analytics 55327, inspector 58083). `supabase start -x studio,edge-runtime,logflare,vector,mailpit,imgproxy,supavisor,postgres-meta,kong,postgrest` (auth, storage and realtime stay up: they create their schemas). Tear down with `supabase stop --project-id moduo-rehearsal --no-backup`. Don't reuse `stack.sh`: it is hard-wired to 54322.
2. **The base** is `~/.cache/moduo/supabase-snapshot` (prod's schema at `20261009004924`), loaded like `stack.sh` (extensions, `public.sql`, storage policies, auth triggers) with two changes:
   - `supabase_admin`'s default privileges in `public` are switched off during the restore and put back after. Otherwise the restore adds grants that prod doesn't have and `pg_dump` never revokes ([gotchas/supabase.md](../gotchas/supabase.md)).
   - The `supabase_realtime` membership prod got from pre-snapshot migrations is added (`chat_messages`, `chat_channels`, `chat_members`, the six Tasks tables, `focus_runs`); the snapshot has no publication lines.
3. **Migrations run as `postgres`**, one `psql -1 -v ON_ERROR_STOP=1 -f <file>` each. Every object on prod is owned by `postgres`, so that is the role prod's migrations run as. (`stack.sh` uses `supabase_admin`, which has `auth` on its search path and different default grants.)
4. **Two orders.** *Prod order:* what prod received after the snapshot, in prod's order (§4), then the release files by version. *Timestamp order:* every repo file newer than the snapshot, as `stack.sh` does. The develop and TX-5 files that prod has but this branch doesn't were taken from `origin/develop` and `origin/t/maciej/tx-5-booking-emails`.
5. **Tests:** `MODUO_DB_URL=postgresql://supabase_admin:postgres@127.0.0.1:55322/postgres bun run db:test`.
6. **Drift and grants:** the same read-only catalog query on each database, then diffed. It covers:
   - functions: owner, definer, config, body hash and EXECUTE per role;
   - tables and sequences: owner, RLS and grants;
   - column grants, columns, policies, triggers, constraints, indexes, the publication and cron jobs.

## 2. Fixed in this round (2026-10-14)

| What | Problem found by the first run | Fix |
| --- | --- | --- |
| `20261013100000_comment_reactions_edits` | Failed fresh: `comments__item_seen` (LANGUAGE sql) was created before `comments__item_visible_to`, which its body calls. Postgres checks SQL bodies at CREATE, and so does `supabase migration up`. The shared stack had the callee from an earlier draft of the file. Five later files failed in turn: 150000, 170000, 180000, 220000 and 269000. | `comments__item_visible_to` moved above its callers. The bodies are unchanged. |
| `20261013268000_agents_privacy_fix` | Failed as `postgres`: its re-run guard compared the `notice_deliveries_own_read` policy text with `uid()`, and the catalog spells it `auth.uid()` when `auth` isn't on the search path. | The guard accepts both spellings. |
| TV-D8's `20261010160000_tasks_ops_registry_handles` | Its version clashed with TX-5's `20261010160000_tx5_booking_bell` (branch `t/maciej/tx-5-booking-emails`). | Renamed to **`20261010160001_tasks_ops_registry_handles`**; tests, docs and notes updated. When TX-5 lands, name its file `20261010160147`, its prod version. |
| PERM-W's and TX-4's files | Already on prod under other history versions. | Renamed to their prod versions, like the `focus_runs` backfill: **`20261010141712_tighten_write_checks`** (was `20261010120000`; prod history `20261010141712`, [decisions/permissions.md](../decisions/permissions.md)) and **`20261010155652_tx4_invite_only_gate`** (was `20261010150000`; prod history `20261010155652`, [email-runbook.md](../email-runbook.md) §TX-4). Both files are unchanged since before they were applied: the last commits were at 14:18 and 15:38 UTC, and prod applied them at 14:17 and 15:56 UTC. |

The shared stack needed nothing re-applied:
- The reorder and the guard change leave every object's definition as it was.
- The renames don't matter there: the shared stack keeps no migration history table.
- The two files edited after being applied there are accounted for (§6).

## 3. SQL suite

| Database | Result |
| --- | --- |
| Fresh, prod order | 36/36 files, 1,871 checks |
| Fresh, timestamp order | 36/36 files, 1,871 checks |
| Shared stack | Not run: the runner writes inside a rolled-back transaction, and the shared stack takes no writes from a rehearsal. Its catalog matches the fresh replay on every release-file object (§6). |

A database built the way `local:reset` builds it (as `supabase_admin`, snapshot restored with the broader default grants) fails 4 grant checks in `focus_runs.test.sql`. The cause is the base, not a migration: prod and the shared stack have those four helpers service-only.

## 4. Release order for prod

**Already on prod, not to be re-applied:**
- everything up to the snapshot, including `20261008235243_focus_runs`;
- `20261010141712_tighten_write_checks`, `20261010155652_tx4_invite_only_gate` and `20261013224816_workspaces_insert_owner`.

Prod also has migrations this branch doesn't carry:
- develop's `20261009180000_index_foreign_keys` (prod history `20261009190012`);
- develop's `20261009200000_pin_function_search_path` (history `20261009193612`);
- develop's `20261009210000_api_key_expiry` (applied in the SQL editor, so not in the history);
- develop's `20261010090000_api_key_expiry_in_sql`;
- develop's `20261013120000_notes_refresh_organize`;
- TX-5's bell migration, renamed on 2026-10-14 to its prod version: `20261010160147_tx5_booking_bell`.

**The release: 32 files, in this order:**

1. `20261010160001_tasks_ops_registry_handles`
2. `20261010161000_tasks_recurrence_server`
3. `20261010170000_project_statuses`
4. `20261010171000_tasks_completion_due_on`
5. `20261010180000_areas_projects_sections`
6. `20261010181000_task_sessions_reminders_waiting`
7. `20261010182000_teams`
8. `20261011100000_projects_archive_trash`
9. `20261011110000_task_sessions_access`
10. `20261011120000_tasks_sync_feed_search`
11. `20261013100000_comment_reactions_edits`
12. `20261013110000_notifications_v3`
13. `20261013111000_recurrence_moves_dst`
14. `20261013130000_focus_runs_v3`
15. `20261013140000_reminders_repeats_fixes`
16. `20261013145000_recurrence_edit_checks`
17. `20261013150000_teams_routing`
18. `20261013160000_templates`
19. `20261013170000_teams_mention_once`
20. `20261013180000_teams_routing_fixes`
21. `20261013190000_templates_edit_to_copy`
22. `20261013200000_user_preferences_time_region`
23. `20261013201000_time_entries_add`
24. `20261013210000_teams_access_fix`
25. `20261013220000_agents_imports_mcp`
26. `20261013230000_templates_starter`
27. `20261013240000_project_description_team_defaults`
28. `20261013250000_task_views`
29. `20261013268000_agents_privacy_fix`
30. `20261013269000_notice_ids_only`
31. `20261013271000_task_views_access_fix`
32. `20261013272000_attachments_everywhere`

**Notes for the release:**

- **Prod already has `20261013224816`,** so on prod it runs before files 1–25 instead of after them. The end state is the same either way, and `workspaces_insert.test.sql` passes in both orders.
- **Changes prod got from other branches survive the release.** After it, the 12 `search_path` pins, the API-key expiry bodies, TX-5's booking bodies and NR-1's notes objects are unchanged: no release file redefines them.
- **Develop's history versions still differ from its file names** (`20261009180000`, `20261009200000`, `20261009210000`). That is develop's to align the same way. Until it is, `supabase db push` would read those files as unapplied, so apply the release file by file (as before) or repair the history first.
- **Not on the integration branch yet:** TV-SEC1's `20261013260000_access_check_caller` (branch `t/maciej/tv-sec1-access`) sorts before files 29–32, and the shared stack already has it. When it lands, re-run this rehearsal: build a throwaway stack as in §1, then both orders and `db:test`.
- **Not exercised here (schema-only base, no rows).** These steps depend on prod's data:
  - backfills in 160001 (task numbers and workspace keys);
  - rewrites of `tasks` with triggers off in 170000, 171000, 180000 and 150000;
  - `task_sessions` built from existing data in 181000;
  - the `focus_runs` rewrite in 130000, before its new mode check;
  - the payload rewrites in 140000, 268000 and 269000.

  Constraints added without `NOT VALID` are checked against existing rows: `workspaces_task_key_format`, `buckets_status_check`, `buckets_dates_check`, `tasks_estimate_minutes_check`, `tasks_imported_from_check`, `buckets_color_length`, `buckets_inbox_not_archived`, `focus_runs_mode_check`, `focus_runs_phase_shape`, `notice_deliveries_url_check`, `notice_deliveries_kind_check` and `buckets_description_length` (`tasks_recurrence_bounded` is `NOT VALID`). Index builds on `tasks`, `buckets`, `comments` and `attachments` lock writes briefly. The 🟠 box's "Verify before release" list has the matching pre-checks, and a run against a copy of prod's data would settle them.
- **The base is the 2026-10-09 snapshot plus the migrations recorded as applied since.** Anything changed on prod outside a migration doesn't show here. Just before the release, refresh the snapshot (`bun run local:snapshot`; it reads prod but rewrites the cache every worktree builds from) and re-run this.

## 5. Grants on v3 objects (fresh database, prod order)

Scope: every table and function that a release file creates, redefines (anchored replaces included) or re-grants. That is 302 function signatures and the tables below.

**Tables:** RLS is on for every one, and no client role has `TRUNCATE`.

- Clients get no grants on `areas_detached` or `storage_usage`.
- `task_templates` and `project_templates` give column-level `SELECT`.
- `app_settings` is the one table readable before sign-in, which is deliberate: the minimum-build check runs then.
- `authenticated` has `SELECT` only, because writes go through the ops, on:
  - `access_changes`, `agent_session_summaries`, `agent_sessions`, `app_settings`, `areas`, `attachments`;
  - `comment_reactions`, `focus_runs`, `import_rows`, `imports`, `notice_deliveries`, `project_statuses`;
  - `push_subscriptions`, `sections`, `sync_tombstones`, `task_completions`, `task_reminders`, `task_sessions`;
  - `task_time_entries`, `task_views`, `task_waiting`, `team_members` and `teams`.

Older tables that the release alters (`tasks`, `buckets`, `comments`, `entities`, `tag_links`, `task_relations`, `user_preferences`, `workspaces`) keep the grants they already have; reviewing those is out of this rehearsal's scope.

**Functions:**

| Group | Count | Notes |
| --- | --- | --- |
| Executable by `anon` or `PUBLIC` | 0 | |
| SECURITY DEFINER, service role only | 139 | |
| SECURITY DEFINER, executable by `authenticated` | 101 | 99 are the ops and reads the app calls. **Flag:** `tasks__editable(uuid)` and `projects__editable(uuid)` were granted "because the policies call these", but no policy, view or app code calls them in the final schema. They answer only for the caller. Revoke from `authenticated`, or correct the comment. |
| SECURITY INVOKER, executable by `authenticated` | 17 | `attachments_largest`, which the app calls, plus pure helpers that read only their arguments and one trigger function: `areas__check_color`, `push__endpoint_ok`, `sections__check_dates`, `tasks__category_rank`, `tasks__clean_name`, `tasks__date_only`, `tasks__due_noon`, `tasks__estimate_sync` (trigger), `tasks__legacy_status`, `tasks__patch_date`, `tasks__recurrence_problem`, `tasks__reorder`, `tasks__session_times`, `tasks__status_category_of`, `teams__auto_mark`, `teams__check_mark`. No flag. |
| SECURITY INVOKER, service role only | 45 | |

Every SECURITY DEFINER function among them pins `search_path`.

## 6. Shared stack vs fresh (drift)

The shared stack (read-only `SELECT`s on 54322), compared with the timestamp-order replay, which has the same migration set:

- **The same:** all 961 columns (type, not-null, default), 165 triggers, 459 constraints, 322 indexes, 6 cron jobs and 2 views, plus every release-file function apart from the one below.
- **Edited after being applied to the shared stack (two files):**
  - `20261013100000`, in `4814c6c8`. The shared stack has the final behavior (its functions and policies match), and §2's reorder changes no definition.
  - `20261013190000`, in `d4861413`. `task_templates_op_save` differs by one comment line ("can see" → "can edit") and its behavior is the same. It was not re-applied: re-running the whole file would re-cut every function in it to change a comment.
- **Ownership:** 317 functions, the 23 tables v3 creates, `email_subscriptions` and `access_changes_id_seq` are owned by `supabase_admin` on the shared stack. On the replay and on prod, `postgres` owns them, because `stack.sh` applies migrations as `supabase_admin`.
- **Grants on 28 older tables** are broader on the shared stack than on the replay. This is the snapshot-restore effect from the gotcha: a probe there can pass where prod would refuse.
- **Work applied to the shared stack that isn't on the integration branch:** TV-SEC1's `20261013260000` (the caller form of `can_access`, a new `share_assign_preview` body and four EXECUTE changes) and a later change to three policies' roles and three functions' grants. These are not release-file objects.
- **Publication:** the shared stack also lists `realtime.messages_*` partitions. Realtime creates these at runtime; they are not part of the schema.
- **On prod but not on the shared stack:** develop's and TX-5's changes. This is expected, and the prod-order replay carries them.
