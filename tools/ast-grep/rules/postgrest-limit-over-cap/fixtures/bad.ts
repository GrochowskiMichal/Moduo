// Pre-fix shapes: every `@flag` line must be reported.
export async function listTagLinks(workspaceId: string) {
  // @flag
  const { data, error } = await supabase.from("entity_links").select("*").eq("workspace_id", workspaceId).limit(5000);
  if (error) throw error;
  return data;
}

export async function listAll() {
  // @flag
  return await runQuery(supabase.from("tasks").select("id").limit(1001));
}
