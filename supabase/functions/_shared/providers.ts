import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

type AccountRow = {
  id: string;
  provider: "gmail" | "outlook" | "apple" | "custom";
  email_address: string;
  display_name: string | null;
};

export async function ensureSystemFolders(
  supabase: SupabaseClient,
  accountId: string
): Promise<{ inboxId: string; sentId: string }> {
  const defaults = [
    { remote_id: "inbox", name: "Inbox", kind: "inbox" },
    { remote_id: "sent", name: "Sent", kind: "sent" },
    { remote_id: "drafts", name: "Drafts", kind: "drafts" },
    { remote_id: "trash", name: "Trash", kind: "trash" },
  ];

  await supabase
    .from("email_folders")
    .upsert(
      defaults.map((entry) => ({ account_id: accountId, ...entry })),
      { onConflict: "account_id,remote_id" }
    );

  const { data, error } = await supabase
    .from("email_folders")
    .select("id,kind")
    .eq("account_id", accountId)
    .in("kind", ["inbox", "sent"]);

  if (error) throw error;

  const inboxId = (data ?? []).find((row: any) => row.kind === "inbox")?.id;
  const sentId = (data ?? []).find((row: any) => row.kind === "sent")?.id;
  if (!inboxId || !sentId) throw new Error("Failed to initialize folders");
  return { inboxId, sentId };
}

export async function syncProvider(
  supabase: SupabaseClient,
  account: AccountRow
): Promise<void> {
  const { inboxId } = await ensureSystemFolders(supabase, account.id);

  const { data: existing, error: existingError } = await supabase
    .from("email_threads")
    .select("id")
    .eq("account_id", account.id)
    .limit(1);

  if (existingError) throw existingError;
  if ((existing ?? []).length > 0) return;

  const now = new Date().toISOString();
  const remoteId = `${account.provider}:welcome:${account.id}`;
  const { data: thread, error: threadError } = await supabase
    .from("email_threads")
    .insert({
      account_id: account.id,
      folder_id: inboxId,
      remote_id: remoteId,
      subject: `Welcome to Moduo Email (${account.provider})`,
      snippet: "Your mailbox is connected. Start composing from the right panel.",
      from_name: "Moduo",
      from_email: "no-reply@moduo.local",
      last_message_at: now,
      is_unread: true,
      message_count: 1,
    })
    .select("id")
    .single();

  if (threadError) throw threadError;

  const { error: messageError } = await supabase.from("email_messages").insert({
    thread_id: thread.id,
    account_id: account.id,
    remote_id: `${remoteId}:message`,
    direction: "inbound",
    from_json: { name: "Moduo", email: "no-reply@moduo.local" },
    to_json: [{ email: account.email_address, name: account.display_name }],
    subject: `Welcome to Moduo Email (${account.provider})`,
    body_text: "Connection succeeded. Use Sync now to refresh and Compose to send email.",
    sent_at: now,
    is_read: false,
  });

  if (messageError) throw messageError;
}
