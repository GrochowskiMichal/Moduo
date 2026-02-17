import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const supabaseConfigError =
  !supabaseUrl || !publishableKey
    ? "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    : null;

export const createSupabaseClient = (accessToken: () => Promise<string | null>) =>
  createClient(supabaseUrl!, publishableKey!, { accessToken });
