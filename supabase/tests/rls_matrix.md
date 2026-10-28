# RLS access matrix (HV-16)

Who may read and write the ten most sensitive tables, cell by cell, and a probe of every SECURITY DEFINER function a signed-in person can call. This file is the source: `bun run db:matrix` turns it into `_rls_world.sql` and `rls_matrix_*.test.sql` next to it (the hand-written `_rls_matrix.sql` and `_rls_probe.sql` hold the helpers and the probe's calls), which `bun run db:test` runs like every other SQL test. Never edit the generated files; `bun run test:scripts` fails when they are out of step with this file.

`bun run db:mutants` loosens every policy on these tables, one at a time, inside the test's rolled-back transaction, and fails if a matrix file still passes (a surviving mutant: a cell is missing).

## How to read and change it

- **A cell** is what one persona gets from one operation: `✓` the statement reaches the row (a read returns it, a write changes it), `✗` it doesn't (no row, or an error), `–` not tested here (said why under the table).
- **An operation** is a `sql <name>` block under its table; `sql <name> rls-alone` runs it with `share.bypass` on, which the write triggers (`perm_enforce_write` and the pins) stand aside for, so RLS alone decides (the MOD-571 leak turned it on for a whole transaction). A write those triggers guard needs a `rls-alone` twin: they refuse most raw writes first, so without one a WITH CHECK loosened to `true` passes (13 policy mutants survived the first run). `{Name}` is the fixture id `test.id('Name')`; `auth.uid()` is the persona. Every operation also runs once as `owner` without RLS (triggers still run) and must reach its row, so a typo can't pass as a refusal.
- **A cell that is wrong today** stays written as it should be. Its check goes into `known-failures.txt` with the bug's task, and the line fails the run once the bug is fixed.
- **A new sensitive table:** add a `## Table: <name>` section, run `bun run db:matrix`, then `bun run db:test rls_matrix` and `bun run db:mutants <name>`.

## Personas

| persona | who |
| --- | --- |
| owner | Owns workspace W and made every item in it. |
| admin | Admin of W. Nothing is shared with them: private items stay private from admins too. |
| editor | Member of W with Edit on project P, note N and contact C, in the private channel, shares agent work. |
| viewer | Member of W with View on P, N and C, in the private channel. |
| capped | Viewer role in W with Edit on P, N and C: the role caps them at View. |
| member | Member of W with nothing shared. |
| outsider | Owns workspace W2, not in W. |
| anon | No session (the anon key). |
| app | owner, through an app's OAuth token (a `client_id` claim). Apps reach Moduo only through the connector (MCPO-1): the tables in the Realtime publication refuse them with a RESTRICTIVE policy; the Data API's pre-request function refuses them everywhere else, which a SQL test can't reach, so those cells are `–`. |

## World

The fixture every matrix file starts from. Private things carry `HV16-SECRET` so the RPC probe can tell a leak by its output.

```sql world
SELECT test.person(n) FROM unnest(ARRAY['owner', 'admin', 'editor', 'viewer', 'capped', 'member', 'outsider']) AS n;
-- Team plan: chat and the paid features answer instead of refusing on the plan.
UPDATE public.profiles SET plan_tier = 'team' WHERE id IN (test.id('owner'), test.id('outsider'));
INSERT INTO public.workspaces (id, owner_id, name) VALUES
  (test.id('W'), test.id('owner'), 'Victim'),
  (test.id('W2'), test.id('outsider'), 'Elsewhere');
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
  (test.id('W'), test.id('admin'), 'admin'),
  (test.id('W'), test.id('editor'), 'member'),
  (test.id('W'), test.id('viewer'), 'member'),
  (test.id('W'), test.id('capped'), 'viewer'),
  (test.id('W'), test.id('member'), 'member');

INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system) VALUES
  (test.id('P'), test.id('W'), test.id('owner'), 'Project HV16-SECRET', false),
  (test.id('PE'), test.id('W'), test.id('owner'), 'Empty project HV16-SECRET', false),
  (test.id('PO'), test.id('W'), test.id('owner'), 'Owner only HV16-SECRET', false),
  (test.id('P2'), test.id('W2'), test.id('outsider'), 'Outsider project', false);
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status) VALUES
  (test.id('T'), test.id('W'), test.id('P'), test.id('owner'), 'Task HV16-SECRET', 'todo');
INSERT INTO public.notes (id, workspace_id, created_by, title, body_md, body_text) VALUES
  (test.id('N'), test.id('W'), test.id('owner'), 'Note HV16-SECRET', 'HV16-SECRET', 'HV16-SECRET');
INSERT INTO public.contacts (id, workspace_id, owner_id, name, email) VALUES
  (test.id('C'), test.id('W'), test.id('owner'), 'Contact HV16-SECRET', 'hv16-secret@example.com');
-- Only these grants: whatever a workspace default shared goes.
DELETE FROM public.resource_grants WHERE workspace_id = test.id('W');
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
SELECT test.id('W'), r.t, test.id(r.n), 'member', test.id(s.p), s.l, test.id('owner')
FROM (VALUES ('bucket', 'P'), ('bucket', 'PE'), ('note', 'N'), ('contact', 'C')) AS r(t, n),
     (VALUES ('viewer', 'view'), ('editor', 'edit'), ('capped', 'edit')) AS s(p, l);

-- A private channel with owner, editor and viewer; a public one.
SET LOCAL session_replication_role = replica;
INSERT INTO public.chat_channels (id, workspace_id, kind, name, is_private) VALUES
  (test.id('CH'), test.id('W'), 'channel', 'secret', true),
  (test.id('CHP'), test.id('W'), 'channel', 'open', false);
INSERT INTO public.chat_members (channel_id, user_id, workspace_id)
SELECT test.id('CH'), test.id(p), test.id('W') FROM unnest(ARRAY['owner', 'editor', 'viewer']) AS p;
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body) VALUES
  (test.id('MSG'), test.id('W'), test.id('CH'), test.id('owner'), 'Private HV16-SECRET'),
  (test.id('MSGP'), test.id('W'), test.id('CHP'), test.id('owner'), 'Public message');
SET LOCAL session_replication_role = origin;

-- Agent work on T: owner's (owner doesn't share agent work) and editor's (editor does).
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by) VALUES
  (test.id('K'), test.id('W'), 'Key HV16-SECRET', 'mdo_hv16', md5('hv16-k'), '{"tasks": "edit", "notes": "edit"}'::jsonb, test.id('owner')),
  (test.id('KE'), test.id('W'), 'Editor key', 'mdo_hv16e', md5('hv16-ke'), '{"tasks": "edit"}'::jsonb, test.id('editor')),
  (test.id('KX'), test.id('W2'), 'Outsider key', 'mdo_hv16x', md5('hv16-kx'),
   '{"tasks": "edit", "notes": "edit", "contacts": "edit", "chat": "edit", "links": "edit", "calendar": "edit", "email": "edit"}'::jsonb,
   test.id('outsider'));
INSERT INTO public.agent_sessions (id, workspace_id, task_id, user_id, key_id, agent, state, note) VALUES
  (test.id('S'), test.id('W'), test.id('T'), test.id('owner'), test.id('K'), 'Claude', 'working', 'HV16-SECRET'),
  (test.id('SE'), test.id('W'), test.id('T'), test.id('editor'), test.id('KE'), 'Claude', 'working', 'Shared work');
INSERT INTO public.user_preferences (user_id, show_agent_work) VALUES (test.id('editor'), true)
ON CONFLICT (user_id) DO UPDATE SET show_agent_work = true;
INSERT INTO public.focus_runs (id, workspace_id, user_id, status, mode, device_id, now_task_id)
VALUES (test.id('FR'), test.id('W'), test.id('owner'), 'running', 'per_task', 'hv16-device', test.id('T'));

-- A page in the legacy exposed_notes table (notes publishing before publish_token).
INSERT INTO public.exposed_notes (id, note_id, workspace_id, title, slug)
VALUES (test.id('X'), test.id('N')::text, test.id('W')::text, 'Published', 'hv16-page');
```

## Table: tasks

Reads follow the task's own grants or its project's; a write needs Edit (`20261024120000_tasks_buckets_rls_edit.sql`), and the share.bypass leak (MOD-571) must not widen it. `move` files T into PO, the owner's project nobody else has.

```sql select
SELECT 1 FROM public.tasks WHERE id = {T}
```

```sql insert
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
VALUES ({T-new}, {W}, {P}, {owner}, 'New task', 'todo')
```

```sql update
UPDATE public.tasks SET title = 'Renamed' WHERE id = {T}
```

```sql delete
DELETE FROM public.tasks WHERE id = {T}
```

```sql move
UPDATE public.tasks SET bucket_id = {PO} WHERE id = {T}
```

The same writes with the triggers aside, plus a task filed in W2 under W's project (only the policy's `tasks__rls_bucket_here` stops that one):

