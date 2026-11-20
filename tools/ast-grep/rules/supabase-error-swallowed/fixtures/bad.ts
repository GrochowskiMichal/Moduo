// Pre-fix shapes: every `@flag` line must be reported.
export async function getPrefs(userId: string) {
  // @flag
  const { data } = await supabase.from("user_preferences").select("*").eq("user_id", userId).maybeSingle();
  return data ?? null;
}

export async function readPrefs() {
  const { data, error } = await supabase.rpc("user_prefs");
  // @flag
  if (error) return null;
  return data;
}

export async function listRows() {
  const { data, error } = await supabase.from("rows").select("*");
  // @flag
  if (error || !data) {
    return [];
  }
  return data;
}

export async function markRead(id: string) {
  // @flag
  await supabase.from("notifications").update({ read: true }).eq("id", id);
}
