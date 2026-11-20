// Fixed shapes: nothing here may be reported.
export async function listRecent(workspaceId: string) {
  return await runQuery(supabase.from("tasks").select("*").eq("workspace_id", workspaceId).limit(1000));
}

export async function listTagLinks(workspaceId: string) {
  return await selectCapped({
    scope: "links",
    cap: 5000,
    build: () => supabase.from("entity_links").select("*").eq("workspace_id", workspaceId),
    order: (q) => q.order("created_at").order("id"),
  });
}

export function firstFew(items: string[]) {
  return items.slice(0, 50).filter(Boolean);
}
