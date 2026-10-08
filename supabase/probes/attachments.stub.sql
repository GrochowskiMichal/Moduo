-- Stub of production for supabase/probes/attachments.probe.sql (AT-1).
-- Runs on top of the TV-D2 world (tasks-assignee.stub.sql, the TV-D1 and
-- TV-D2 migrations, tasks-queue.stub.sql and tasks-queue.seed.sql), which is
-- production's tasks schema as of 2026-10-08. This adds what
-- 20261008210500_attachments_storage.sql also touches, read from production's
-- catalog the same day (project wtoonrvuqumihpkbvwvs):
--   * profiles.plan_tier / stripe_subscription_id (plan_tier is the enum
--     plan_tier in production; text here, read through ::text either way);
--   * profile_plan_tier_text and workspace_seat_cap, the newest repo bodies
--     (20260512130000, 20261006121000), and the stripe.subscriptions columns
--     workspace_seat_cap reads;
--   * entities.updated_at;
--   * the storage schema: storage.buckets and storage.objects with the columns
--     the migration reads, RLS on, and the table grants Supabase gives
--     authenticated (its policies decide).

SET check_function_bodies = off;

ALTER TABLE public.profiles
  ADD COLUMN plan_tier text NOT NULL DEFAULT 'free',
  ADD COLUMN stripe_subscription_id text;
ALTER TABLE public.entities ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE SCHEMA stripe;
CREATE TABLE stripe.subscriptions (id text PRIMARY KEY, items jsonb);

CREATE FUNCTION public.profile_plan_tier_text(p_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(plan_tier::text, 'free')
  FROM public.profiles
  WHERE id = p_user_id
  LIMIT 1;
$$;

CREATE FUNCTION public.workspace_seat_cap(p_owner uuid) RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, stripe AS $$
  select case public.profile_plan_tier_text(p_owner)
    when 'founder' then 1000000
    when 'team' then coalesce(
      (select greatest((s.items->'data'->0->>'quantity')::int, 3)
         from public.profiles p join stripe.subscriptions s on s.id = p.stripe_subscription_id
        where p.id = p_owner), 3)
    when 'duo' then 2
    else 1
  end
$$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  type text NOT NULL DEFAULT 'STANDARD'
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  metadata jsonb,
  UNIQUE (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT ALL ON storage.objects, storage.buckets TO anon, authenticated, service_role;
