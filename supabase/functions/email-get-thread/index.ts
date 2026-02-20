import { requireUser } from "../_shared/auth.ts";
import { badRequest, ok, optionsResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return badRequest("method_not_allowed", "Only POST is supported", 405);

  try {
    const body = await request.json();
    const { userId, supabaseAdmin } = await requireUser(request, body);
    const threadId = String(body?.threadId ?? "");
    if (!threadId) return badRequest("invalid_input", "threadId is required");

    const { data: thread, error: threadError } = await supabaseAdmin
      .from("email_threads")
      .select("id,account_id,folder_id,remote_id,subject,snippet,from_name,from_email,last_message_at,is_unread,message_count,created_at,updated_at,email_accounts!inner(id,user_id)")
      .eq("id", threadId)
      .eq("email_accounts.user_id", userId)
      .single();

    if (threadError || !thread) throw threadError ?? new Error("Thread not found");

    const { data: messages, error: messagesError } = await supabaseAdmin
      .from("email_messages")
      .select("id,thread_id,account_id,remote_id,direction,from_json,to_json,cc_json,bcc_json,subject,body_text,body_html,sent_at,is_read,created_at,updated_at")
      .eq("thread_id", threadId)
      .order("sent_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });

    if (messagesError) throw messagesError;

    const mappedMessages = ((messages ?? []) as any[]).map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      accountId: row.account_id,
      remoteId: row.remote_id,
      direction: row.direction,
      from: row.from_json ?? null,
      to: Array.isArray(row.to_json) ? row.to_json : [],
      cc: Array.isArray(row.cc_json) ? row.cc_json : [],
      bcc: Array.isArray(row.bcc_json) ? row.bcc_json : [],
      subject: row.subject,
      bodyText: row.body_text,
      bodyHtml: row.body_html,
      sentAt: row.sent_at,
      isRead: !!row.is_read,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const mappedThread = {
      id: (thread as any).id,
      accountId: (thread as any).account_id,
      folderId: (thread as any).folder_id,
      remoteId: (thread as any).remote_id,
      subject: (thread as any).subject,
      snippet: (thread as any).snippet,
      fromName: (thread as any).from_name,
      fromEmail: (thread as any).from_email,
      lastMessageAt: (thread as any).last_message_at,
      isUnread: !!(thread as any).is_unread,
      messageCount: Number((thread as any).message_count ?? 0),
      createdAt: (thread as any).created_at,
      updatedAt: (thread as any).updated_at,
    };

    return ok({ thread: mappedThread, messages: mappedMessages });
  } catch (error) {
    return badRequest("get_thread_failed", (error as Error).message, 401);
  }
});
