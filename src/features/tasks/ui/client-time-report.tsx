// A client's work, in their hub (AC6.4; TV-D14 added the time report, TV-U16
// the rest): shown in a contact's hub when they are the client of a live
// project the reader can see (from the shared Tasks store, which only holds
// those). It rolls up those projects with their open work, what's next, what
// waits, and the time report over all of them.

import { Clock, FolderKanban } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "../../../components/ui/button";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { NavRowDot } from "../../../components/ui/nav-row";
import type { EntityRef } from "../../../lib/entity-links";
import { useStoreSnapshot, useWorkspaceStore } from "../../../lib/sync/react";
import { formatDay } from "../../../lib/time-format";
import { useTimeRegion } from "../../../lib/time-region";
import { useAuth } from "../../../providers/auth-provider";
import { clientRollup } from "../project-overview";
import { bucketDotColor } from "../sidebar";
import { TimeReportSheet } from "./time-report-sheet";

const ROW =
  "flex min-h-(--ctrl-h-sm) w-full items-center gap-2 rounded-md px-2 text-left font-sans text-sm text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent";

export function ClientTimeReport({
  workspaceId,
  contactId,
  contactName,
  onOpen,
  chat,
}: {
  workspaceId: string;
  contactId: string;
  contactName: string;
  /** Opens a project or a task in Tasks. */
  onOpen?: (ref: EntityRef) => void;
  /** Chat's slots for the client's conversation and decisions (CH11, CH13);
   *  empty until Chat fills them. */
  chat?: { conversation?: ReactNode; decisions?: ReactNode };
}) {
  const { runtime, userId } = useAuth();
  const store = useWorkspaceStore(runtime, userId, workspaceId);
  const snapshot = useStoreSnapshot(store);
  // Dates read with the person's Time & region (gotchas/ui.md).
  useTimeRegion();
  const [open, setOpen] = useState(false);
  const { buckets, tasks } = snapshot.bundle;
  const rollup = useMemo(
    () => clientRollup(buckets, tasks, snapshot.waiting, contactId),
    [buckets, tasks, snapshot.waiting, contactId],
  );
  if (rollup.projects.length === 0) return null;
  return (
    <section className="space-y-1.5">
      <Eyebrow as="h3">Work</Eyebrow>
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-1 py-1.5">
        <ul className="flex flex-col">
          {rollup.projects.map(({ project, open: count }) => (
            <li key={project.id}>
              <button
                type="button"
                className={ROW}
                disabled={!onOpen}
                onClick={() => onOpen?.({ type: "project", id: project.id })}
              >
                <NavRowDot color={bucketDotColor(project)} />
                <span className="min-w-0 flex-1 break-words">{project.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {count} open
                </span>
              </button>
            </li>
          ))}
        </ul>
        {rollup.next.length > 0 ? (
          <div className="flex flex-col">
            <p className="px-2 font-sans text-xs text-muted-foreground">Next up</p>
            <ul className="flex flex-col">
              {rollup.next.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className={ROW}
                    disabled={!onOpen}
                    onClick={() => onOpen?.({ type: "task", id: t.id })}
                  >
                    <span className="min-w-0 flex-1 break-words">{t.title || "Untitled"}</span>
                    {t.dueOn || t.dueDate ? (
                      <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                        {formatDay(t.dueOn ? `${t.dueOn}T12:00:00` : (t.dueDate as string))}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {/* Chat's slots: the client's conversation, then their decisions. */}
        {chat?.conversation ?? null}
        {chat?.decisions ?? null}
        {rollup.waiting.length > 0 ? (
          <div className="flex flex-col">
            <p className="px-2 font-sans text-xs text-muted-foreground">
              Waiting · {rollup.waiting.length}
            </p>
            <ul className="flex flex-col">
              {rollup.waiting.slice(0, 5).map((w) => (
                <li key={w.task.id}>
                  <button
                    type="button"
                    className={ROW}
                    disabled={!onOpen}
                    onClick={() => onOpen?.({ type: "task", id: w.task.id })}
                  >
                    <span className="min-w-0 flex-1 break-words">{w.task.title || "Untitled"}</span>
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      since {formatDay(w.since)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-0.5">
          <p className="flex min-w-0 items-center gap-1.5 font-sans text-sm text-muted-foreground tabular-nums">
            <FolderKanban className="size-icon-sm shrink-0" aria-hidden />
            {rollup.open === 1 ? "1 open task" : `${rollup.open} open tasks`}
          </p>
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Clock aria-hidden />
            Time report
          </Button>
        </div>
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
