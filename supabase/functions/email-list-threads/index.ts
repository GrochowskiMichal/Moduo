import { requireAccountOwner, requireUser } from "../_shared/auth.ts";
import { badRequest, ok, optionsResponse } from "../_shared/http.ts";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") return badRequest("method_not_allowed", "Only POST is supported", 405);

  try {
    const body = await request.json();
    const { userId, supabaseAdmin } = await requireUser(request, body);
    const accountId = String(body?.accountId ?? "");
    const folderId = body?.folderId ? String(body.folderId) : null;
    const search = body?.search ? String(body.search).trim() : null;
    const unreadOnly = !!body?.unreadOnly;
    const limit = Math.max(1, Math.min(100, Number(body?.limit ?? 30)));
    const offset = Math.max(0, Number(body?.cursor ?? 0));

    if (!accountId) return badRequest("invalid_input", "accountId is required");
    await requireAccountOwner(supabaseAdmin, accountId, userId);

    let query = supabaseAdmin
      .from("email_threads")
      .select("id,account_id,folder_id,remote_id,subject,snippet,from_name,from_email,last_message_at,is_unread,message_count,created_at,updated_at")
      .eq("account_id", accountId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (folderId) query = query.eq("folder_id", folderId);
    if (unreadOnly) query = query.eq("is_unread", true);
    if (search) query = query.or(`subject.ilike.%${search}%,snippet.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data ?? []) as any[];
    const threads = rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      folderId: row.folder_id,
      remoteId: row.remote_id,
      subject: row.subject,
      snippet: row.snippet,
      fromName: row.from_name,
      fromEmail: row.from_email,
      lastMessageAt: row.last_message_at,
      isUnread: !!row.is_unread,
      messageCount: Number(row.message_count ?? 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    const nextCursor = rows.length === limit ? String(offset + rows.length) : null;
    return ok({ threads, nextCursor });
  } catch (error) {
    const message = (error as Error).message ?? "list_threads_failed";
    const normalized = message.toLowerCase();
    const isAuthError = normalized.includes("missing bearer token") || normalized.includes("invalid token");
    const isAccessError =
      normalized.includes("workspace access denied") || normalized.includes("email account not found");
    const isValidationError =
      normalized.includes("accountid is required") ||
      normalized.includes("folderid is required") ||
      normalized.includes("invalid_input");
    const status = isAuthError ? 401 : isAccessError ? 403 : isValidationError ? 400 : 500;
    console.error("email-list-threads failed", {
      message,
      path: new URL(request.url).pathname,
      method: request.method,
      status,
    });
    return badRequest("list_threads_failed", message, status);
  }
});
