-- PRIV-2b · Wipe our copy of a deleted account's Stripe customer.
-- Spec: specs/privacy-account-erasure.md (block 2, AC7). Called by delete-account
-- (step stripe_mirror, right after the Stripe customer is deleted) as the service
-- role, BEFORE auth.admin.deleteUser.
--
-- The Stripe Sync Engine (1.0.32 on production) mirrors customers and payment
-- methods into stripe.*, with every typed column GENERATED from _raw_data. Deleting
-- the customer at Stripe doesn't remove our copy: the customer.deleted webhook
-- writes the full snapshot again. The engine only writes a row when the event is
-- newer: `… WHERE "_last_synced_at" IS NULL OR "_last_synced_at" < $ts`, with
-- event.created as $ts. So the wipe replaces _raw_data with a stub and stamps
-- _last_synced_at = now(): the webhooks the deletion caused are older and change
-- nothing.
--
-- Wiped:
--   * the user's customers in our copy: tagged with metadata.supabase_user_id, the
--     profile's stripe_customer_id, or one the Stripe step just deleted
--     (p_customer_ids), unless our copy tags it with someone else;
--   * a customer the Stripe step deleted that our copy doesn't have yet gets the
--     stub as a new row, so the deletion's late webhook can't insert it in full;
--   * their saved cards, also ones detached earlier (no customer left on them),
--     found through the user's payment intents, setup intents and subscriptions.
-- Kept, for the legal period (designer's call): invoices, charges, payment intents,
-- checkout sessions and subscriptions.
-- Preview (the default, also for NULL) counts and changes nothing; only
-- p_preview => false wipes.

CREATE OR REPLACE FUNCTION public.account_scrub_stripe_mirror(
  p_user uuid,
  p_preview boolean DEFAULT true,
  p_customer_ids text[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids text[] := coalesce(p_customer_ids, '{}');
  v_stored text;
  v_account text;
  v_customers text[] := '{}';
  v_unmirrored text[] := '{}';
  v_new text[] := '{}';
  v_all text[];
  v_refs text[] := '{}';
  v_more text[];
  v_methods text[] := '{}';
  v_has_methods boolean := to_regclass('stripe.payment_methods') IS NOT NULL;
  v_ref record;
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'account_scrub_stripe_mirror: p_user is required';
  END IF;

  -- Projects without the Stripe sync have nothing to wipe; the caller warns.
  IF to_regclass('stripe.customers') IS NULL THEN
    RETURN jsonb_build_object('preview', p_preview IS NOT FALSE, 'stripe_mirror', false,
                              'customers_wiped', 0, 'customers_added_as_deleted', 0,
                              'payment_methods_wiped', 0);
  END IF;

  SELECT p.stripe_customer_id INTO v_stored FROM public.profiles p WHERE p.id = p_user;

  -- A wiped row has no metadata left, so a retry finds it through the profile or
  -- the ids, and wiping it again changes nothing.
  SELECT coalesce(array_agg(c.id), '{}') INTO v_customers
  FROM stripe.customers c
  WHERE c._raw_data -> 'metadata' ->> 'supabase_user_id' = p_user::text
     OR ((c.id = v_stored OR c.id = ANY (v_ids))
         AND coalesce(c._raw_data -> 'metadata' ->> 'supabase_user_id', p_user::text) = p_user::text);

  -- Deleted at Stripe, not in our copy yet. The row needs the account it belongs to,
  -- which is unambiguous only when the copy holds one Stripe account.
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_unmirrored
  FROM unnest(v_ids) AS x
  WHERE x IS NOT NULL AND NOT EXISTS (SELECT 1 FROM stripe.customers c WHERE c.id = x);
  v_new := v_unmirrored;
  IF cardinality(v_new) > 0 THEN
    IF to_regclass('stripe.accounts') IS NOT NULL AND (SELECT count(*) FROM stripe.accounts) = 1 THEN
      SELECT a.id INTO v_account FROM stripe.accounts a;
    ELSE
      v_new := '{}';
    END IF;
  END IF;

  IF v_has_methods THEN
    -- Never a customer our copy tags with someone else.
    v_all := v_customers || v_unmirrored;
    -- Cards detached earlier keep no customer in our copy; what the user paid or
    -- subscribed with still points at them.
    FOR v_ref IN
      SELECT t.tbl, t.col FROM (VALUES ('payment_intents', 'payment_method'),
                                       ('setup_intents', 'payment_method'),
                                       ('subscriptions', 'default_payment_method')) AS t(tbl, col)
      WHERE EXISTS (SELECT 1 FROM information_schema.columns ic
                    WHERE ic.table_schema = 'stripe' AND ic.table_name = t.tbl AND ic.column_name = t.col)
        AND EXISTS (SELECT 1 FROM information_schema.columns ic
                    WHERE ic.table_schema = 'stripe' AND ic.table_name = t.tbl AND ic.column_name = 'customer')
    LOOP
      EXECUTE format('SELECT coalesce(array_agg(DISTINCT x.%1$I), ''{}'') FROM stripe.%2$I x
                      WHERE x.customer = ANY ($1) AND x.%1$I IS NOT NULL', v_ref.col, v_ref.tbl)
        INTO v_more USING v_all;
      v_refs := v_refs || v_more;
    END LOOP;

    SELECT coalesce(array_agg(pm.id), '{}') INTO v_methods
    FROM stripe.payment_methods pm
    WHERE pm.customer = ANY (v_all) OR pm.id = ANY (v_refs);
  END IF;

  IF p_preview IS NOT FALSE THEN
    RETURN jsonb_build_object('preview', true, 'stripe_mirror', true,
                              'customers_wiped', cardinality(v_customers),
                              'customers_added_as_deleted', cardinality(v_new),
                              'payment_methods_wiped', cardinality(v_methods));
  END IF;

  UPDATE stripe.customers c
  SET _raw_data = jsonb_build_object('id', c.id, 'object', 'customer', 'deleted', true),
      _last_synced_at = now()
  WHERE c.id = ANY (v_customers);

  INSERT INTO stripe.customers (_raw_data, _last_synced_at, _account_id)
  SELECT jsonb_build_object('id', x, 'object', 'customer', 'deleted', true), now(), v_account
  FROM unnest(v_new) AS x
  ON CONFLICT (id) DO NOTHING;

  IF v_has_methods THEN
    UPDATE stripe.payment_methods pm
    SET _raw_data = jsonb_build_object('id', pm.id, 'object', 'payment_method',
                                       'type', pm._raw_data ->> 'type'),
        _last_synced_at = now()
    WHERE pm.id = ANY (v_methods);
  END IF;

  RETURN jsonb_build_object('preview', false, 'stripe_mirror', true,
                            'customers_wiped', cardinality(v_customers),
                            'customers_added_as_deleted', cardinality(v_new),
                            'payment_methods_wiped', cardinality(v_methods));
END;
$$;

REVOKE ALL ON FUNCTION public.account_scrub_stripe_mirror(uuid, boolean, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_scrub_stripe_mirror(uuid, boolean, text[]) TO service_role;
