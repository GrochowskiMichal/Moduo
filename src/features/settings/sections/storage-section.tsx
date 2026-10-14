// Settings → Storage (AT-3, specs/attachments.md AT3-4): how full the owner's
// pool is, the largest files in this workspace, and the over-limit banner.
//
// Who sees what (decisions/tasks.md "AT-3"):
// - The pool meter is an aggregate across every workspace the owner has, so
//   only the owner and admins see it (no names, no counts).
// - The largest-files list comes from `attachments_largest`, which runs under
//   the reader's own access: a file shows only when its task does, and Delete
//   only when the reader may edit that task. No total counts files you can't
//   see.
// - The 80%/95% notices and the strip's "Free up space" open this section.

import { HardDrive, Trash2 } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { IconButton } from "../../../components/ui/icon-button";
import { Progress } from "../../../components/ui/progress";
import { getRuntime } from "../../../lib/runtime";
import type { LargestAttachment, ModuoRuntime, StorageStatus } from "../../../lib/runtime.types";
import { formatDate } from "../../../lib/time-format";
import { undoToast } from "../../../lib/undo-toast";
import { formatBytes, formatUsage } from "../../../lib/uploads/errors";
import { cn } from "../../../lib/utils";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { fileIconFor } from "../../attachments/files";
import type { WorkspaceMember, WorkspaceRole } from "../../workspaces/types";
import { dispatchOpenSettings } from "../settings-events";
import { SettingsSectionShell } from "./section-shell";

/** How many of the largest files the list shows. */
export const LARGEST_SHOWN = 50;
const GIB = 1073741824;

const TIER_NAMES: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  duo: "Duo",
  team: "Team",
  founder: "Founder",
};

