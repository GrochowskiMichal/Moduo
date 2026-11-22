import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { googleUserEmail } from "../_shared/google-calendar.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";
import { handleManageIntegration, type IntegrationsDb } from "./handler.ts";

// Deployed with verify_jwt=false; the handler verifies the person's JWT itself
// and takes the user from it (MOD-554). See handler.ts.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ENC = Deno.env.get("MODUO_TOKEN_ENCRYPTION_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, getDefaultSecretKey(), {
  auth: { persistSession: false },
});

const db: IntegrationsDb = {
  findId: (userId, provider, accountKey) =>
    supabase
      .from("user_integrations")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", provider)
      .eq("account_key", accountKey)
      .limit(1)
      .maybeSingle(),
  insert: (row) => supabase.from("user_integrations").insert(row),
  update: (id, row) => supabase.from("user_integrations").update(row).eq("id", id),
  remove: (userId, provider) =>
    supabase.from("user_integrations").delete().eq("user_id", userId).eq("provider", provider),
};

Deno.serve(async (req: Request) => {
  try {
    return await handleManageIntegration(req, {
      auth: supabase.auth,
      db,
      encryptionSecret: ENC,
      googleEmail: googleUserEmail,
    });
  } catch (err) {
    // The message only: never the request, which carries tokens.
    console.error("[manage-integration] failed:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "internal" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
