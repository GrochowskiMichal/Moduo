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
-- Wiped: the user's customers (tagged with metadata.supabase_user_id, or the
-- profile's stripe_customer_id unless Stripe tags it with someone else) and their
-- saved payment methods. Kept, for the legal period (designer's call): invoices,
-- charges, payment intents, checkout sessions and subscriptions.
-- Preview (the default, also for NULL) counts and changes nothing; only
-- p_preview => false wipes.

CREATE OR REPLACE FUNCTION public.account_scrub_stripe_mirror(
  p_user uuid,
  p_preview boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stored text;
  v_customers text[];
  v_methods text[];
BEGIN
  IF p_user IS NULL THEN
    RAISE EXCEPTION 'account_scrub_stripe_mirror: p_user is required';
  END IF;

  -- Projects without the Stripe sync have nothing to wipe.
  IF to_regclass('stripe.customers') IS NULL OR to_regclass('stripe.payment_methods') IS NULL THEN
    RETURN jsonb_build_object('preview', p_preview IS NOT FALSE, 'stripe_mirror', false,
                              'customers_wiped', 0, 'payment_methods_wiped', 0);
  END IF;

  SELECT p.stripe_customer_id INTO v_stored FROM public.profiles p WHERE p.id = p_user;

  -- A wiped row has no metadata left, so a retry finds only the profile's id,
  -- and wiping it again changes nothing.
  SELECT coalesce(array_agg(c.id), '{}') INTO v_customers
  FROM stripe.customers c
  WHERE c._raw_data -> 'metadata' ->> 'supabase_user_id' = p_user::text
     OR (c.id = v_stored
         AND coalesce(c._raw_data -> 'metadata' ->> 'supabase_user_id', p_user::text) = p_user::text);

  SELECT coalesce(array_agg(pm.id), '{}') INTO v_methods
  FROM stripe.payment_methods pm
  WHERE pm.customer = ANY (v_customers);

  IF p_preview IS NOT FALSE THEN
    RETURN jsonb_build_object('preview', true, 'stripe_mirror', true,
                              'customers_wiped', cardinality(v_customers),
                              'payment_methods_wiped', cardinality(v_methods));
  END IF;

  UPDATE stripe.customers c
  SET _raw_data = jsonb_build_object('id', c.id, 'object', 'customer', 'deleted', true),
      _last_synced_at = now()
  WHERE c.id = ANY (v_customers);

  UPDATE stripe.payment_methods pm
  SET _raw_data = jsonb_build_object('id', pm.id, 'object', 'payment_method',
                                     'type', pm._raw_data ->> 'type'),
      _last_synced_at = now()
  WHERE pm.id = ANY (v_methods);

  RETURN jsonb_build_object('preview', false, 'stripe_mirror', true,
                            'customers_wiped', cardinality(v_customers),
                            'payment_methods_wiped', cardinality(v_methods));
END;
$$;

REVOKE ALL ON FUNCTION public.account_scrub_stripe_mirror(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_scrub_stripe_mirror(uuid, boolean) TO service_role;
