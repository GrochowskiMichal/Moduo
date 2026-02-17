import { createClient } from "@supabase/supabase-js";
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

export const createSupabaseClient = () =>
  createClient(supabaseUrl!, publishableKey!, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === "web",
      ...(Platform.OS === "web" ? {} : { storage: secureStoreAuthStorage }),
    },
  });
