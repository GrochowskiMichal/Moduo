// Pre-fix shapes: every `@flag` line must be reported.
export async function listMine() {
  // @flag
  const { data } = await supabaseClient.auth.getUser();
  return data.user?.id ?? null;
}

export async function emailOf() {
  // @flag
  const user = await supabase.auth.getUser();
  return user.data.user?.email ?? null;
}
