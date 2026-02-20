import { requireUser, requireWorkspaceMember } from "../_shared/auth.ts";
import { badRequest, ok, optionsResponse } from "../_shared/http.ts";
import { encryptSecret, isHostAllowed, validatePort } from "../_shared/security.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return badRequest("method_not_allowed", "Only POST is supported", 405);

  try {
    const body = await request.json();
    const { userId, supabaseAdmin } = await requireUser(request, body);

    const workspaceId = String(body?.workspaceId ?? "");
    const emailAddress = String(body?.emailAddress ?? "").trim().toLowerCase();
    const displayName = body?.displayName ? String(body.displayName).trim() : null;
    const authMode = String(body?.authMode ?? "smtp_imap") as "smtp_imap" | "smtp_pop3";

    const smtpHost = String(body?.smtpHost ?? "").trim().toLowerCase();
    const smtpPort = Number(body?.smtpPort ?? 0);
    const smtpUsername = String(body?.smtpUsername ?? "").trim();
    const smtpPassword = String(body?.smtpPassword ?? "");

    const imapHost = String(body?.imapHost ?? "").trim().toLowerCase();
    const imapPort = Number(body?.imapPort ?? 0);
    const imapUsername = String(body?.imapUsername ?? "").trim();
    const imapPassword = String(body?.imapPassword ?? "");

    const pop3Host = String(body?.pop3Host ?? "").trim().toLowerCase();
    const pop3Port = Number(body?.pop3Port ?? 0);
    const pop3Username = String(body?.pop3Username ?? "").trim();
    const pop3Password = String(body?.pop3Password ?? "");

    if (!workspaceId || !emailAddress || !smtpHost || !smtpUsername || !smtpPassword) {
      return badRequest("invalid_input", "workspaceId, emailAddress and SMTP credentials are required");
    }

    await requireWorkspaceMember(supabaseAdmin, workspaceId, userId);

    if (!isHostAllowed(smtpHost) || !validatePort(smtpPort)) {
      return badRequest("smtp_invalid", "SMTP host/port is invalid or not allowed");
    }

    if (authMode === "smtp_imap") {
      if (!imapHost || !imapUsername || !imapPassword || !validatePort(imapPort) || !isHostAllowed(imapHost)) {
        return badRequest("imap_invalid", "IMAP host/port/credentials are invalid or not allowed");
      }
    }

    if (authMode === "smtp_pop3") {
      if (!pop3Host || !pop3Username || !pop3Password || !validatePort(pop3Port) || !isHostAllowed(pop3Host)) {
        return badRequest("pop3_invalid", "POP3 host/port/credentials are invalid or not allowed");
      }
    }

    const { data: account, error: accountError } = await supabaseAdmin
      .from("email_accounts")
      .upsert(
        {
          user_id: userId,
          workspace_id: workspaceId,
          provider: "custom",
          auth_mode: authMode,
          email_address: emailAddress,
          display_name: displayName,
          status: "active",
          last_error: null,
          smtp_host: smtpHost,
          smtp_port: smtpPort,
          smtp_secure: smtpPort === 465,
          smtp_username: smtpUsername,
          imap_host: authMode === "smtp_imap" ? imapHost : null,
          imap_port: authMode === "smtp_imap" ? imapPort : null,
          imap_secure: authMode === "smtp_imap" ? imapPort === 993 : null,
          imap_username: authMode === "smtp_imap" ? imapUsername : null,
          pop3_host: authMode === "smtp_pop3" ? pop3Host : null,
          pop3_port: authMode === "smtp_pop3" ? pop3Port : null,
          pop3_secure: authMode === "smtp_pop3" ? pop3Port === 995 : null,
          pop3_username: authMode === "smtp_pop3" ? pop3Username : null,
        },
        { onConflict: "user_id,workspace_id,email_address" }
      )
      .select("id,user_id,workspace_id,provider,auth_mode,email_address,display_name,status,last_sync_at,last_error,created_at,updated_at")
      .single();

    if (accountError || !account?.id) throw accountError ?? new Error("Failed to save custom account");

    const { error: secretsError } = await supabaseAdmin.from("email_account_secrets").upsert(
      {
        account_id: account.id,
        smtp_password_enc: await encryptSecret(smtpPassword),
        imap_password_enc: authMode === "smtp_imap" ? await encryptSecret(imapPassword) : null,
        pop3_password_enc: authMode === "smtp_pop3" ? await encryptSecret(pop3Password) : null,
      },
      { onConflict: "account_id" }
    );

    if (secretsError) throw secretsError;

    return ok({
      account: {
        id: account.id,
        userId: account.user_id,
        workspaceId: account.workspace_id,
        provider: account.provider,
        authMode: account.auth_mode,
        emailAddress: account.email_address,
        displayName: account.display_name,
        status: account.status,
        lastSyncAt: account.last_sync_at,
        lastError: account.last_error,
        createdAt: account.created_at,
        updatedAt: account.updated_at,
      },
      verification: "credentials_saved_validation_deferred",
    });
  } catch (error) {
    return badRequest("custom_account_failed", (error as Error).message, 401);
  }
});
