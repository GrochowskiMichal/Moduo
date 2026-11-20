// Fixed shapes: nothing here may be reported.
export async function getPrefs(userId: string) {
  const { data, error } = await supabase.from("user_preferences").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data ? { kind: "row", prefs: data } : { kind: "none" };
}

export async function readPrefs() {
  return await runRpc(supabase.rpc("user_prefs"));
}

export async function markRead(id: string) {
  await runQuery(supabase.from("notifications").update({ read: true }).eq("id", id));
}

export async function listShared() {
  const { data, error } = await supabase.rpc("list_shared");
  // An RPC that isn't deployed yet is a deliberate, named fallback.
  if (error?.code === "PGRST202") return [];
  if (error) throw error;
  return data;
}

export async function rename(id: string) {
  const { error: renameError } = await supabase.from("rows").update({ name: "x" }).eq("id", id);
  if (renameError) throw renameError;
}
