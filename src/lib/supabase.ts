import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const publishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_KEY;

export const supabaseConfigError =
  !supabaseUrl || !publishableKey
    ? "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    : null;

const secureStoreAuthStorage = {
  getItem: async (key: string) => {
    const value = await SecureStore.getItemAsync(key);
    return value ?? null;
  },
  setItem: async (key: string, value: string) => {
    await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string) => {
    await SecureStore.deleteItemAsync(key);
  },
};

/**
 * Singleton Supabase client.
 * Using a single instance avoids refresh-token races that occur when
 * multiple `createClient` instances compete for the same single-use
 * refresh token, which was the root cause of "Session expired" errors.
 */
export const supabase: SupabaseClient | null = supabaseConfigError
  ? null
  : createClient(supabaseUrl!, publishableKey!, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: Platform.OS === "web",
        ...(Platform.OS === "web" ? {} : { storage: secureStoreAuthStorage }),
      },
    });
