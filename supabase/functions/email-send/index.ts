import { requireAccountOwner, requireUser } from "../_shared/auth.ts";
import { badRequest, ok, optionsResponse } from "../_shared/http.ts";
import { ensureSystemFolders } from "../_shared/providers.ts";

function ensureArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value : [];
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return badRequest("method_not_allowed", "Only POST is supported", 405);

  try {
    const body = await request.json();
    const { userId, supabaseAdmin } = await requireUser(request, body);

    const accountId = String(body?.accountId ?? "");
    const to = ensureArray(body?.to);
    const cc = ensureArray(body?.cc);
    const bcc = ensureArray(body?.bcc);
    const subject = String(body?.subject ?? "").trim();
    const bodyText = body?.bodyText ? String(body.bodyText) : null;
    const bodyHtml = body?.bodyHtml ? String(body.bodyHtml) : null;
    const replyThreadId = body?.replyThreadId ? String(body.replyThreadId) : null;

    if (!accountId || !subject || to.length === 0) {
      return badRequest("invalid_input", "accountId, subject and at least one recipient are required");
    }

    await requireAccountOwner(supabaseAdmin, accountId, userId);

    const outboxPayload = {
      account_id: accountId,
      payload: {
        to,
        cc,
        bcc,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
      },
      status: "sending",
      attempts: 1,
    };

    const { data: outbox, error: outboxError } = await supabaseAdmin
      .from("email_outbox")
      .insert(outboxPayload)
      .select("id")
      .single();

    if (outboxError || !outbox?.id) throw outboxError ?? new Error("Failed to enqueue email");

    const { data: account, error: accountError } = await supabaseAdmin
      .from("email_accounts")
      .select("id,email_address,display_name")
      .eq("id", accountId)
      .single();

    if (accountError || !account) throw accountError ?? new Error("Email account not found");

    const { sentId } = await ensureSystemFolders(supabaseAdmin, accountId);

    const now = new Date().toISOString();
    let threadId = replyThreadId;

    if (!threadId) {
      const { data: thread, error: threadError } = await supabaseAdmin
        .from("email_threads")
        .insert({
          account_id: accountId,
          folder_id: sentId,
          remote_id: `local:${crypto.randomUUID()}`,
          subject,
          snippet: bodyText?.slice(0, 180) ?? "",
          from_name: account.display_name,
          from_email: account.email_address,
          last_message_at: now,
          is_unread: false,
          message_count: 1,
        })
        .select("id")
        .single();

      if (threadError || !thread?.id) throw threadError ?? new Error("Failed to create thread");
      threadId = thread.id;
    } else {
      await supabaseAdmin
        .from("email_threads")
        .update({
          folder_id: sentId,
          subject,
          snippet: bodyText?.slice(0, 180) ?? "",
          last_message_at: now,
          is_unread: false,
          message_count: 1,
        })
        .eq("id", threadId);
    }

    const { data: message, error: messageError } = await supabaseAdmin
      .from("email_messages")
      .insert({
        thread_id: threadId,
        account_id: accountId,
        remote_id: `local:${crypto.randomUUID()}`,
        direction: "outbound",
        from_json: { email: account.email_address, name: account.display_name },
        to_json: to,
        cc_json: cc,
        bcc_json: bcc,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        sent_at: now,
        is_read: true,
      })
      .select("id")
      .single();

    if (messageError || !message?.id) throw messageError ?? new Error("Failed to store sent message");

    await supabaseAdmin.from("email_outbox").update({ status: "sent", last_error: null }).eq("id", outbox.id);

    await supabaseAdmin
      .from("email_accounts")
      .update({ status: "active", last_error: null, last_sync_at: now })
      .eq("id", accountId);

    return ok({ messageId: message.id as string, threadId: threadId as string });
  } catch (error) {
    return badRequest("send_failed", (error as Error).message, 401);
  }
});
