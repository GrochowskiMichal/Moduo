// The attachments on one entity, plus the uploads heading there (AT-2): the
// ready files from the server, this device's pending uploads for the same
// target, signed preview links, and the add / delete (with Undo) actions.

import { ATTACHMENT_LINK_TTL_SECONDS } from "@contracts/attachments";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import type { AttachmentRecord, ModuoRuntime, StorageStatus } from "@/lib/runtime.types";
import { undoToast } from "@/lib/undo-toast";
import { getUploadQueue } from "@/lib/uploads";
import { targetKey, type UploadTarget, type UploadView } from "@/lib/uploads/queue";
import { signPaths } from "../signed-urls";

/** Start the queue for the signed-in person and wake it when the network or
 *  the window comes back. Mounted once, in the signed-in app shell. */
export function useUploadQueueBoot(
  userId: string | null,
  runtime: Pick<ModuoRuntime, "attachments"> | null,
): void {
  const api = runtime?.attachments ?? null;
  useEffect(() => {
    const queue = getUploadQueue();
    if (!userId) {
      queue.stop();
      return;
    }
    void queue.start(userId, api);
    const wake = () => queue.wake();
    const onVisible = () => {
      if (document.visibilityState === "visible") queue.wake();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, api]);
}

const STATUS_TTL_MS = 60_000;
const statusCache = new Map<string, { at: number; value: StorageStatus }>();

async function cachedStatus(
  runtime: Pick<ModuoRuntime, "attachments">,
  workspaceId: string,
): Promise<StorageStatus | null> {
  const hit = statusCache.get(workspaceId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.value;
  try {
    const value = await runtime.attachments.status(workspaceId);
    statusCache.set(workspaceId, { at: Date.now(), value });
    return value;
  } catch {
    return null;
  }
}

function byCreated(a: AttachmentRecord, b: AttachmentRecord): number {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export type EntityAttachments = {
  records: AttachmentRecord[];
  /** Signed preview links by preview path. */
  previews: ReadonlyMap<string, string>;
  uploads: UploadView[];
  almostFull: { usedBytes: number; totalBytes: number } | null;
  /** The workspace owner sees Upgrade; everyone else sees the facts. */
  isOwner: boolean;
  loadState: "loading" | "ready" | "error";
  addFiles: (files: File[]) => void;
  remove: (rec: AttachmentRecord) => void;
  retry: (id: string) => void;
  dismiss: (id: string) => void;
  dismissAlmostFull: () => void;
  reload: () => void;
};

export function useEntityAttachments({
  runtime,
  workspaceId,
  entity,
  userId,
  canEdit,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  entity: { type: "task"; id: string };
  userId: string | null;
  canEdit: boolean;
}): EntityAttachments {
  const queue = getUploadQueue();
  const snap = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const target = useMemo<UploadTarget | null>(
    () => (workspaceId ? { workspaceId, entityType: entity.type, entityId: entity.id } : null),
    [workspaceId, entity.type, entity.id],
  );
  const key = target ? targetKey(target) : null;
  const uploads = useMemo(
    () => (key ? snap.items.filter((i) => targetKey(i.target) === key) : []),
    [snap.items, key],
  );
  const almostFull = key ? (snap.almostFull[key] ?? null) : null;

  const [records, setRecords] = useState<AttachmentRecord[]>([]);
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(new Map());
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const reqRef = useRef(0);

  const signPreviews = useCallback(
    async (recs: AttachmentRecord[]) => {
      if (!runtime) return;
      const paths = recs.map((r) => r.previewPath).filter((p): p is string => !!p);
      if (paths.length === 0) return;
      try {
        const signed = await signPaths(runtime, paths, ATTACHMENT_LINK_TTL_SECONDS.preview);
        setPreviews((prev) => new Map([...prev, ...signed]));
      } catch {
        // No thumbnail: the tile shows the file type instead.
      }
    },
    [runtime],
  );

  const reload = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    const req = ++reqRef.current;
    try {
      const recs = await runtime.attachments.listForEntity({
        workspaceId,
        entityType: entity.type,
        entityId: entity.id,
      });
      if (req !== reqRef.current) return;
      setRecords(recs);
      setLoadState("ready");
      void signPreviews(recs);
    } catch {
      if (req === reqRef.current) setLoadState("error");
    }
  }, [runtime, workspaceId, entity.type, entity.id, signPreviews]);

  useEffect(() => {
    void reload();
    return () => {
      // A late answer for the previous entity must not land here.
      reqRef.current += 1;
    };
  }, [reload]);

  useEffect(
    () =>
      queue.onUploaded((rec, t) => {
        if (targetKey(t) !== key) return;
        setRecords((prev) =>
          prev.some((r) => r.id === rec.id) ? prev : [...prev, rec].sort(byCreated),
        );
        void signPreviews([rec]);
      }),
    [queue, key, signPreviews],
  );

  useEffect(() => {
    if (!runtime || !workspaceId || !canEdit) return;
    let live = true;
    void cachedStatus(runtime, workspaceId).then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, [runtime, workspaceId, canEdit]);

  const addFiles = useCallback(
    (files: File[]) => {
      if (!target || !userId || !canEdit || files.length === 0) return;
      void queue.add(files, target, userId);
    },
    [queue, target, userId, canEdit],
  );

  const remove = useCallback(
    (rec: AttachmentRecord) => {
      if (!runtime) return;
      setRecords((prev) => prev.filter((r) => r.id !== rec.id));
      void (async () => {
        try {
          await runtime.attachments.remove(rec.id);
        } catch {
          toast.error("Couldn't delete the file.");
          void reload();
          return;
        }
        undoToast("File deleted", {
          description: rec.fileName,
          onUndo: () => {
            void runtime.attachments
              .restore(rec.id)
              .then((restored) => {
                setRecords((prev) =>
                  prev.some((r) => r.id === restored.id)
                    ? prev
                    : [...prev, restored].sort(byCreated),
                );
                void signPreviews([restored]);
              })
              .catch(() => toast.error("Couldn't restore the file."));
          },
        });
      })();
    },
    [runtime, reload, signPreviews],
  );

  const dismissAlmostFull = useCallback(() => {
    if (target) queue.dismissAlmostFull(target);
  }, [queue, target]);

  return {
    records,
    previews,
    uploads,
    almostFull,
    isOwner: status?.isOwner ?? false,
    loadState,
    addFiles,
    remove,
    retry: (id) => queue.retry(id),
    dismiss: (id) => queue.dismiss(id),
    dismissAlmostFull,
    reload: () => void reload(),
  };
}
