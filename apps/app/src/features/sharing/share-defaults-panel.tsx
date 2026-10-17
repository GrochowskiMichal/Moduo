/** Workspace defaults for new notes, buckets, calendars, and contacts (PERM-2b). */

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";

import { supabaseClient } from "../../lib/runtime.web";

type Defaults = {
  notes: string;
  buckets: string;
  calendars: string;
  contacts: string;
};

const ROWS: { key: keyof Defaults; label: string; options: { id: string; label: string }[] }[] = [
  {
    key: "notes",
    label: "New notes",
    options: [
      { id: "private", label: "Private" },
      { id: "view", label: "Workspace can view" },
      { id: "edit", label: "Workspace can edit" },
      { id: "full", label: "Workspace full access" },
    ],
  },
  {
    key: "buckets",
    label: "New projects",
    options: [
      { id: "private", label: "Private" },
      { id: "view", label: "Workspace can view" },
      { id: "edit", label: "Workspace can edit" },
      { id: "full", label: "Workspace full access" },
    ],
  },
  {
    key: "calendars",
    label: "Calendars",
    options: [
      { id: "private", label: "Private" },
      { id: "freebusy", label: "Workspace sees busy" },
      { id: "view", label: "Workspace sees details" },
      { id: "edit", label: "Workspace can edit" },
    ],
  },
  {
    key: "contacts",
    label: "New contacts",
    options: [
      { id: "private", label: "Private" },
      { id: "view", label: "Workspace can view" },
      { id: "edit", label: "Workspace can edit" },
    ],
  },
];

export function ShareDefaultsPanel({ workspaceId }: { workspaceId: string }) {
  const [value, setValue] = useState<Defaults | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabaseClient
      .rpc("share_defaults_get", { p_workspace_id: workspaceId })
      .then(({ data }) => {
        if (data) setValue(data as Defaults);
      });
  }, [workspaceId]);

  if (!value) return <p className="text-sm text-muted-foreground">Loading defaults…</p>;

  const save = async () => {
    setBusy(true);
    const { error } = await supabaseClient.rpc("share_defaults_set", {
      p_workspace_id: workspaceId,
      p_notes: value.notes,
      p_buckets: value.buckets,
      p_calendars: value.calendars,
      p_contacts: value.contacts,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Defaults saved");
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-base">Defaults for new things</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          This fills in sharing when someone creates a note, project, calendar, or contact. They can
          still change that one thing afterwards.
        </p>
      </div>
      {ROWS.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-3 text-sm">
          <span>{row.label}</span>
          <Select
            value={value[row.key]}
            onValueChange={(v) => setValue({ ...value, [row.key]: v })}
          >
            <SelectTrigger size="sm" className="w-44" aria-label={row.label}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {row.options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
      <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
        Save defaults
      </Button>
    </div>
  );
}
