import { requireAccountOwner, requireUser } from "../_shared/auth.ts";
import { badRequest, ok, optionsResponse } from "../_shared/http.ts";
import { syncProvider } from "../_shared/providers.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return badRequest("method_not_allowed", "Only POST is supported", 405);

  try {
    const body = await request.json();
    const { userId, supabaseAdmin } = await requireUser(request, body);
    const accountId = String(body?.accountId ?? "");
    if (!accountId) return badRequest("invalid_input", "accountId is required");

    await requireAccountOwner(supabaseAdmin, accountId, userId);

    const { data: account, error: accountError } = await supabaseAdmin
      .from("email_accounts")
      .select("id,provider,email_address,display_name")
      .eq("id", accountId)
      .single();

    if (accountError || !account) throw accountError ?? new Error("Account missing");

    await syncProvider(supabaseAdmin, account as any);

    const syncedAt = new Date().toISOString();
    const { error: updateError } = await supabaseAdmin
      .from("email_accounts")
      .update({ status: "active", last_sync_at: syncedAt, last_error: null })
      .eq("id", accountId);
    if (updateError) throw updateError;

    await supabaseAdmin.from("email_sync_state").upsert(
      {
        account_id: accountId,
        history_id: `h_${Date.now()}`,
        delta_token: crypto.randomUUID(),
        updated_at: syncedAt,
      },
      { onConflict: "account_id" }
    );

    return ok({ accountId, syncedAt });
  } catch (error) {
    return badRequest("sync_failed", (error as Error).message, 401);
  }
});
