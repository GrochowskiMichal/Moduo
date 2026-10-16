-- Chat v2 · CV-2a message ops (specs/chat-v2.md §Assumptions #3, #4, #12, #15, #25;
-- .design/chat-v2/research/round-3-database.md §2.3, §2.25 c and l). The stamp is
-- provisional: re-cut on the day it applies, after …_chat_v2_convert_v1 and
-- 20261014155205_chat_send_limits (this file redefines chat_op_typing and
-- chat_send_limit from the bodies that one left).
--
-- What it does:
--   1. New rows are v2: format_version defaults to 2 (the conversion refuses from
--      here on). A message records who deleted it (deleted_by): the Undo is theirs.
--   2. The ops' guards answer with codes the client can tell from a lost
--      connection: 42501 (not allowed), P0002 (gone), 22023 (bad input).
--   3. The stored form is read on the server: chat__mentions (people, teams,
--      @channel, never inside code), chat__excerpt (the bell's excerpt).
--   4. chat_op_send(id, channel, body, reply_to_id): the client-minted id is the
--      idempotency key; replies join their root's chain; the sender's read mark
--      moves to the message. chat_op_edit(message, body). chat_op_delete hides at
--      once, chat_op_restore undoes it within the window, and the minute job
--      chat-blank-deleted blanks what's left. chat_op_react(message, key, on),
--      chat_op_pin(message, pinned). An archived conversation is read-only (a
--      message can still be deleted); someone a manager removed doesn't post
--      their way back in. Each of edit, delete, restore, react and pin
--      logs one attributed activity row with ids only; a plain send and typing
--      log none. Typing keeps its per-person pace and is its members'.
--   5. The sending limits (chat_send_limit) count messages, not the event lines
--      ops write, and a message posted through an API key counts against that
--      key's own budget.
--   6. The v1 signatures of send, edit and react stay one release as wrappers
--      (old desktop builds keep working; CV-23 drops them). The app's post
--      converts its v1 markup and writes v2 rows.
--
-- Every redefined function starts from its live body (2026-10-14). Grants are
-- re-stated and asserted at the end.

SET LOCAL lock_timeout = '5s';

-- ── 1. New rows are v2 ───────────────────────────────────────────────────────

ALTER TABLE public.chat_messages ALTER COLUMN format_version SET DEFAULT 2;

-- Who deleted a message: its Undo belongs to them (or to someone who may delete
-- others' messages), never to an author whose message was taken down.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS chat_messages_deleted_by_idx
  ON public.chat_messages (deleted_by) WHERE deleted_by IS NOT NULL;

-- At most 100 live pins per conversation, counted on every pin.
CREATE INDEX IF NOT EXISTS chat_messages_pinned_idx
  ON public.chat_messages (channel_id) WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;
-- What the blank job still has to blank (the predicate matches its query).
CREATE INDEX IF NOT EXISTS chat_messages_blank_due_idx
  ON public.chat_messages (deleted_at)
  WHERE deleted_at IS NOT NULL
    AND (body <> '' OR reactions <> '{}'::jsonb OR pinned_at IS NOT NULL
         OR mentioned_user_ids <> '{}'::uuid[] OR mentioned_team_ids <> '{}'::uuid[]
         OR mentions_everyone);

-- ── 2. Capabilities ─────────────────────────────────────────────────────────

-- The owner has every capability; a member reads their role's row (a custom
-- role reads as member, a read-only one as viewer); anyone else has none.
CREATE OR REPLACE FUNCTION public.chat_has_cap(p_workspace_id uuid, p_user uuid, p_cap text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_read_only boolean;
  v_row public.workspace_chat_caps;
BEGIN
  IF p_user IS NULL THEN RETURN false; END IF;
  IF public.perm_is_owner(p_workspace_id, p_user) THEN RETURN true; END IF;
  SELECT r.system_key, r.read_only INTO v_key, v_read_only
  FROM public.workspace_members m
  LEFT JOIN public.workspace_roles r ON r.id = m.role_id
  WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_read_only OR v_key = 'viewer' THEN v_key := 'viewer';
  ELSIF v_key IS NULL OR v_key NOT IN ('admin','member','viewer') THEN v_key := 'member';
  END IF;
  SELECT * INTO v_row FROM public.workspace_chat_caps
  WHERE workspace_id = p_workspace_id AND role_key = v_key;
  IF v_row.workspace_id IS NULL THEN RETURN false; END IF;
  RETURN CASE p_cap
    WHEN 'create_public' THEN v_row.create_public
    WHEN 'create_private' THEN v_row.create_private
    WHEN 'manage_any' THEN v_row.manage_any
    WHEN 'delete_others' THEN v_row.delete_others
    WHEN 'mention_everyone' THEN v_row.mention_everyone
    WHEN 'post' THEN v_row.post
    WHEN 'start_calls' THEN v_row.start_calls
    ELSE false END;
END;
$function$;

-- ── 3. Guards with codes ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.chat_op__guard(p_workspace_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not public.chat_is_workspace_member(p_workspace_id, auth.uid()) then
    raise exception 'You don''t have access to this workspace.' using errcode = '42501';
  end if;
  if not public.chat_workspace_enabled(p_workspace_id) then
    raise exception 'Chat is available on the Duo and Team plans.' using errcode = '42501';
  end if;
end;
$function$;

-- A conversation the caller may write in: the workspace's chat is on (the plan)
-- and they can read the conversation.
CREATE OR REPLACE FUNCTION public.chat_op__channel(p_channel_id uuid)
 RETURNS chat_channels
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_channel public.chat_channels;
begin
  select * into v_channel from public.chat_channels where id = p_channel_id;
  if v_channel.id is null or v_channel.deleted_at is not null then
    raise exception 'That conversation no longer exists.' using errcode = 'P0002';
  end if;
  perform public.chat_op__guard(v_channel.workspace_id);
  if not public.chat_can_read_channel(p_channel_id) then
    raise exception 'You''re not a member of this conversation.' using errcode = '42501';
  end if;
  return v_channel;
end;
$function$;

-- The same without the plan, for the ops a paused workspace keeps (§Assumptions
-- #25: reactions here; read marks, Catch up, preferences and leave in CV-2b and
-- later).
CREATE OR REPLACE FUNCTION public.chat_op__reader(p_channel_id uuid)
 RETURNS chat_channels
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_channel public.chat_channels;
begin
  select * into v_channel from public.chat_channels where id = p_channel_id;
  if v_channel.id is null or v_channel.deleted_at is not null then
    raise exception 'That conversation no longer exists.' using errcode = 'P0002';
  end if;
  if auth.uid() is null or not public.chat_is_workspace_member(v_channel.workspace_id, auth.uid()) then
    raise exception 'You don''t have access to this workspace.' using errcode = '42501';
  end if;
  if not public.chat_can_read_channel(p_channel_id) then
    raise exception 'You''re not a member of this conversation.' using errcode = '42501';
  end if;
  return v_channel;
end;
$function$;

-- ── 4. Reading the stored form on the server ─────────────────────────────────

-- Whether a text starts with a reference (`moduo://<type>/<uuid>` or a real day).
CREATE OR REPLACE FUNCTION public.chat__mentions_ref_at(p_text text)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT m IS NOT NULL AND (m[1] IS NULL OR public.chat__is_iso_day(m[1]))
    FROM regexp_match(p_text,
      '^moduo://(?:date/([0-9]{4}-[0-9]{2}-[0-9]{2})|([a-z][a-z_-]{0,31})/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))') m
$fn$;

-- Who one run of inline content mentions (a paragraph, a quote's lines or a
-- list item; markup-v2 parse.ts parseInline + text.ts mentionsOf): people
-- (`moduo://person/<id>`) and teams (`moduo://team/<id>`), each once in order,
-- and whether `@channel` stands at a token start (a line's start or after
-- whitespace) as a whole word. Nothing inside an inline code span counts; an
-- escaped `moduo\://` is text; `[title](moduo://person/<id>)` counts (the title
-- is dropped); a reference inside an http(s) or mailto link's target doesn't.
-- Emphasis markers are transparent for "token start" (`**@channel**` counts,
-- `a**@channel**` doesn't; an opener with nothing to close it on its line is
-- text). Code spans and link targets are read as chat__inline_text reads them,
-- with its look-ahead budget: linear in the content.
CREATE OR REPLACE FUNCTION public.chat__mentions_inline(
  p_src text, OUT people uuid[], OUT teams uuid[], OUT everyone boolean)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  c text[];
  cn integer;
  i integer;
  j integer;
  r integer;
  m text[];
  v_run integer;
  v_close integer;
  v_budget integer;
  v_ws boolean;          -- what was read last ends in whitespace (or a line starts)
  v_lbs integer[];       -- positions of a '[' that may still open a link
  v_ref_at integer;      -- position after the last reference, link or line break
  v_lb integer;
  v_href text;
  v_depth integer;
  v_ok boolean;
  v_code text;
  v_after text;
  v_before text;
  v_id uuid;
  v_last_star integer;
  v_last_tilde integer;
  v_uri constant text :=
    '^moduo://(?:date/([0-9]{4}-[0-9]{2}-[0-9]{2})|([a-z][a-z_-]{0,31})/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}))';
BEGIN
  people := '{}';
  teams := '{}';
  everyone := false;
  IF p_src IS NULL OR p_src = '' THEN
    RETURN;
  END IF;
  v_budget := 2 * char_length(p_src) + 1000;
  c := regexp_split_to_array(p_src, '');
  cn := cardinality(c);
  i := 1;
  v_ws := true;
  v_lbs := '{}';
  v_ref_at := 0;
  WHILE i <= cn LOOP
    -- At a line's start: where its last run that could close emphasis starts,
    -- per character (an opener with no such run to its right on its line is
    -- text: `a **@channel`; a line break ends every mark).
    IF i = 1 OR c[i - 1] = E'\n' THEN
      v_last_star := 0;
      v_last_tilde := 0;
      j := i + 1;
      WHILE j <= cn AND c[j] <> E'\n' LOOP
        IF (c[j] = '*' OR c[j] = '~') AND c[j - 1] <> c[j] AND c[j - 1] !~ '[[:space:]]' THEN
          IF c[j] = '*' THEN
            v_last_star := j;
          ELSIF j < cn AND c[j + 1] = '~' AND (j + 2 > cn OR c[j + 2] <> '~') THEN
            v_last_tilde := j;
          END IF;
        END IF;
        j := j + 1;
      END LOOP;
    END IF;
    -- Plain text up to the next character that can mean something.
    IF c[i] !~ '[\\`m\[\]*~@[:space:]]' THEN
      j := i + 1;
      WHILE j <= cn AND c[j] !~ '[\\`m\[\]*~@[:space:]]' LOOP
        j := j + 1;
      END LOOP;
      v_ws := false;
      i := j;
      CONTINUE;
    END IF;
    IF c[i] ~ '[[:space:]]' THEN
      IF c[i] = E'\n' THEN
        v_ref_at := i + 1;   -- a '[' before a line break opens no link after it
      END IF;
      v_ws := true;
      i := i + 1;
      CONTINUE;
    END IF;
    IF c[i] = '\' THEN
      -- An escaped character is text (so `moduo\://` is no reference); an
      -- escaped `@` is the text "@", which may still start `@channel`.
      IF i < cn AND c[i + 1] = '@' THEN
        i := i + 1;
        CONTINUE;
      END IF;
      i := i + CASE WHEN i < cn AND c[i + 1] ~ '^[!-/:-@\[-`{-~]$' THEN 2 ELSE 1 END;
      v_ws := false;
      CONTINUE;
    END IF;
    IF c[i] = '`' THEN
      v_run := 1;
      WHILE i + v_run <= cn AND c[i + v_run] = '`' LOOP
        v_run := v_run + 1;
      END LOOP;
      j := i + v_run;
      v_close := -1;
      WHILE j <= cn AND c[j] <> E'\n' AND v_budget > 0 LOOP
        v_budget := v_budget - 1;
        IF c[j] = '`' THEN
          r := 1;
          WHILE j + r <= cn AND c[j + r] = '`' LOOP
            r := r + 1;
          END LOOP;
          IF r = v_run THEN
            v_close := j;
            EXIT;
          END IF;
          j := j + r;
        ELSE
          j := j + 1;
        END IF;
      END LOOP;
      IF v_close < 0 THEN
        v_ws := false;
        i := i + v_run;
        CONTINUE;
      END IF;
      v_code := array_to_string(c[i + v_run:v_close - 1], '');
      IF length(v_code) >= 2 AND left(v_code, 1) = ' ' AND right(v_code, 1) = ' ' AND v_code !~ '^ +$' THEN
        v_code := substr(v_code, 2, length(v_code) - 2);
      END IF;
      v_ws := v_code ~ '[[:space:]]$';
      i := v_close + v_run;
      CONTINUE;
    END IF;
    IF c[i] = 'm' THEN
      IF c[i + 1] = 'o' AND array_to_string(c[i:i + 7], '') = 'moduo://' THEN
        m := regexp_match(array_to_string(c[i:i + 80], ''), v_uri);
        IF m IS NOT NULL AND (m[1] IS NULL OR public.chat__is_iso_day(m[1])) THEN
          IF m[2] IN ('person', 'team') THEN
            v_id := m[3]::uuid;
            IF m[2] = 'person' AND NOT v_id = ANY (people) THEN
              people := people || v_id;
            ELSIF m[2] = 'team' AND NOT v_id = ANY (teams) THEN
              teams := teams || v_id;
            END IF;
          END IF;
          i := i + length(CASE WHEN m[1] IS NOT NULL THEN 'moduo://date/' || m[1]
                               ELSE 'moduo://' || m[2] || '/' || m[3] END);
          v_ref_at := i;
          v_ws := false;
          CONTINUE;
        END IF;
      END IF;
      v_ws := false;
      i := i + 1;
      CONTINUE;
    END IF;
    IF c[i] = '[' THEN
      v_lbs := v_lbs || i;
      v_ws := false;
      i := i + 1;
      CONTINUE;
    END IF;
    IF c[i] = ']' THEN
      v_lb := CASE WHEN cardinality(v_lbs) > 0 THEN v_lbs[cardinality(v_lbs)] END;
      v_ok := false;
      IF v_lb IS NOT NULL AND i < cn AND c[i + 1] = '(' AND v_ref_at <= v_lb AND i > v_lb + 1 THEN
        -- The destination, as chat__inline_text reads it.
        j := i + 2;
        v_href := '';
        IF j <= cn AND c[j] = '<' THEN
          j := j + 1;
          WHILE j <= cn AND c[j] <> '>' AND v_budget > 0 LOOP
            v_budget := v_budget - 1;
            EXIT WHEN c[j] = E'\n' OR c[j] = '<';
            IF c[j] = '\' AND j < cn AND c[j + 1] ~ '^[!-/:-@\[-`{-~]$' THEN
              v_href := v_href || c[j + 1];
              j := j + 2;
            ELSE
              v_href := v_href || c[j];
              j := j + 1;
            END IF;
          END LOOP;
          IF j <= cn AND c[j] = '>' THEN
            j := j + 1;
            v_ok := j <= cn AND c[j] = ')';
          END IF;
        ELSE
          v_depth := 0;
          WHILE j <= cn AND v_budget > 0 LOOP
            v_budget := v_budget - 1;
            EXIT WHEN c[j] ~ '[[:space:]]' OR ascii(c[j]) < 32;
            IF c[j] = '\' AND j < cn AND c[j + 1] ~ '^[!-/:-@\[-`{-~]$' THEN
              v_href := v_href || c[j + 1];
              j := j + 2;
              CONTINUE;
            END IF;
            IF c[j] = '(' THEN
              v_depth := v_depth + 1;
            ELSIF c[j] = ')' THEN
              EXIT WHEN v_depth = 0;
              v_depth := v_depth - 1;
            END IF;
            v_href := v_href || c[j];
            j := j + 1;
          END LOOP;
          v_ok := v_depth = 0 AND j <= cn AND c[j] = ')';
        END IF;
        IF v_ok THEN
          m := regexp_match(v_href, v_uri || '$');
          IF m IS NOT NULL AND (m[2] IS NOT NULL OR public.chat__is_iso_day(m[1])) THEN
            -- `[title](moduo://…)` reads as the bare reference.
            IF m[2] IN ('person', 'team') THEN
              v_id := m[3]::uuid;
              IF m[2] = 'person' AND NOT v_id = ANY (people) THEN
                people := people || v_id;
              ELSIF m[2] = 'team' AND NOT v_id = ANY (teams) THEN
                teams := teams || v_id;
              END IF;
            END IF;
          ELSIF m IS NULL AND v_href ~* '^(https?://[^[:space:]]+|mailto:[^[:space:]]+)$'
                AND v_href !~ '[\x01-\x1f\x7f]' THEN
            NULL;   -- a link: its target is never read
          ELSE
            v_ok := false;
          END IF;
        END IF;
        IF v_ok THEN
          v_lbs := '{}';
          v_ref_at := j + 1;
          v_ws := false;
          i := j + 1;
          CONTINUE;
        END IF;
      END IF;
      IF v_lb IS NOT NULL THEN
        v_lbs := v_lbs[1:cardinality(v_lbs) - 1];
      END IF;
      v_ws := false;
      i := i + 1;
      CONTINUE;
    END IF;
    IF c[i] = '*' OR c[i] = '~' THEN
      v_run := 1;
      WHILE i + v_run <= cn AND c[i + v_run] = c[i] LOOP
        v_run := v_run + 1;
      END LOOP;
      v_before := CASE WHEN i > 1 THEN c[i - 1] END;
      v_after := CASE WHEN i + v_run <= cn THEN c[i + v_run] END;
      IF (c[i] = '~' AND v_run <> 2)
         OR ((v_after IS NULL OR v_after ~ '[[:space:]]') AND (v_before IS NULL OR v_before ~ '[[:space:]]'))
         -- an opener only, with nothing to close it on its right
         OR ((v_before IS NULL OR v_before ~ '[[:space:]]')
             AND CASE c[i] WHEN '*' THEN v_last_star ELSE v_last_tilde END <= i) THEN
        v_ws := false;   -- text
      END IF;            -- an emphasis marker: transparent
      i := i + v_run;
      CONTINUE;
    END IF;
    -- '@'
    -- A whole word: what follows isn't a word character of the same text
    -- (a reference right after it ends the text).
    IF v_ws AND array_to_string(c[i:i + 7], '') = '@channel'
       AND (i + 8 > cn OR c[i + 8] !~ '[A-Za-z0-9_-]'
            OR (array_to_string(c[i + 8:i + 15], '') = 'moduo://'
                AND public.chat__mentions_ref_at(array_to_string(c[i + 8:i + 88], '')))) THEN
      everyone := true;
      i := i + 8;
    ELSE
      i := i + 1;
    END IF;
    v_ws := false;
  END LOOP;
END
$fn$;

-- Who a v2 body mentions: its blocks as chat__body_text reads them (nothing in
-- a fenced block counts; a quote's and a list item's markers go), each run of
-- inline content read by chat__mentions_inline. Agreement with the client's
-- mentionsOf(parseStored(·)) was checked on 23,367 bodies
-- (docs/build/chat-v2/CV-2a.md).
CREATE OR REPLACE FUNCTION public.chat__mentions(
  p_body text, OUT people uuid[], OUT teams uuid[], OUT everyone boolean)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  v_lines text[];
  n integer;
  i integer := 1;
  v_runs text[] := '{}';
  v_run text;
  v_line text;
  m text[];
  v_size integer;
  v_body text[];
  v_item text[];
  v_first text[];
  v_mark text[];
  v_next text[];
  v_indent integer;
  v_para text[];
  v_prev text;
  v_cand text;
  v_cut boolean;
  mt record;
  v_id uuid;
BEGIN
  people := '{}';
  teams := '{}';
  everyone := false;
  IF p_body IS NULL OR p_body !~ '(moduo|@channel)' THEN
    RETURN;
  END IF;
  -- The block walk is chat__body_text's; it collects the inline runs.
  v_lines := string_to_array(regexp_replace(p_body, E'\r\n?', E'\n', 'g'), E'\n');
  n := cardinality(v_lines);
  WHILE i <= n LOOP
    v_line := v_lines[i];
    m := regexp_match(v_line, '^ {0,3}(`{3,})([^`]*)$');
    IF m IS NOT NULL THEN
      v_size := length(m[1]);
      i := i + 1;
      WHILE i <= n LOOP
        m := regexp_match(v_lines[i], '^ {0,3}(`+)[ \t]*$');
        EXIT WHEN m IS NOT NULL AND length(m[1]) >= v_size;
        i := i + 1;
      END LOOP;
      i := i + 1;
      IF i <= n AND v_lines[i] = '' THEN i := i + 1; END IF;
      CONTINUE;
    END IF;
    IF v_line ~ '^ {0,3}>' THEN
      v_body := '{}';
      WHILE i <= n AND v_lines[i] ~ '^ {0,3}>' LOOP
        v_body := v_body || substring(v_lines[i] FROM '^ {0,3}> ?(.*)$');
        i := i + 1;
      END LOOP;
      v_runs := v_runs || array_to_string(v_body, E'\n');
      IF i <= n AND v_lines[i] = '' THEN i := i + 1; END IF;
      CONTINUE;
    END IF;
    v_first := public.chat__list_marker(v_line);
    IF v_first IS NOT NULL THEN
      v_mark := v_first;
      WHILE v_mark IS NOT NULL LOOP
        v_item := ARRAY[v_mark[5]];
        v_indent := v_mark[4]::integer;
        i := i + 1;
        LOOP
          EXIT WHEN i > n OR v_lines[i] = '';
          IF v_lines[i] ~ '^[[:space:]]+$' THEN
            v_item := v_item || CASE WHEN length(v_lines[i]) > v_indent THEN substr(v_lines[i], v_indent + 1) ELSE '' END;
          ELSIF left(v_lines[i], v_indent) = repeat(' ', v_indent) THEN
            v_item := v_item || substr(v_lines[i], v_indent + 1);
          ELSE
            EXIT;
          END IF;
          i := i + 1;
        END LOOP;
        v_runs := v_runs || array_to_string(v_item, E'\n');
        v_next := CASE WHEN i <= n THEN public.chat__list_marker(v_lines[i]) END;
        v_mark := CASE WHEN v_next IS NOT NULL AND v_next[1] = v_first[1] AND v_next[2] = v_first[2]
                       THEN v_next END;
      END LOOP;
      IF i <= n AND v_lines[i] = '' THEN i := i + 1; END IF;
      CONTINUE;
    END IF;
    v_para := ARRAY[v_line];
    i := i + 1;
    LOOP
      EXIT WHEN i > n;
      v_cand := v_lines[i];
      v_prev := v_lines[i - 1];
      IF v_cand ~ '^ {0,3}(`{3,})([^`]*)$' OR v_cand ~ '^ {0,3}>' THEN
        v_cut := true;
      ELSE
        v_mark := public.chat__list_marker(v_cand);
        v_cut := v_mark IS NOT NULL AND (
          v_prev = ''
          OR (btrim(v_mark[5], E' \t\n\r\f\v') <> ''
              AND (v_mark[1] = 'f' OR v_mark[3]::bigint = 1)));
      END IF;
      EXIT WHEN v_cut;
      v_para := v_para || v_cand;
      i := i + 1;
    END LOOP;
    IF i <= n AND cardinality(v_para) > 1 AND v_para[cardinality(v_para)] = '' THEN
      v_para := v_para[1:cardinality(v_para) - 1];
    ELSIF i <= n AND cardinality(v_para) = 1 AND v_para[1] = '' THEN
      CONTINUE;
    END IF;
    v_runs := v_runs || array_to_string(v_para, E'\n');
  END LOOP;
  FOREACH v_run IN ARRAY v_runs LOOP
    CONTINUE WHEN v_run !~ '(moduo|@channel)';
    SELECT * INTO mt FROM public.chat__mentions_inline(v_run);
    everyone := everyone OR mt.everyone;
    FOREACH v_id IN ARRAY mt.people LOOP
      IF NOT v_id = ANY (people) THEN people := people || v_id; END IF;
    END LOOP;
    FOREACH v_id IN ARRAY mt.teams LOOP
      IF NOT v_id = ANY (teams) THEN teams := teams || v_id; END IF;
    END LOOP;
  END LOOP;
END
$fn$;

-- The bell's excerpt, built on the server from the stored form (CV-11 draws it
-- with the stored-form parser): the first 140 characters, without a reference
-- cut in half.
CREATE OR REPLACE FUNCTION public.chat__excerpt(p_body text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
DECLARE
  v text := left(coalesce(p_body, ''), 140);
BEGIN
  IF char_length(coalesce(p_body, '')) > 140
     AND v !~ 'moduo://date/[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    v := regexp_replace(v, 'moduo:(?:/(?:/(?:[a-z][a-z_-]{0,31}(?:/[0-9a-fA-F-]{0,35})?)?)?)?$', '');
  END IF;
  RETURN v;
END
$fn$;

-- A chain's counters from its live replies: how many, the last one's time and
-- the last five people to reply, most recent first.
CREATE OR REPLACE FUNCTION public.chat__chain_refresh(p_root uuid)
RETURNS void
LANGUAGE sql
SET search_path = ''
AS $fn$
  UPDATE public.chat_messages r
     SET reply_count = s.n,
         last_reply_at = s.last_at,
         reply_user_ids = s.people
    FROM (SELECT count(*)::int AS n,
                 max(x.created_at) AS last_at,
                 coalesce((SELECT array_agg(p.author_id ORDER BY p.at DESC)
                             FROM (SELECT y.author_id, max(y.created_at) AS at
                                     FROM public.chat_messages y
                                    WHERE y.parent_id = p_root AND y.deleted_at IS NULL
                                      AND y.author_id IS NOT NULL
                                    GROUP BY y.author_id
                                    ORDER BY at DESC
                                    LIMIT 5) p), '{}'::uuid[]) AS people
            FROM public.chat_messages x
           WHERE x.parent_id = p_root AND x.deleted_at IS NULL) s
   WHERE r.id = p_root
     AND (r.reply_count, r.last_reply_at, r.reply_user_ids)
         IS DISTINCT FROM (s.n, s.last_at, s.people);
$fn$;

-- A message's text: not empty, at most 8,000 stored characters (references
-- included), refused with the count and nothing kept.
CREATE OR REPLACE FUNCTION public.chat__check_body(p_body text)
RETURNS void
LANGUAGE plpgsql IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE
  v_len integer := char_length(coalesce(p_body, ''));
BEGIN
  IF btrim(coalesce(p_body, ''), E' \n\t') = '' THEN
    RAISE EXCEPTION 'A message can''t be empty.' USING ERRCODE = '22023';
  END IF;
  IF v_len > 8000 THEN
    RAISE EXCEPTION 'That message is % characters long; the most is 8,000.', to_char(v_len, 'FM999,999')
      USING ERRCODE = '22023', DETAIL = json_build_object('length', v_len, 'max', 8000)::text;
  END IF;
END
$fn$;

-- Who a message in this conversation mentions, as stored: people who can read
-- the conversation, live teams of its workspace, and @channel only when the
-- writer may mention everyone.
CREATE OR REPLACE FUNCTION public.chat__read_mentions(
  p_channel public.chat_channels, p_body text, p_actor uuid,
  OUT people uuid[], OUT teams uuid[], OUT everyone boolean)
LANGUAGE plpgsql STABLE
SET search_path = ''
AS $fn$
BEGIN
  SELECT mt.people, mt.teams, mt.everyone INTO people, teams, everyone
    FROM public.chat__mentions(p_body) mt;
  SELECT coalesce(array_agg(u ORDER BY o), '{}') INTO people
    FROM unnest(people) WITH ORDINALITY t(u, o)
   WHERE public.chat__can_read_channel_as(p_channel.id, u);
  SELECT coalesce(array_agg(u ORDER BY o), '{}') INTO teams
    FROM unnest(teams) WITH ORDINALITY t(u, o)
   WHERE EXISTS (SELECT 1 FROM public.teams tm
                  WHERE tm.id = u AND tm.workspace_id = p_channel.workspace_id AND tm.deleted_at IS NULL);
  everyone := everyone AND public.chat_has_cap(p_channel.workspace_id, p_actor, 'mention_everyone');
END
$fn$;

-- Whether a manager removed this person from the conversation (CV-2b's
-- chat_op_remove_member stamps removed_by): they still read a public one, but
-- don't post, edit or pin there.
CREATE OR REPLACE FUNCTION public.chat__was_removed(p_channel_id uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = ''
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.chat_members mb
                  WHERE mb.channel_id = p_channel_id AND mb.user_id = p_user
                    AND mb.left_at IS NOT NULL AND mb.removed_by IS NOT NULL)
$fn$;

-- ── 5. The ops ──────────────────────────────────────────────────────────────

-- The share guard reads the parsed @channel flag, not words: "@channel" from a
-- role without "Mention everyone" is stored as plain text (the op sets no flag).
CREATE OR REPLACE FUNCTION public.share_chat_message_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_channel public.chat_channels;
  -- An app's message has no author; it posts as its key's creator.
  v_author uuid := coalesce(NEW.author_id, public.perm_actor_id());
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = NEW.channel_id;
  IF NOT public.chat_has_cap(NEW.workspace_id, v_author, 'post') THEN
    RAISE EXCEPTION 'Your role can''t post in chat.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.managers_only
     AND NOT EXISTS (
       SELECT 1 FROM public.chat_channel_managers m
       WHERE m.channel_id = NEW.channel_id AND m.user_id = v_author
     ) THEN
    RAISE EXCEPTION 'Only managers can post in this channel.' USING ERRCODE = '42501';
  END IF;
  IF NEW.mentions_everyone
     AND NOT public.chat_has_cap(NEW.workspace_id, v_author, 'mention_everyone') THEN
    RAISE EXCEPTION 'Your role can''t mention everyone.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

-- chat_op_send(id, channel, body, reply_to_id): a v2 message.
CREATE OR REPLACE FUNCTION public.chat_op_send(
  p_id uuid, p_channel_id uuid, p_body text, p_reply_to_id uuid DEFAULT NULL)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_channel public.chat_channels;
  v_body text := coalesce(p_body, '');
  v_quoted public.chat_messages;
  v_root public.chat_messages;
  v_msg public.chat_messages;
  v_people uuid[];
  v_teams uuid[];
  v_everyone boolean;
  v_notify jsonb := '[]'::jsonb;
  v_op text;
BEGIN
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'A message needs its id.' USING ERRCODE = '22023';
  END IF;
  -- A resent id returns the stored row (the outbox retries with the same id),
  -- only to its author, in its conversation, while they can still read it.
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_id;
  IF v_msg.id IS NOT NULL THEN
    IF v_me IS NOT NULL AND v_msg.author_id = v_me AND v_msg.channel_id = p_channel_id
       AND public.chat_can_read_channel(p_channel_id) THEN
      RETURN v_msg;
    END IF;
    PERFORM public.chat_op__channel(p_channel_id);
    RAISE EXCEPTION 'That message id is already used.' USING ERRCODE = '22023';
  END IF;

  v_channel := public.chat_op__channel(p_channel_id);
  IF NOT public.chat_has_cap(v_channel.workspace_id, v_me, 'post') THEN
    RAISE EXCEPTION 'Your role can''t post in chat.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF public.chat__was_removed(p_channel_id, v_me) THEN
    RAISE EXCEPTION 'You were removed from this conversation.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.chat__check_body(v_body);

  -- A reply posts in the conversation and joins the chain of what it answers.
  IF p_reply_to_id IS NOT NULL THEN
    SELECT * INTO v_quoted FROM public.chat_messages WHERE id = p_reply_to_id;
    IF v_quoted.id IS NULL OR v_quoted.channel_id <> p_channel_id OR v_quoted.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
    END IF;
    IF v_quoted.kind <> 'message' THEN
      RAISE EXCEPTION 'Only a message can be replied to.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_root FROM public.chat_messages
     WHERE id = coalesce(v_quoted.parent_id, v_quoted.id) FOR UPDATE;
  END IF;

  -- Who it mentions is read from the text, here.
  SELECT mt.people, mt.teams, mt.everyone INTO v_people, v_teams, v_everyone
    FROM public.chat__read_mentions(v_channel, v_body, v_me) mt;

  -- Posting in a public channel joins it, or back after leaving it.
  INSERT INTO public.chat_members (channel_id, user_id, workspace_id)
  VALUES (p_channel_id, v_me, v_channel.workspace_id)
  ON CONFLICT (channel_id, user_id) DO UPDATE SET left_at = NULL
   WHERE public.chat_members.left_at IS NOT NULL;

  -- client_id = id while the v1 wrappers live: v1 screens and old builds match
  -- their optimistic row by it (CV-23 stops writing it).
  INSERT INTO public.chat_messages
    (id, client_id, workspace_id, channel_id, parent_id, reply_to_id, author_id, body, format_version,
     mentioned_user_ids, mentioned_team_ids, mentions_everyone)
  VALUES
    (p_id, p_id, v_channel.workspace_id, p_channel_id, v_root.id, v_quoted.id, v_me, v_body, 2,
     v_people, v_teams, v_everyone)
  ON CONFLICT DO NOTHING
  RETURNING * INTO v_msg;
  IF v_msg.id IS NULL THEN
    -- The same id sent twice at once: the first one won.
    SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_id;
    IF v_msg.author_id = v_me AND v_msg.channel_id = p_channel_id THEN
      RETURN v_msg;
    END IF;
    RAISE EXCEPTION 'That message id is already used.' USING ERRCODE = '22023';
  END IF;

  IF v_root.id IS NOT NULL THEN
    UPDATE public.chat_messages
       SET reply_count = reply_count + 1,
           last_reply_at = v_msg.created_at,
           reply_user_ids = (
             SELECT coalesce(array_agg(u), '{}') FROM (
               SELECT u FROM unnest(array[v_me] || array_remove(reply_user_ids, v_me)) WITH ORDINALITY t(u, o)
                ORDER BY o LIMIT 5) s)
     WHERE id = v_root.id;
  END IF;
  -- Replies post at the bottom too: the conversation's last message moves.
  UPDATE public.chat_channels SET last_message_at = v_msg.created_at
   WHERE id = p_channel_id AND (last_message_at IS NULL OR last_message_at < v_msg.created_at);
  -- The sender has read up to their own message.
  UPDATE public.chat_members mb
     SET last_read_id = v_msg.id,
         last_read_at = greatest(mb.last_read_at, v_msg.created_at)
   WHERE mb.channel_id = p_channel_id AND mb.user_id = v_me
     AND NOT EXISTS (SELECT 1 FROM public.chat_messages r
                      WHERE r.id = mb.last_read_id
                        AND (r.created_at, r.id) > (v_msg.created_at, v_msg.id));

  -- The bell, as v1 rang it, until CV-5's fan-out replaces it: people named,
  -- everyone on @channel, and on a reply the chain's people; only those who can
  -- read the conversation, never the sender.
  SELECT coalesce(jsonb_agg(DISTINCT s.uid::text), '[]'::jsonb) INTO v_notify FROM (
    SELECT unnest(v_people) AS uid
    UNION
    SELECT m.user_id FROM public.chat_members m
     WHERE v_everyone AND m.channel_id = p_channel_id AND m.left_at IS NULL AND m.notify_level <> 'none'
    UNION
    SELECT v_root.author_id WHERE v_root.id IS NOT NULL
    UNION
    SELECT v_quoted.author_id WHERE v_quoted.id IS NOT NULL
    UNION
    SELECT r.author_id FROM public.chat_messages r
     WHERE v_root.id IS NOT NULL AND r.parent_id = v_root.id AND r.deleted_at IS NULL
  ) s
  WHERE s.uid IS NOT NULL AND s.uid IS DISTINCT FROM v_me
    AND public.chat__can_read_channel_as(p_channel_id, s.uid);

  IF v_notify <> '[]'::jsonb THEN
    v_op := CASE WHEN cardinality(v_people) > 0 OR v_everyone THEN 'chat.mention' ELSE 'chat.reply' END;
    PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', p_channel_id, v_op,
      jsonb_build_object(
        'message_id', v_msg.id,
        'parent_id', v_root.id,
        'reply_to_id', v_quoted.id,
        'channel_name', v_channel.name,
        'channel_kind', v_channel.kind,
        'excerpt', public.chat__excerpt(v_body),
        'format_version', 2,
        'notify_user_ids', v_notify));
  END IF;
  RETURN v_msg;
END;
$function$;

-- chat_op_edit(message, body): the author's v2 text; mentions are read again.
-- A person named for the first time is told by CV-5's fan-out, not here.
CREATE OR REPLACE FUNCTION public.chat_op_edit(p_message_id uuid, p_body text)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_msg public.chat_messages;
  v_channel public.chat_channels;
  v_body text := coalesce(p_body, '');
  v_people uuid[];
  v_teams uuid[];
  v_everyone boolean;
BEGIN
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  v_channel := public.chat_op__channel(v_msg.channel_id);
  IF v_msg.author_id IS DISTINCT FROM v_me OR v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'You can only edit your own messages.' USING ERRCODE = '42501';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.chat_has_cap(v_channel.workspace_id, v_me, 'post') THEN
    RAISE EXCEPTION 'Your role can''t post in chat.' USING ERRCODE = '42501';
  END IF;
  IF public.chat__was_removed(v_msg.channel_id, v_me) THEN
    RAISE EXCEPTION 'You were removed from this conversation.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.chat__check_body(v_body);
  -- The same text again changes nothing (a resent edit).
  IF v_msg.format_version = 2 AND v_msg.body = v_body THEN
    RETURN v_msg;
  END IF;

  SELECT mt.people, mt.teams, mt.everyone INTO v_people, v_teams, v_everyone
    FROM public.chat__read_mentions(v_channel, v_body, v_me) mt;

  UPDATE public.chat_messages
     SET body = v_body,
         format_version = 2,
         mentioned_user_ids = v_people,
         mentioned_team_ids = v_teams,
         mentions_everyone = v_everyone,
         edited_at = now()
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  PERFORM public.module_activity_log(v_channel.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.message_edit', jsonb_build_object('message_id', v_msg.id));
  RETURN v_msg;
END;
$function$;

-- Who may delete (and undo the delete of) a message: its author while they can
-- post, or anyone with "Delete others' messages".
CREATE OR REPLACE FUNCTION public.chat__may_delete(p_msg public.chat_messages, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $fn$
  SELECT coalesce(p_msg.author_id = p_user AND public.chat_has_cap(p_msg.workspace_id, p_user, 'post'), false)
      OR public.chat_has_cap(p_msg.workspace_id, p_user, 'delete_others')
$fn$;

-- chat_op_delete(message): hidden at once; the Undo window is 8 s in the app
-- (10 s here, for the request in flight), after which chat-blank-deleted blanks
-- its text, mentions, reactions and pin.
CREATE OR REPLACE FUNCTION public.chat_op_delete(p_message_id uuid)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
BEGIN
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_op__channel(v_msg.channel_id);
  IF NOT public.chat__may_delete(v_msg, auth.uid()) THEN
    RAISE EXCEPTION 'You can only delete your own messages.' USING ERRCODE = '42501';
  END IF;
  IF v_msg.deleted_at IS NOT NULL THEN
    RETURN v_msg;
  END IF;
  -- The clock, not the transaction's start: the Undo window is measured on it.
  UPDATE public.chat_messages SET deleted_at = clock_timestamp(), deleted_by = auth.uid()
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  IF v_msg.parent_id IS NOT NULL THEN
    PERFORM public.chat__chain_refresh(v_msg.parent_id);
  END IF;
  PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.message_delete', jsonb_build_object('message_id', v_msg.id));
  RETURN v_msg;
END;
$function$;

-- chat_op_restore(message): Undo inside the window.
CREATE OR REPLACE FUNCTION public.chat_op_restore(p_message_id uuid)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
  v_unpin boolean;
BEGIN
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  PERFORM public.chat_op__channel(v_msg.channel_id);
  IF v_msg.deleted_at IS NULL THEN
    IF NOT public.chat__may_delete(v_msg, auth.uid()) THEN
      RAISE EXCEPTION 'You can only delete your own messages.' USING ERRCODE = '42501';
    END IF;
    RETURN v_msg;
  END IF;
  -- The Undo is the deleter's (while they may still delete it), or anyone's who
  -- may delete others' messages: an author can't undo a delete by someone else.
  IF NOT (coalesce(v_msg.deleted_by = auth.uid(), false) AND public.chat__may_delete(v_msg, auth.uid())
          OR public.chat_has_cap(v_msg.workspace_id, auth.uid(), 'delete_others')) THEN
    RAISE EXCEPTION 'Only the person who deleted it can undo that.' USING ERRCODE = '42501';
  END IF;
  IF clock_timestamp() - v_msg.deleted_at > interval '10 seconds' THEN
    RAISE EXCEPTION 'It''s too late to undo that delete.' USING ERRCODE = '22023';
  END IF;
  -- Back unpinned if its conversation filled its 100 pins meanwhile.
  IF v_msg.pinned_at IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('chat_pin:' || v_msg.channel_id::text));
  END IF;
  v_unpin := v_msg.pinned_at IS NOT NULL
             AND (SELECT count(*) FROM public.chat_messages p
                   WHERE p.channel_id = v_msg.channel_id AND p.pinned_at IS NOT NULL
                     AND p.deleted_at IS NULL) >= 100;
  UPDATE public.chat_messages
     SET deleted_at = NULL, deleted_by = NULL,
         pinned_at = CASE WHEN v_unpin THEN NULL ELSE pinned_at END,
         pinned_by = CASE WHEN v_unpin THEN NULL ELSE pinned_by END
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  IF v_msg.parent_id IS NOT NULL THEN
    PERFORM public.chat__chain_refresh(v_msg.parent_id);
  END IF;
  PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.message_restore', jsonb_build_object('message_id', v_msg.id));
  IF v_unpin THEN
    PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
      'chat.pin', jsonb_build_object('message_id', v_msg.id, 'pinned', false));
  END IF;
  RETURN v_msg;
END;
$function$;

-- The minute job: blanks what a deleted message held once its window passed,
-- and the bell's excerpt of it. Its rows reach clients as updates (updated_at
-- moves).
CREATE OR REPLACE FUNCTION public.chat__blank_deleted(p_limit integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_count integer;
BEGIN
  WITH due AS (
    SELECT m.id FROM public.chat_messages m
     WHERE m.deleted_at IS NOT NULL
       AND (m.body <> '' OR m.reactions <> '{}'::jsonb OR m.pinned_at IS NOT NULL
            OR m.mentioned_user_ids <> '{}'::uuid[] OR m.mentioned_team_ids <> '{}'::uuid[]
            OR m.mentions_everyone)
       AND m.deleted_at < clock_timestamp() - interval '10 seconds'
     ORDER BY m.deleted_at
     LIMIT greatest(coalesce(p_limit, 5000), 1)
     FOR UPDATE SKIP LOCKED
  ), blanked AS (
    UPDATE public.chat_messages m
       SET body = '',
           mentioned_user_ids = '{}',
           mentioned_team_ids = '{}',
           mentions_everyone = false,
           reactions = '{}'::jsonb,
           pinned_at = NULL,
           pinned_by = NULL
      FROM due
     WHERE m.id = due.id
    RETURNING m.id, m.workspace_id, m.channel_id
  ), bell AS (
    -- The bell's excerpt of a deleted message goes with its text.
    UPDATE public.module_activity a
       SET payload = jsonb_set(a.payload, '{excerpt}', '""'::jsonb)
      FROM blanked b
     WHERE a.workspace_id = b.workspace_id AND a.module = 'chat'
       AND a.entity_type = 'chat_channel' AND a.entity_id = b.channel_id
       AND a.payload ->> 'message_id' = b.id::text
       AND coalesce(a.payload ->> 'excerpt', '') <> ''
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM blanked;
  RETURN v_count;
END
$fn$;

-- chat_op_react(message, key, on): explicit on or off, idempotent, never
-- notifies; anyone who can read the conversation, viewers too, and while the
-- workspace's chat is paused. The key check and the 20-kind cap stay as v1's
-- until CV-7c's shared key.
CREATE OR REPLACE FUNCTION public.chat_op_react(p_message_id uuid, p_key text, p_on boolean)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
  v_me text := auth.uid()::text;
  v_list jsonb;
BEGIN
  IF p_key IS NULL OR char_length(p_key) = 0 OR char_length(p_key) > 32 THEN
    RAISE EXCEPTION 'That reaction isn''t supported.' USING ERRCODE = '22023';
  END IF;
  IF p_on IS NULL THEN
    RAISE EXCEPTION 'Say whether the reaction is on or off.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF (public.chat_op__reader(v_msg.channel_id)).archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'Only a message takes reactions.' USING ERRCODE = '22023';
  END IF;

  v_list := coalesce(v_msg.reactions -> p_key, '[]'::jsonb);
  IF p_on = (v_list ? v_me) THEN
    RETURN v_msg;
  END IF;
  IF p_on THEN
    IF NOT (v_msg.reactions ? p_key) AND (SELECT count(*) FROM jsonb_object_keys(v_msg.reactions)) >= 20 THEN
      RAISE EXCEPTION 'This message has the most reactions it can hold.' USING ERRCODE = '22023';
    END IF;
    v_list := v_list || to_jsonb(v_me);
  ELSE
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_list
      FROM jsonb_array_elements_text(v_list) x WHERE x <> v_me;
  END IF;

  UPDATE public.chat_messages
     SET reactions = CASE WHEN jsonb_array_length(v_list) = 0 THEN reactions - p_key
                          ELSE jsonb_set(reactions, array[p_key], v_list) END
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.react', jsonb_build_object('message_id', v_msg.id, 'key', p_key, 'on', p_on));
  RETURN v_msg;
END;
$function$;

-- chat_op_pin(message, pinned): messages only, not event lines; ≤ 100 live pins
-- per conversation. Whoever can post there pins (managers only in an
-- announcement channel), and anyone with "Manage any channel".
CREATE OR REPLACE FUNCTION public.chat_op_pin(p_message_id uuid, p_pinned boolean DEFAULT true)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_msg public.chat_messages;
  v_channel public.chat_channels;
BEGIN
  IF p_pinned IS NULL THEN
    RAISE EXCEPTION 'Say whether to pin or unpin.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_msg FROM public.chat_messages WHERE id = p_message_id FOR UPDATE;
  IF v_msg.id IS NULL OR v_msg.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'That message no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  v_channel := public.chat_op__channel(v_msg.channel_id);
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'This channel is archived.' USING ERRCODE = '42501';
  END IF;
  IF v_msg.kind <> 'message' THEN
    RAISE EXCEPTION 'Only a message can be pinned.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.chat_has_cap(v_channel.workspace_id, v_me, 'manage_any')
     AND NOT (public.chat_has_cap(v_channel.workspace_id, v_me, 'post')
              AND NOT public.chat__was_removed(v_channel.id, v_me)
              AND (NOT v_channel.managers_only
                   OR EXISTS (SELECT 1 FROM public.chat_channel_managers cm
                               WHERE cm.channel_id = v_channel.id AND cm.user_id = v_me))) THEN
    RAISE EXCEPTION 'Your role can''t pin messages here.' USING ERRCODE = '42501';
  END IF;
  IF p_pinned = (v_msg.pinned_at IS NOT NULL) THEN
    RETURN v_msg;
  END IF;
  -- One pin at a time per conversation, so the cap holds.
  PERFORM pg_advisory_xact_lock(hashtext('chat_pin:' || v_msg.channel_id::text));
  IF p_pinned AND (SELECT count(*) FROM public.chat_messages p
                    WHERE p.channel_id = v_msg.channel_id AND p.pinned_at IS NOT NULL
                      AND p.deleted_at IS NULL) >= 100 THEN
    RAISE EXCEPTION 'This conversation has 100 pinned messages; unpin one first.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.chat_messages
     SET pinned_at = CASE WHEN p_pinned THEN now() END,
         pinned_by = CASE WHEN p_pinned THEN v_me END
   WHERE id = p_message_id
  RETURNING * INTO v_msg;
  PERFORM public.module_activity_log(v_msg.workspace_id, 'chat', 'chat_channel', v_msg.channel_id,
    'chat.pin', jsonb_build_object('message_id', v_msg.id, 'pinned', p_pinned));
  RETURN v_msg;
END;
$function$;

-- chat_op_typing: the live body (20261014155205: "typing" at most once per 2.5 s
-- per person and conversation, "stopped" only to close an open "typing", for
-- its thread). The sender must be a member of the conversation who hasn't left
-- (the typing topic's readers); refusals carry codes.
CREATE OR REPLACE FUNCTION public.chat_op_typing(p_channel_id uuid, p_parent_id uuid DEFAULT NULL::uuid, p_stop boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_channel public.chat_channels := public.chat_op__channel(p_channel_id);
  v_send boolean;
  v_parent uuid := p_parent_id;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_members m
                  WHERE m.channel_id = v_channel.id AND m.user_id = auth.uid() AND m.left_at IS NULL) THEN
    RAISE EXCEPTION 'You''re not a member of this conversation.' USING ERRCODE = '42501';
  END IF;
  IF p_parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chat_messages m
    WHERE m.id = p_parent_id AND m.channel_id = v_channel.id
      AND m.parent_id IS NULL AND m.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'That thread no longer exists.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT coalesce(p_stop, false) THEN
    -- Moves the mark only when the last start is old enough; a row back means send.
    INSERT INTO public.chat_typing_marks AS t (user_id, channel_id, sent_at, parent_id, open)
    VALUES (auth.uid(), v_channel.id, now(), p_parent_id, true)
    ON CONFLICT (user_id, channel_id) DO UPDATE
      SET sent_at = EXCLUDED.sent_at, parent_id = EXCLUDED.parent_id, open = true
      WHERE t.sent_at <= EXCLUDED.sent_at - interval '2.5 seconds'
    RETURNING true INTO v_send;
  ELSE
    -- Closes an open start, never moving its time; a row back means send, for
    -- the thread that start was in.
    UPDATE public.chat_typing_marks SET open = false
     WHERE user_id = auth.uid() AND channel_id = v_channel.id AND open
    RETURNING true, parent_id INTO v_send, v_parent;
  END IF;
  IF v_send IS NULL THEN
    RETURN;
  END IF;
  PERFORM realtime.send(
    jsonb_build_object(
      'userId', auth.uid(),
      'channelId', v_channel.id,
      'parentId', v_parent,
      'stop', coalesce(p_stop, false)),
    'typing',
    'chat:typing:' || v_channel.id::text,
    true);
END;
$function$;

-- The sending limits (live body, 20261014155205; same numbers, same PT429):
-- event lines an op writes are not sends and don't count; a message posted
-- through an API key (api_key_id) counts against that key's own budget, and
-- not against its person's; an app's message without a key id (v1's
-- chat_op_agent_post) still shares the workspace's apps budget.
CREATE INDEX IF NOT EXISTS chat_messages_api_key_recent_idx
  ON public.chat_messages (api_key_id, created_at) WHERE api_key_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.chat_send_limit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET lock_timeout TO '2s'
AS $function$
DECLARE
  v_in_10s integer;
  v_in_60s integer;
BEGIN
  -- Only what a signed-in person or an API key writes.
  IF auth.uid() IS NULL AND public.module_api_key_id() IS NULL THEN
    RETURN NEW;
  END IF;
  -- An event line ("moved here") is written by an op, not sent.
  IF NEW.kind = 'event' THEN
    RETURN NEW;
  END IF;

  -- One send per sender and workspace at a time, so each count includes the
  -- send before it. A send still waiting after 2 s is refused like any other.
  BEGIN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      'chat_send_limit:'
      || CASE WHEN NEW.api_key_id IS NOT NULL THEN 'key:' || NEW.api_key_id::text
              ELSE coalesce(NEW.author_id::text, 'apps') END
      || ':' || NEW.workspace_id::text, 0));
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'You''re sending messages too quickly. Wait a moment and try again.'
      USING ERRCODE = 'PT429';
  END;

  -- The newest 30 in the last minute are all either limit needs.
  IF NEW.api_key_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE r.created_at > now() - interval '10 seconds')
      INTO v_in_60s, v_in_10s
      FROM (SELECT m.created_at FROM public.chat_messages m
             WHERE m.api_key_id = NEW.api_key_id
               AND m.kind = 'message'
               AND m.created_at > now() - interval '60 seconds'
             ORDER BY m.created_at DESC
             LIMIT 30) r;
  ELSIF NEW.author_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE r.created_at > now() - interval '10 seconds')
      INTO v_in_60s, v_in_10s
      FROM (SELECT m.created_at FROM public.chat_messages m
             WHERE m.author_id = NEW.author_id
               AND m.workspace_id = NEW.workspace_id
               AND m.api_key_id IS NULL
               AND m.kind = 'message'
               AND m.created_at > now() - interval '60 seconds'
             ORDER BY m.created_at DESC
             LIMIT 30) r;
  ELSE
    SELECT count(*), count(*) FILTER (WHERE r.created_at > now() - interval '10 seconds')
      INTO v_in_60s, v_in_10s
      FROM (SELECT m.created_at FROM public.chat_messages m
             WHERE m.author_id IS NULL
               AND m.workspace_id = NEW.workspace_id
               AND m.author_kind = 'api_key'
               AND m.api_key_id IS NULL
               AND m.kind = 'message'
               AND m.created_at > now() - interval '60 seconds'
             ORDER BY m.created_at DESC
             LIMIT 30) r;
  END IF;

  IF v_in_10s >= 10 OR v_in_60s >= 30 THEN
    RAISE EXCEPTION 'You''re sending messages too quickly. Wait a moment and try again.'
      USING ERRCODE = 'PT429';
  END IF;
  RETURN NEW;
END;
$function$;

-- ── 6. The v1 signatures, one release (CV-23 drops them) ────────────────────

-- v1 send: converts v1 markup and sends through the v2 op. v1's client id is the
-- message id (a row sent before the release is found by its client id); the
-- mention list, @channel switch and excerpt the client passed are not read
-- (the server reads the text).
CREATE OR REPLACE FUNCTION public.chat_op_send(p_channel_id uuid, p_body text, p_parent_id uuid DEFAULT NULL::uuid, p_mentioned_user_ids uuid[] DEFAULT '{}'::uuid[], p_notify_channel boolean DEFAULT false, p_client_id uuid DEFAULT NULL::uuid, p_excerpt text DEFAULT NULL::text)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_msg public.chat_messages;
BEGIN
  IF p_client_id IS NOT NULL AND auth.uid() IS NOT NULL THEN
    SELECT * INTO v_msg FROM public.chat_messages
     WHERE author_id = auth.uid() AND client_id = p_client_id AND channel_id = p_channel_id;
    IF v_msg.id IS NOT NULL AND public.chat_can_read_channel(p_channel_id) THEN
      RETURN v_msg;
    END IF;
  END IF;
  RETURN public.chat_op_send(
    coalesce(p_client_id, gen_random_uuid()), p_channel_id,
    public.chat__v1_to_v2(coalesce(p_body, '')), p_parent_id);
END;
$function$;

-- The v1 composer's tokens in otherwise v2 text: `<@id>` → a person,
-- `<!channel>` → @channel, `<moduo:type:id|label>` → the reference.
CREATE OR REPLACE FUNCTION public.chat__v1_tokens(p_body text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = ''
AS $fn$
  SELECT regexp_replace(
           regexp_replace(
             regexp_replace(p_body,
               '<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>',
               'moduo://person/\1', 'g'),
             '<!channel>', '@channel', 'g'),
           '<moduo:([a-z_]{1,32}):([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\|[^>\n]{0,200}>',
           'moduo://\1/\2', 'g')
$fn$;

-- v1 edit: edits through the v2 op. Its third argument has no default any
-- more, so a two-argument call means the v2 op.
DROP FUNCTION IF EXISTS public.chat_op_edit(uuid, text, uuid[]);
CREATE FUNCTION public.chat_op_edit(p_message_id uuid, p_body text, p_mentioned_user_ids uuid[])
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- v1's composer opens an edit with the stored text: a v1 row's text is v1
  -- markup (converted whole); a v2 row's text is v2 already, and only the v1
  -- tokens its composer adds (a person picked, @channel, an item) are rewritten.
  IF (SELECT m.format_version FROM public.chat_messages m WHERE m.id = p_message_id) = 1 THEN
    RETURN public.chat_op_edit(p_message_id, public.chat__v1_to_v2(coalesce(p_body, '')));
  END IF;
  RETURN public.chat_op_edit(p_message_id, public.chat__v1_tokens(coalesce(p_body, '')));
END;
$function$;

-- v1 react: a toggle, through the v2 op.
CREATE OR REPLACE FUNCTION public.chat_op_react(p_message_id uuid, p_emoji text)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_on boolean;
BEGIN
  SELECT NOT coalesce((m.reactions -> p_emoji) ? auth.uid()::text, false) INTO v_on
    FROM public.chat_messages m WHERE m.id = p_message_id;
  RETURN public.chat_op_react(p_message_id, p_emoji, coalesce(v_on, true));
END;
$function$;

-- The app's post (live body; CV-21 redefines it): its v1 markup is converted, so
-- every new row is v2.
CREATE OR REPLACE FUNCTION public.chat_op_agent_post(p_workspace_id uuid, p_channel_id uuid, p_body text, p_parent_id uuid DEFAULT NULL::uuid)
 RETURNS chat_messages
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_key uuid := public.module_api_key_id();
  v_label text;
  v_channel public.chat_channels;
  v_parent public.chat_messages;
  v_msg public.chat_messages;
  v_body text := coalesce(p_body, '');
  v_stored text;
  v_mentions uuid[];
  v_notify jsonb;
begin
  if v_key is null then
    raise exception 'Only an API key can post as an app.';
  end if;
  if public.chat_key_scope(p_workspace_id) <> 'edit' then
    raise exception 'This API key can''t post to chat — give it Chat: Edit in Workspace settings → API keys.';
  end if;
  if not public.chat_workspace_enabled(p_workspace_id) then
    raise exception 'Chat is available on the Duo and Team plans.';
  end if;

  select * into v_channel from public.chat_channels
   where id = p_channel_id and workspace_id = p_workspace_id;
  if v_channel.id is null or v_channel.kind <> 'channel' or v_channel.is_private then
    raise exception 'Apps can only post in public channels.';
  end if;
  if v_channel.archived_at is not null then
    raise exception 'This channel is archived.';
  end if;
  if btrim(v_body, E' \n\t') = '' then
    raise exception 'A message can''t be empty.';
  end if;
  if char_length(v_body) > 8000 then
    raise exception 'That message is too long (8,000 characters max).';
  end if;
  v_stored := public.chat__v1_to_v2(v_body);
  if char_length(v_stored) > 8000 then
    raise exception 'That message is too long (8,000 characters max).';
  end if;

  if p_parent_id is not null then
    select * into v_parent from public.chat_messages where id = p_parent_id for update;
    if v_parent.id is null or v_parent.channel_id <> p_channel_id or v_parent.parent_id is not null
       or v_parent.deleted_at is not null then
      raise exception 'That thread no longer exists.';
    end if;
  end if;

  select k.name into v_label from public.workspace_api_keys k where k.id = v_key;

  select coalesce(array_agg(distinct m[1]::uuid), '{}') into v_mentions
    from regexp_matches(v_body, '<@([0-9a-fA-F-]{36})>', 'g') m
   where public.chat_is_workspace_member(p_workspace_id, m[1]::uuid);

  insert into public.chat_messages
    (workspace_id, channel_id, parent_id, reply_to_id, author_id, author_kind, author_label, body,
     format_version, mentioned_user_ids)
  values
    (p_workspace_id, p_channel_id, p_parent_id, p_parent_id, null, 'api_key', coalesce(v_label, 'App'), v_stored,
     2, v_mentions)
  returning * into v_msg;

  if v_parent.id is not null then
    update public.chat_messages
       set reply_count = reply_count + 1, last_reply_at = v_msg.created_at
     where id = v_parent.id;
  else
    update public.chat_channels set last_message_at = v_msg.created_at where id = p_channel_id;
  end if;

  select coalesce(jsonb_agg(distinct s.uid::text), '[]'::jsonb) into v_notify
    from (select unnest(v_mentions) as uid
          union select v_parent.author_id where v_parent.id is not null) s
   where s.uid is not null;

  if v_notify <> '[]'::jsonb then
    perform public.module_activity_log(p_workspace_id, 'chat', 'chat_channel', p_channel_id,
      case when cardinality(v_mentions) > 0 then 'chat.mention' else 'chat.reply' end,
      jsonb_build_object(
        'message_id', v_msg.id,
        'parent_id', p_parent_id,
        'channel_name', v_channel.name,
        'channel_kind', v_channel.kind,
        'excerpt', left(regexp_replace(v_body, '<@[0-9a-fA-F-]{36}>', '@someone', 'g'), 140),
        'notify_user_ids', v_notify));
  end if;
  return v_msg;
end;
$function$;

-- ── 7. The blank job ────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat-blank-deleted') THEN
    PERFORM cron.unschedule('chat-blank-deleted');
  END IF;
END;
$$;
SELECT cron.schedule(
  'chat-blank-deleted',
  '* * * * *',
  $cron$SET statement_timeout = '50s'; SELECT public.chat__blank_deleted(5000);$cron$
);

-- ── 8. Grants ───────────────────────────────────────────────────────────────

DO $$
DECLARE
  fn text;
BEGIN
  -- Internal helpers: only the ops, the job and the service role call them.
  FOREACH fn IN ARRAY ARRAY[
    'chat__mentions(text)',
    'chat__mentions_inline(text)',
    'chat__mentions_ref_at(text)',
    'chat__excerpt(text)',
    'chat__check_body(text)',
    'chat__read_mentions(public.chat_channels, text, uuid)',
    'chat__was_removed(uuid, uuid)',
    'chat__v1_tokens(text)',
    'chat__chain_refresh(uuid)',
    'chat__may_delete(public.chat_messages, uuid)',
    'chat__blank_deleted(integer)',
    'chat_op__reader(uuid)',
    'chat_op__channel(uuid)',
    'chat_op__guard(uuid)',
    'chat_has_cap(uuid, uuid, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'public.% must not be callable by clients.', fn;
    END IF;
  END LOOP;
  -- The ops: signed-in people and the service role, never anon.
  FOREACH fn IN ARRAY ARRAY[
    'chat_op_send(uuid, uuid, text, uuid)',
    'chat_op_send(uuid, text, uuid, uuid[], boolean, uuid, text)',
    'chat_op_edit(uuid, text)',
    'chat_op_edit(uuid, text, uuid[])',
    'chat_op_delete(uuid)',
    'chat_op_restore(uuid)',
    'chat_op_react(uuid, text, boolean)',
    'chat_op_react(uuid, text)',
    'chat_op_pin(uuid, boolean)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', fn);
    IF has_function_privilege('anon', 'public.' || fn, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', 'public.' || fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'Grants on public.% are not as intended: signed-in people, never anon.', fn;
    END IF;
  END LOOP;
  -- Typing: people only, never a key (the service role) or anon.
  REVOKE ALL ON FUNCTION public.chat_op_typing(uuid, uuid, boolean) FROM PUBLIC, anon, service_role;
  GRANT EXECUTE ON FUNCTION public.chat_op_typing(uuid, uuid, boolean) TO authenticated;
  -- The share guard and the limits are trigger functions: nobody calls them directly.
  REVOKE ALL ON FUNCTION public.share_chat_message_guard() FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON FUNCTION public.chat_send_limit() FROM PUBLIC, anon, authenticated, service_role;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.chat_messages'::regclass
                  AND tgname = 'chat_send_limit' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'The chat_send_limit trigger is not in place on chat_messages.';
  END IF;
  -- The app's post: the service role only (the connector), as before.
  REVOKE ALL ON FUNCTION public.chat_op_agent_post(uuid, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.chat_op_agent_post(uuid, uuid, text, uuid) TO service_role;
END;
$$;
