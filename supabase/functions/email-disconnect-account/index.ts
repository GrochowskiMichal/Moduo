import { requireAccountOwner, requireUser } from "../_shared/auth.ts";
import { badRequest, ok, optionsResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return badRequest("method_not_allowed", "Only POST is supported", 405);

  try {
    const body = await request.json();
    const { userId, supabaseAdmin } = await requireUser(request, body);
    const accountId = String(body?.accountId ?? "");
    if (!accountId) return badRequest("invalid_input", "accountId is required");

    await requireAccountOwner(supabaseAdmin, accountId, userId);

    const { error: accountError } = await supabaseAdmin
      .from("email_accounts")
      .update({ status: "disabled", last_error: null })
      .eq("id", accountId);

    if (accountError) throw accountError;

    const { error: secretsError } = await supabaseAdmin
      .from("email_account_secrets")
      .upsert(
        {
          account_id: accountId,
          oauth_access_token_enc: null,
          oauth_refresh_token_enc: null,
          oauth_expires_at: null,
          smtp_password_enc: null,
          imap_password_enc: null,
          pop3_password_enc: null,
        },
        { onConflict: "account_id" }
      );

    if (secretsError) throw secretsError;

    return ok({ accountId, status: "disabled" });
  } catch (error) {
    return badRequest("disconnect_failed", (error as Error).message, 401);
  }
});
