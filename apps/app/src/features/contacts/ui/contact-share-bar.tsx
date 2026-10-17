import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { supabaseClient } from "../../../lib/runtime.web";
import { useWorkspace } from "../../workspaces/workspace-context";

type Candidate = { keepId: string; dropId: string; name: string; email: string };

/** Merge banner for a contact someone shared that matches one of yours, plus a group name field. */
export function ContactShareBar({ selectedContactId }: { selectedContactId: string | null }) {
  const { selectedWorkspaceId } = useWorkspace();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [groupName, setGroupName] = useState("");

  useEffect(() => {
    let cancelled = false;
    void supabaseClient.rpc("contact_merge_candidates").then(({ data, error }) => {
      if (cancelled || error || !Array.isArray(data)) return;
      setCandidates(data as Candidate[]);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!selectedWorkspaceId) return null;

  const createGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    const { data, error } = await supabaseClient.rpc("contact_group_create", {
      p_workspace_id: selectedWorkspaceId,
      p_name: name,
    });
    if (error || !data) return;
    setGroupName("");
    if (selectedContactId) {
      await supabaseClient.rpc("contact_group_add", {
        p_group_id: data,
        p_contact_id: selectedContactId,
      });
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {candidates.map((row) => (
        <div
          key={row.dropId}
          className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
        >
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            Merge {row.name || row.email} with the shared contact?
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              void supabaseClient
                .rpc("contact_merge", { p_keep_id: row.keepId, p_drop_id: row.dropId })
                .then(({ error }) => {
                  if (!error)
                    setCandidates((list) => list.filter((item) => item.dropId !== row.dropId));
                })
            }
          >
            Merge
          </Button>
        </div>
      ))}
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void createGroup();
        }}
      >
        <Input
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          placeholder="New contact group"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="ghost" size="sm" disabled={!groupName.trim()}>
          Add
        </Button>
      </form>
    </div>
  );
}