```sql rls_insert rls-alone
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
VALUES ({T-new}, {W}, {P}, {owner}, 'New task', 'todo')
```

```sql rls_insert_elsewhere rls-alone
INSERT INTO public.tasks (id, workspace_id, bucket_id, owner_id, title, status)
VALUES ({T-new}, {W2}, {P}, {owner}, 'Planted', 'todo')
```

```sql rls_update rls-alone
UPDATE public.tasks SET title = 'Renamed' WHERE id = {T}
```

```sql rls_delete rls-alone
DELETE FROM public.tasks WHERE id = {T}
```

```sql rls_move rls-alone
UPDATE public.tasks SET bucket_id = {PO} WHERE id = {T}
```

`rls_insert_elsewhere` is refused even to the owner, so its sanity run (without RLS) is the only ✓.

| persona | select | insert | update | delete | move | rls_insert | rls_insert_elsewhere | rls_update | rls_delete | rls_move |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| admin | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| editor | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✗ | ✓ | ✓ | ✗ |
| viewer | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| capped | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| member | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| app | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

## Table: buckets

Projects. Anyone with `tasks.create` makes their own; Edit renames; only Full (the owner) deletes. `delete` takes PE, shared like P but empty (a project with tasks can't be deleted by anyone).

```sql select
SELECT 1 FROM public.buckets WHERE id = {P}
```

```sql insert
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system)
VALUES ({P-new}, {W}, auth.uid(), 'Mine', false)
```

```sql insert_for_owner
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system)
VALUES ({P-new}, {W}, {owner}, 'Planted', false)
```

```sql update
UPDATE public.buckets SET name = 'Renamed' WHERE id = {P}
```

```sql take_over
UPDATE public.buckets SET owner_id = auth.uid() WHERE id = {P}
```

```sql delete
DELETE FROM public.buckets WHERE id = {PE}
```

The same writes with the triggers aside:

```sql rls_insert_for_owner rls-alone
INSERT INTO public.buckets (id, workspace_id, owner_id, name, is_system)
VALUES ({P-new}, {W}, {owner}, 'Planted', false)
```

```sql rls_update rls-alone
UPDATE public.buckets SET name = 'Renamed' WHERE id = {P}
```

```sql rls_take_over rls-alone
UPDATE public.buckets SET owner_id = auth.uid() WHERE id = {P}
```

```sql rls_delete rls-alone
DELETE FROM public.buckets WHERE id = {PE}
```

| persona | select | insert | insert_for_owner | update | take_over | delete | rls_insert_for_owner | rls_update | rls_take_over | rls_delete |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| editor | ✓ | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| viewer | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| capped | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| member | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| app | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

## Table: notes

Reads by `can_access('note', …)`. Every write goes through the `notes_op_*` functions: no direct write for anyone.

```sql select
SELECT 1 FROM public.notes WHERE id = {N}
```

```sql insert
INSERT INTO public.notes (id, workspace_id, created_by, title) VALUES ({N-new}, {W}, auth.uid(), 'Mine')
```

```sql update
UPDATE public.notes SET title = 'Renamed' WHERE id = {N}
```

```sql publish
UPDATE public.notes SET published_at = now(), publish_token = 'hv16-token' WHERE id = {N}
```

```sql delete
DELETE FROM public.notes WHERE id = {N}
```

| persona | select | insert | update | publish | delete |
| --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✗ | ✗ | ✗ | ✗ |
| admin | ✗ | ✗ | ✗ | ✗ | ✗ |
| editor | ✓ | ✗ | ✗ | ✗ | ✗ |
| viewer | ✓ | ✗ | ✗ | ✗ | ✗ |
| capped | ✓ | ✗ | ✗ | ✗ | ✗ |
| member | ✗ | ✗ | ✗ | ✗ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ | ✗ |
| app | – | – | – | – | – |

## Table: contacts

Reads by `can_access('contact', …)`; writes only through `contacts_op_*`.

```sql select
SELECT 1 FROM public.contacts WHERE id = {C}
```

```sql insert
INSERT INTO public.contacts (id, workspace_id, owner_id, name) VALUES ({C-new}, {W}, auth.uid(), 'Mine')
```

```sql update
UPDATE public.contacts SET name = 'Renamed' WHERE id = {C}
```

```sql delete
DELETE FROM public.contacts WHERE id = {C}
```

| persona | select | insert | update | delete |
| --- | --- | --- | --- | --- |
| owner | ✓ | ✗ | ✗ | ✗ |
| admin | ✗ | ✗ | ✗ | ✗ |
| editor | ✓ | ✗ | ✗ | ✗ |
| viewer | ✓ | ✗ | ✗ | ✗ |
| capped | ✓ | ✗ | ✗ | ✗ |
| member | ✗ | ✗ | ✗ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ |
| app | – | – | – | – |

## Table: chat_messages

A private channel's messages are for its members; a public channel's for everyone in the workspace with `chat.view`. Writes go through `chat_op_*`.

```sql select_private
SELECT 1 FROM public.chat_messages WHERE id = {MSG}
```

```sql select_public
SELECT 1 FROM public.chat_messages WHERE id = {MSGP}
```

```sql insert
INSERT INTO public.chat_messages (id, workspace_id, channel_id, author_id, body)
VALUES ({MSG-new}, {W}, {CH}, auth.uid(), 'Planted')
```

```sql update
UPDATE public.chat_messages SET body = 'Rewritten' WHERE id = {MSG}
```

```sql delete
DELETE FROM public.chat_messages WHERE id = {MSG}
```

| persona | select_private | select_public | insert | update | delete |
| --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✓ | ✗ | ✗ | ✗ |
| admin | ✗ | ✓ | ✗ | ✗ | ✗ |
| editor | ✓ | ✓ | ✗ | ✗ | ✗ |
| viewer | ✓ | ✓ | ✗ | ✗ | ✗ |
| capped | ✗ | ✓ | ✗ | ✗ | ✗ |
| member | ✗ | ✓ | ✗ | ✗ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ | ✗ |
| app | ✗ | ✗ | ✗ | ✗ | ✗ |

## Table: agent_sessions

An agent's work on a task: yours, plus a teammate's on a task you both see when they share agent work (`show_agent_work`). Written only by the connector.

```sql select_own
SELECT 1 FROM public.agent_sessions WHERE id = {S}
```

```sql select_shared
SELECT 1 FROM public.agent_sessions WHERE id = {SE}
```

```sql insert
INSERT INTO public.agent_sessions (id, workspace_id, task_id, user_id, agent, state)
VALUES ({S-new}, {W}, {T}, auth.uid(), 'Claude', 'working')
```

```sql update
UPDATE public.agent_sessions SET note = 'Rewritten' WHERE id = {S}
```

```sql delete
DELETE FROM public.agent_sessions WHERE id = {S}
```

| persona | select_own | select_shared | insert | update | delete |
| --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✓ | ✗ | ✗ | ✗ |
| admin | ✗ | ✗ | ✗ | ✗ | ✗ |
| editor | ✗ | ✓ | ✗ | ✗ | ✗ |
| viewer | ✗ | ✓ | ✗ | ✗ | ✗ |
| capped | ✗ | ✓ | ✗ | ✗ | ✗ |
| member | ✗ | ✗ | ✗ | ✗ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ | ✗ |
| app | ✗ | ✗ | ✗ | ✗ | ✗ |

## Table: focus_runs

A Focus run is its person's alone (AGENTS.md rule 10). Written through `focus_op_*`.

```sql select
SELECT 1 FROM public.focus_runs WHERE id = {FR}
```

```sql insert
INSERT INTO public.focus_runs (id, workspace_id, user_id, status, mode, device_id, ended_at)
VALUES ({FR-new}, {W}, auth.uid(), 'ended', 'per_task', 'planted-device', now())
```

```sql update
UPDATE public.focus_runs SET status = 'ended', ended_at = now() WHERE id = {FR}
```

```sql delete
DELETE FROM public.focus_runs WHERE id = {FR}
```

| persona | select | insert | update | delete |
| --- | --- | --- | --- | --- |
| owner | ✓ | ✗ | ✗ | ✗ |
| admin | ✗ | ✗ | ✗ | ✗ |
| editor | ✗ | ✗ | ✗ | ✗ |
| viewer | ✗ | ✗ | ✗ | ✗ |
| capped | ✗ | ✗ | ✗ | ✗ |
| member | ✗ | ✗ | ✗ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ |
| app | ✗ | ✗ | ✗ | ✗ |

## Table: workspace_members

Everyone in W sees the roster. Nobody joins, changes a role or removes someone else by writing the table (invites and `workspace_op_*` do that); you may leave, and the owner may remove a member directly. The owner deleting their own row (`leave`) goes through too; it costs them nothing, since their access comes from `workspaces.owner_id`, not the roster.

```sql select
SELECT 1 FROM public.workspace_members WHERE workspace_id = {W} AND user_id = {member}
```

```sql join
INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ({W}, {outsider}, 'admin')
```

```sql promote_self
UPDATE public.workspace_members SET role = 'admin' WHERE workspace_id = {W} AND user_id = auth.uid()
```

```sql leave
DELETE FROM public.workspace_members WHERE workspace_id = {W} AND user_id = auth.uid()
```

```sql remove_member
DELETE FROM public.workspace_members WHERE workspace_id = {W} AND user_id = {viewer}
```

| persona | select | join | promote_self | leave | remove_member |
| --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✗ | ✗ | ✓ | ✓ |
| admin | ✓ | ✗ | ✗ | ✓ | ✗ |
| editor | ✓ | ✗ | ✗ | ✓ | ✗ |
| viewer | ✓ | ✗ | ✗ | ✓ | ✓ |
| capped | ✓ | ✗ | ✗ | ✓ | ✗ |
| member | ✓ | ✗ | ✗ | ✓ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ | ✗ |
| app | – | – | – | – | – |

## Table: workspace_api_keys

Agent keys. People with `ws.api_keys` (owner, admin) list them; nobody reads `key_hash`; every write goes through `workspace_api_keys_*`.

```sql select
SELECT 1 FROM public.workspace_api_keys WHERE id = {K}
```

```sql select_hash
SELECT key_hash FROM public.workspace_api_keys WHERE id = {K}
```

```sql insert
INSERT INTO public.workspace_api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, created_by)
VALUES ({K-new}, {W}, 'Planted', 'mdo_x', md5('planted'), '{"tasks": "edit"}'::jsonb, auth.uid())
```

```sql update
UPDATE public.workspace_api_keys SET scopes = '{"tasks": "edit", "notes": "edit", "contacts": "edit"}'::jsonb WHERE id = {K}
```

```sql delete
DELETE FROM public.workspace_api_keys WHERE id = {K}
```

| persona | select | select_hash | insert | update | delete |
| --- | --- | --- | --- | --- | --- |
| owner | ✓ | ✗ | ✗ | ✗ | ✗ |
| admin | ✓ | ✗ | ✗ | ✗ | ✗ |
| editor | ✗ | ✗ | ✗ | ✗ | ✗ |
| viewer | ✗ | ✗ | ✗ | ✗ | ✗ |
| capped | ✗ | ✗ | ✗ | ✗ | ✗ |
| member | ✗ | ✗ | ✗ | ✗ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ | ✗ |
| app | – | – | – | – | – |

## Table: resource_grants

Who has access to what. Everyone in W with the Tasks module reads the grants (the share dialogs list them; ids only, no titles). Every write goes through `share_op_*`.

```sql select
SELECT 1 FROM public.resource_grants WHERE resource_id = {N} AND subject_id = {viewer}
```

```sql grant_self
INSERT INTO public.resource_grants (workspace_id, resource_type, resource_id, subject_type, subject_id, level, created_by)
VALUES ({W}, 'note', {N}, 'member', auth.uid(), 'edit', auth.uid())
```

```sql raise
UPDATE public.resource_grants SET level = 'full' WHERE resource_id = {N} AND subject_id = {viewer}
```

```sql revoke
DELETE FROM public.resource_grants WHERE resource_id = {N} AND subject_id = {viewer}
```

| persona | select | grant_self | raise | revoke |
| --- | --- | --- | --- | --- |
| owner | ✓ | ✗ | ✗ | ✗ |
| admin | ✓ | ✗ | ✗ | ✗ |
| editor | ✓ | ✗ | ✗ | ✗ |
| viewer | ✓ | ✗ | ✗ | ✗ |
| capped | ✓ | ✗ | ✗ | ✗ |
| member | ✓ | ✗ | ✗ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ |
| app | – | – | – | – |

## Table: exposed_notes

Legacy: nothing reads or writes it since notes publishing moved to `publish_token`. Nobody writes it, signed in or not (MOD-594), and since NS-1 nobody reads it either: no client holds a grant on it and its public read is gone. It goes in NS-9. It has no owner column, so the rows for people inside W are `–`: the question is anyone at all.

```sql select
SELECT 1 FROM public.exposed_notes WHERE id = {X}
```

```sql insert
INSERT INTO public.exposed_notes (id, note_id, title, slug) VALUES ({X-new}, 'planted', 'Planted', 'hv16-planted')
```

```sql update
UPDATE public.exposed_notes SET title = 'Defaced' WHERE id = {X}
```

```sql delete
DELETE FROM public.exposed_notes WHERE id = {X}
```

| persona | select | insert | update | delete |
| --- | --- | --- | --- | --- |
| owner | – | – | – | – |
| admin | – | – | – | – |
| editor | – | – | – | – |
| viewer | – | – | – | – |
| capped | – | – | – | – |
| member | ✗ | ✗ | ✗ | ✗ |
| outsider | ✗ | ✗ | ✗ | ✗ |
| anon | ✗ | ✗ | ✗ | ✗ |
| app | – | – | – | – |

## Equivalent mutants

Mutants `bun run db:mutants` lets live because they can't change any outcome, each with the reason. A mutant listed here that a check catches fails the run, so the list can't go stale.

| mutant | why |
| --- | --- |
| `tasks: tasks_update USING true` | WITH CHECK asks the same `can_access('task', id, 'edit')`, and `can_access` reads the task as the statement found it (the old row), so it refuses exactly whom USING would. |
| `tasks: tasks_update WITH CHECK without term 1 of 2` | The dropped term is that same `can_access('task', id, 'edit')`, which USING still asks of the same old row. |
| `buckets: buckets_update USING true` | WITH CHECK asks the same `can_access('bucket', id, 'edit')` of the old row. |
| `buckets: buckets_update WITH CHECK without term 1 of 2` | The dropped term is that same `can_access('bucket', id, 'edit')`, which USING still asks. |
| `workspace_members: drop restrictive paid_plan_required_to_add_member` | It narrows an INSERT no permissive policy allows: nobody inserts a member row directly (`join` is ✗ for all), and `workspace_op_accept_invite` writes as the table owner, past RLS. |

## RPC probe

`rls_matrix_rpcs.test.sql` calls every SECURITY DEFINER function in `public` that `authenticated` may execute, as `outsider`, `member` and `viewer`, with the world's private ids filled in by parameter name (and once per entity kind when it takes a type), and the `service_role`-only functions that act for an API key with the outsider's key. A call fails its check when its output carries `HV16-SECRET`, or when it changed the private rows (the fingerprint of T, P, N, C, the private channel and its messages, the agent session, the Focus run, the keys, W's roster, roles and grants). It also checks that every such function pins `search_path` and that `anon` executes none of them.

It is a net, not a proof: a call that fails on its arguments proves nothing, so the matrix above and each module's own tests stay the depth. The owner runs every call too, as the control; the functions whose filled-in arguments fail even for the owner are listed under **Not reached by the probe**, and the probe fails when that list is off either way. Calls allowed to show or change what they do:

| function | as | why |
| --- | --- | --- |
| `chat_op_leave` | viewer | viewer is in the private channel; leaving changes their own membership. |
| `chat_op_remove_member` | viewer | The probe names viewer as the person to remove, so this is viewer leaving. |
| `chat_op_mark_unread` | viewer | Their own read marker in a channel they're in. |
| `chat_op_pin` | viewer | Anyone in a conversation pins its messages (chat decisions). |
| `chat_op_mark_decision` | viewer | Anyone in a conversation marks a decision. |
| `comments_op_add` | viewer | View is enough to comment on an item. |
| `links_op_create` | viewer:chat_channel | viewer is in the private channel: anyone in a conversation may link it to an item they can see (MOD-593's rule). |
| `links_op_create` | viewer:chat_message | The same, from a message in that channel. |

## Not reached by the probe

What the probe calls but can't get past argument checks, even as the owner (ids of rows the world lacks: areas, sections, events, email threads, imports; closed vocabularies it fills with a placeholder; JSON patches with other fields). These have only nominal probe coverage. Shrink the list by giving the world the row, or `test.mx_arg` the value, then drop the name here.

```text unreached
areas_op_move
areas_op_update
attachments_op_abandon
attachments_op_begin
attachments_op_delete
attachments_op_finalize
attachments_op_restore
booking_hosts_set
calendar_op_account_remove
calendar_op_account_restore
calendar_op_account_set
calendar_op_account_upsert
calendar_op_event_create
calendar_op_event_delete
calendar_op_event_occurrence_delete
calendar_op_event_occurrence_restore
calendar_op_event_occurrence_update
calendar_op_event_restore
calendar_op_event_update
calendar_op_mirror_events
chat_op_attach_to_chain
chat_op_create_channel
chat_op_custom_emoji_add
chat_op_custom_emoji_remove
chat_op_move_messages
chat_op_open_dm
chat_op_react
chat_op_remind
chat_op_restore_channel
chat_op_set_prefs
chat_op_typing
chat_op_wrap_up
comments_op_add_anchored
comments_op_react
comments_op_resolve
companies_op_delete
companies_op_set_details
companies_op_update
contact_group_add
contacts_op_add_field_def
contacts_op_create
contacts_op_restore
contacts_op_update
email_op_account_upsert
email_op_clear_follow_up
email_op_follow_up
email_op_follow_up_due
email_op_link
email_op_ref_remove
email_op_ref_upsert
email_op_snooze
email_op_snooze_due
email_op_unsnooze
focus_op_run_end
focus_op_run_save
focus_op_run_start
imports_op_finish
imports_op_project_create
imports_op_section_create
imports_op_undo
links_op_set_kind
notes_op_create
notes_op_import
notes_op_move
notes_op_purge
notes_op_restore
project_statuses_op_create
project_statuses_op_delete
project_statuses_op_update
project_templates_op_apply
project_templates_op_starter
projects_op_move
push_op_subscribe
sections_op_move
sections_op_update
share_defaults_set
task_templates_op_apply
task_views_op_move
task_views_op_update
tasks_op_agent_report
tasks_op_agent_session_post
tasks_op_claim
tasks_op_create_with
tasks_op_move_occurrence
tasks_op_queue_add
tasks_op_queue_move_to_end
tasks_op_queue_reorder
tasks_op_reminder_add
tasks_op_reminder_remove
tasks_op_session_add
tasks_op_session_remove
tasks_op_session_update
tasks_op_set_status
tasks_op_skip_occurrence
tasks_op_track_time
tasks_op_trash_purge
tasks_op_update_with
tasks_op_waiting_add
tasks_op_waiting_remove
teams_op_add_member
teams_op_remove_member
teams_op_update
templates_op_update
user_op_client_seen
user_op_save_status
user_op_set_chat_prefs
user_op_set_status
user_op_set_time_region
user_op_set_time_zone
workspace_api_keys_connect_oauth
workspace_api_keys_create
workspace_api_keys_oauth_request
workspace_api_keys_set_scopes
workspace_op_accept_invite
workspace_op_role_delete
workspace_op_role_upsert
workspace_op_set_member_access
workspace_op_set_task_key
```