/** The pool is the owner's, across every workspace they own: owner and admins only. */
export function seesPool(role: WorkspaceRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** "1.2 of 50 GB used", and how loud to say it (80% and up: emphasis, never red). */
export function meterLine(status: Pick<StorageStatus, "usedBytes" | "totalBytes">): {
  text: string;
  percent: number;
  emphasis: boolean;
} {
  const total = Math.max(status.totalBytes, 1);
  const percent = Math.floor((Math.max(status.usedBytes, 0) / total) * 100);
  const emphasis = percent >= 80;
  // Under a gigabyte, each side in its own unit ("9 MB of 2 GB"), so a little
  // use never reads as "0 of 2 GB".
  const amounts =
    status.usedBytes < GIB
      ? `${formatBytes(status.usedBytes)} of ${formatBytes(status.totalBytes)}`
      : formatUsage(status.usedBytes, status.totalBytes);
  return {
    text: `${amounts} used${emphasis ? ` · ${percent}%` : ""}`,
    percent,
    emphasis,
  };
}

/** The line under the meter: whose plan, the per-file limit, how far it reaches. */
export function poolCaption(
  status: Pick<StorageStatus, "tier" | "perFileBytes" | "isOwner" | "ownedWorkspaces">,
): string {
  const plan = `${TIER_NAMES[status.tier] ?? "Free"} plan`;
  const perFile = `${formatBytes(status.perFileBytes)} per file`;
  if (!status.isOwner) {
    return `The workspace owner's ${plan} · ${perFile} · shared across every workspace they own`;
  }
  const n = status.ownedWorkspaces ?? 1;
  const reach =
    n > 1 ? `shared across the ${n} workspaces you own` : "shared across the workspaces you own";
  return `Your ${plan} · ${perFile} · ${reach}`;
}

/** Who added a file, as the list says it. */
export function uploaderLabel(
  uploaderId: string | null,
  members: readonly Pick<WorkspaceMember, "userId" | "displayName">[],
  me: string | null,
): string {
  if (!uploaderId) return "Someone who left";
  if (uploaderId === me) return "You";
  return members.find((m) => m.userId === uploaderId)?.displayName?.trim() || "A member";
}

export function StorageSection() {
  const { userId } = useAuth();
  const { selectedWorkspace, selectedWorkspaceId, members } = useWorkspace();
  return (
    <StorageSectionView
      runtime={getRuntime()}
      workspaceId={selectedWorkspaceId ?? null}
      role={selectedWorkspace?.role ?? null}
      userId={userId ?? null}
      members={members}
    />
  );
}

type ViewProps = {
  runtime: Pick<ModuoRuntime, "attachments"> | null;
  workspaceId: string | null;
  role: WorkspaceRole | null;
  userId: string | null;
  members: readonly Pick<WorkspaceMember, "userId" | "displayName">[];
};

export function StorageSectionView({ runtime, workspaceId, role, userId, members }: ViewProps) {
  const pool = seesPool(role);
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [files, setFiles] = useState<LargestAttachment[] | null>(null);
  const [failed, setFailed] = useState(false);
  const req = useRef(0);

  const load = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    const mine = ++req.current;
    setFailed(false);
    const [statusRes, filesRes] = await Promise.allSettled([
      pool ? runtime.attachments.status(workspaceId) : Promise.resolve(null),
      runtime.attachments.largest(workspaceId, LARGEST_SHOWN),
    ]);
    // A workspace switch or a newer read meanwhile: this answer is stale.
    if (mine !== req.current) return;
    setStatus(statusRes.status === "fulfilled" ? statusRes.value : null);
    if (filesRes.status === "fulfilled") setFiles(filesRes.value);
    else setFailed(true);
  }, [runtime, workspaceId, pool]);

  useEffect(() => {
    setStatus(null);
    setFiles(null);
    void load();
    return () => {
      req.current += 1;
    };
  }, [load]);

  const remove = (file: LargestAttachment) => {
    if (!runtime) return;
    setFiles((prev) => prev?.filter((f) => f.id !== file.id) ?? prev);
    void (async () => {
      try {
        await runtime.attachments.remove(file.id);
      } catch {
        toast.error("Couldn't delete the file.");
        void load();
        return;
      }
      void load();
      undoToast("File deleted", {
        description: file.fileName,
        onUndo: () => {
          void runtime.attachments
            .restore(file.id)
            .then(() => load())
            .catch(() => toast.error("Couldn't restore the file."));
        },
      });
    })();
  };

  const meter = status ? meterLine(status) : null;

  return (
    <SettingsSectionShell
      title="Storage"
      description="Files on tasks in this workspace. Deleting one frees its space at once; it stays restorable for 30 days."
    >
      {pool ? (
        <Group eyebrow={<Eyebrow className="px-1">Space</Eyebrow>}>
          {status && meter ? (
            <div className="flex flex-col gap-2" data-slot="storage-meter">
              <p
                className={cn(
                  "text-sm tabular-nums",
                  meter.emphasis ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {meter.text}
              </p>
              <Progress value={status.usedBytes} max={status.totalBytes} label="Storage used" />
              <p className="text-xs text-muted-foreground">{poolCaption(status)}</p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {failed ? "Couldn't read how much is used." : "Reading how much is used…"}
            </p>
          )}
          {status?.overLimit ? (
            <div
              role="status"
              data-slot="storage-over-limit"
              className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted px-4 py-3"
            >
              <p className="min-w-0 flex-1 text-sm text-foreground">
                {status.isOwner
                  ? `Uploads are paused: ${formatUsage(status.usedBytes, status.totalBytes)} used. Nothing is deleted. Delete files below, or upgrade to add more.`
                  : "Uploads are paused until files are deleted or the owner upgrades. Nothing is deleted."}
              </p>
              {status.isOwner && status.tier !== "founder" ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => dispatchOpenSettings({ section: "billing" })}
                >
                  Upgrade
                </Button>
              ) : null}
            </div>
          ) : null}
        </Group>
      ) : null}

      <Group eyebrow={<Eyebrow className="px-1">Largest files</Eyebrow>}>
        {files === null ? (
          <p className="text-sm text-muted-foreground">
            {failed ? "Couldn't load the files." : "Loading files…"}
          </p>
        ) : files.length === 0 ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <HardDrive className="size-icon text-subtle-foreground" aria-hidden />
            No files on the tasks you can see yet.
          </div>
        ) : (
          <ul className="-mx-2 flex flex-col" aria-label="Largest files">
            {files.map((f) => {
              const Icon = fileIconFor(f.mime);
              const who = uploaderLabel(f.uploaderId, members, userId);
              const when = f.createdAt ? formatDate(f.createdAt) : null;
              return (
                <li
                  key={f.id}
                  data-slot="storage-file"
                  className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 hover:bg-state-hover"
                >
                  <Icon className="size-icon shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{f.fileName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[f.taskTitle.trim() || "Untitled task", who, when]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 font-sans text-xs tabular-nums text-muted-foreground">
                    {formatBytes(f.sizeBytes)}
                  </span>
                  {f.canDelete ? (
                    <IconButton
                      icon={Trash2}
                      label={`Delete ${f.fileName}`}
                      onClick={() => remove(f)}
                    />
                  ) : (
                    // Keeps the sizes lined up where Delete isn't offered.
                    <span className="size-(--ctrl-h-sm) shrink-0" aria-hidden />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {files !== null && files.length >= LARGEST_SHOWN ? (
          // The list is capped: say so, so a file that isn't here isn't missing.
          <p className="text-xs text-muted-foreground">
            Showing the {LARGEST_SHOWN} largest files.
          </p>
        ) : null}
      </Group>
    </SettingsSectionShell>
  );
}

/** A labelled cluster (eyebrow above a card), like the other settings sections. */
function Group({ eyebrow, children }: { eyebrow: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {eyebrow}
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card px-6 py-5">
        {children}
      </section>
    </div>
  );
}
