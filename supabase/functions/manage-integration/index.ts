import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

// manage-integration: upsert or delete an encrypted OAuth token for a user.
// Authentication: validated via X-Moduo-Secret header (shared secret == TOKEN_ENCRYPTION_SECRET).
// Called from the Tauri desktop app's Rust integrations command.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SECRET_KEY = getDefaultSecretKey();
const MODUO_SHARED_SECRET = Deno.env.get("MODUO_TOKEN_ENCRYPTION_SECRET") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

Deno.serve(async (req: Request) => {
  // Validate shared secret
  const incomingSecret = req.headers.get("X-Moduo-Secret") ?? "";
  if (!MODUO_SHARED_SECRET || incomingSecret !== MODUO_SHARED_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    if (req.method === "POST") {
      const body = await req.json() as {
        user_id: string;
        provider: string;
        access_token_enc: string;
        refresh_token_enc?: string | null;
        token_expiry?: string | null;
        updated_at?: string;
      };

      const { error } = await supabase
        .from("user_integrations")
        .upsert(
          {
            user_id: body.user_id,
            provider: body.provider,
            access_token_enc: body.access_token_enc,
            refresh_token_enc: body.refresh_token_enc ?? null,
            token_expiry: body.token_expiry ?? null,
            updated_at: body.updated_at ?? new Date().toISOString(),
          },
          { onConflict: "user_id,provider" }
        );

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (req.method === "DELETE") {
      const url = new URL(req.url);
      const provider = url.searchParams.get("provider");
      const userId = url.searchParams.get("user_id");

      if (!provider || !userId) {
        return new Response(JSON.stringify({ error: "missing provider or user_id" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { error } = await supabase
        .from("user_integrations")
        .delete()
        .eq("user_id", userId)
        .eq("provider", provider);

      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
