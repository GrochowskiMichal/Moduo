-- MR-7 (specs/mail-rebuild.md decision 16): mail settings that follow the user.
-- One owner-scoped row per rule, custom tab, Priority person, blocked sender,
-- Screener decision, sender override, snippet, alias or saved search, so two
-- devices editing different items never overwrite each other (the whole-object
-- LWW of user_preferences.email lost edits). Conflicts resolve per row: the
-- last write to reach the server wins.
--
-- Access: owner-only. Clients read their rows through RLS (SELECT only) and
-- write through the two definer ops; no client INSERT/UPDATE/DELETE grant.
-- Erasure: user_id references profiles ON DELETE CASCADE, the same chain
-- user_preferences rides (auth.users -> profiles), so delete-account's
-- deleteUser removes every row.
-- Ids are client-minted. A sender override's id is md5(user || ':sender_override:'
-- || lower(address))::uuid, so the backfill below and every device agree.
-- Re-runnable on the local stack.

CREATE TABLE IF NOT EXISTS public.email_settings_items (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  position double precision NOT NULL DEFAULT 0,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

ALTER TABLE public.email_settings_items DROP CONSTRAINT IF EXISTS email_settings_items_kind_check;
ALTER TABLE public.email_settings_items ADD CONSTRAINT email_settings_items_kind_check
  CHECK (kind IN ('rule','custom_tab','priority_person','blocked_sender','screener_decision','sender_override','snippet','alias','saved_search'));
ALTER TABLE public.email_settings_items DROP CONSTRAINT IF EXISTS email_settings_items_value_object;
ALTER TABLE public.email_settings_items ADD CONSTRAINT email_settings_items_value_object
  CHECK (jsonb_typeof(value) = 'object' AND pg_column_size(value) <= 65536);

CREATE INDEX IF NOT EXISTS email_settings_items_user_idx
  ON public.email_settings_items (user_id, updated_at);

ALTER TABLE public.email_settings_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS email_settings_items_select_own ON public.email_settings_items;
CREATE POLICY email_settings_items_select_own ON public.email_settings_items
  FOR SELECT TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.email_settings_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_settings_items TO authenticated;
GRANT ALL ON public.email_settings_items TO service_role;

-- Upsert one item. Refuses a signed-out caller, an id another person owns
-- (answered as not found), and a kind change on an existing id. Brings a
-- deleted row back. Caps live rows at 2000 per person.
CREATE OR REPLACE FUNCTION public.email_op_settings_upsert(
  p_id uuid,
  p_kind text,
  p_value jsonb,
  p_position double precision
) RETURNS public.email_settings_items
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.email_settings_items;
  v_row public.email_settings_items;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'A settings item needs an id' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.email_settings_items WHERE id = p_id FOR UPDATE;
  IF v_existing.id IS NOT NULL THEN
    IF v_existing.user_id <> v_uid THEN
      RAISE EXCEPTION 'Settings item not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_existing.kind <> p_kind THEN
      RAISE EXCEPTION 'A settings item keeps its kind' USING ERRCODE = '22023';
    END IF;
    UPDATE public.email_settings_items
       SET value = coalesce(p_value, '{}'::jsonb),
           position = coalesce(p_position, v_existing.position),
           updated_at = clock_timestamp(),
           deleted_at = NULL
     WHERE id = p_id
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;
  IF (SELECT count(*) FROM public.email_settings_items
       WHERE user_id = v_uid AND deleted_at IS NULL) >= 2000 THEN
    RAISE EXCEPTION 'Too many mail settings items' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.email_settings_items (id, user_id, kind, position, value)
  VALUES (p_id, v_uid, p_kind, coalesce(p_position, 0), coalesce(p_value, '{}'::jsonb))
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

-- Soft-delete one of your items (a tombstone, so other devices see it go).
-- Someone else's id or a missing one is a no-op returning false.
CREATE OR REPLACE FUNCTION public.email_op_settings_delete(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  UPDATE public.email_settings_items
     SET deleted_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE id = p_id AND user_id = v_uid AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.email_op_settings_upsert(uuid, text, jsonb, double precision) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_op_settings_upsert(uuid, text, jsonb, double precision) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.email_op_settings_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_op_settings_delete(uuid) TO authenticated, service_role;

-- The overrides migration: user_preferences.email.senderOverrides (address ->
-- section) becomes one sender_override row each. The old field stays for
-- builds that still read it; new writes go to rows only.
CREATE OR REPLACE FUNCTION public.email_settings__backfill_overrides()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_n integer;
BEGIN
  INSERT INTO public.email_settings_items (id, user_id, kind, position, value)
  SELECT md5(p.user_id::text || ':sender_override:' || lower(btrim(o.key)))::uuid,
         p.user_id,
         'sender_override',
         0,
         jsonb_build_object('address', lower(btrim(o.key)), 'section', o.value #>> '{}')
    FROM public.user_preferences p
   CROSS JOIN LATERAL jsonb_each(
     CASE WHEN jsonb_typeof(p.email -> 'senderOverrides') = 'object'
          THEN p.email -> 'senderOverrides' ELSE '{}'::jsonb END) AS o
   WHERE jsonb_typeof(o.value) = 'string'
     AND btrim(o.key) <> ''
     AND EXISTS (SELECT 1 FROM public.profiles pr WHERE pr.id = p.user_id)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.email_settings__backfill_overrides() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_settings__backfill_overrides() TO service_role;

SELECT public.email_settings__backfill_overrides();
