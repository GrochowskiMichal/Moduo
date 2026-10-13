// The time report from a client's hub (TV-D14, spec §14, REPLAN 75): shown in
// a contact's hub when they are the client of a project the reader can see
// (from the shared Tasks store, which only holds those). The report covers
// all of that client's projects.

import { Clock } from "lucide-react";
import { useState } from "react";

import { Button } from "../../../components/ui/button";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { useStoreSnapshot, useWorkspaceStore } from "../../../lib/sync/react";
import { useAuth } from "../../../providers/auth-provider";
import { TimeReportSheet } from "./time-report-sheet";

export function ClientTimeReport({
  workspaceId,
  contactId,
  contactName,
}: {
  workspaceId: string;
  contactId: string;
  contactName: string;
}) {
  const { runtime, userId } = useAuth();
  const store = useWorkspaceStore(runtime, userId, workspaceId);
  const snapshot = useStoreSnapshot(store);
  const [open, setOpen] = useState(false);
  const projects = snapshot.bundle.buckets.filter(
    (b) => b.clientContactId === contactId && !b.isSystem && !b.deletedAt,
  );
  if (projects.length === 0) return null;
  const names = projects.map((p) => p.name);
  const summary =
    names.length <= 2
      ? names.join(" and ")
      : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return (
    <section className="space-y-1.5">
      <Eyebrow as="h3">Time</Eyebrow>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2">
        <p className="min-w-0 break-words font-sans text-sm text-muted-foreground">
          Tracked time on {summary}
        </p>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          <Clock aria-hidden />
          Time report
        </Button>
      </div>
      <TimeReportSheet
        open={open}
        onOpenChange={setOpen}
        workspaceId={workspaceId}
        scope={{ kind: "client", clientContactId: contactId, name: contactName }}
      />
    </section>
  );
}
