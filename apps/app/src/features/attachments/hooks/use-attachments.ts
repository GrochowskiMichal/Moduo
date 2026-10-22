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

import { thumbnailPath } from "../files";
import { clearSignedUrlCache, signPaths } from "../signed-urls";

/** Start the queue for the signed-in person and wake it when the network or
 *  the window comes back. Mounted once, in the signed-in app shell. */
export function useUploadQueueBoot(
  userId: string | null,
  runtime: Pick<ModuoRuntime, "attachments"> | null,
): void {
  const api = runtime?.attachments ?? null;
  // Links and pool facts belong to whoever was signed in: drop them on a switch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every account switch
  useEffect(() => {
    clearSignedUrlCache();
    statusCache.clear();
  }, [userId]);
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
      // Signing out unmounts the shell before it renders with no user, so the
      // stop has to happen here. A re-run (another account) starts again.
      queue.stop();
    };
  }, [userId, api]);
}

const STATUS_TTL_MS = 60_000;
/** How often an open strip checks its preview links. Only links within the
 *  cache's one-minute margin are signed again, so a check costs nothing else. */
const PREVIEW_CHECK_MS = 60_000;
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
  refreshStamp = null,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  entity: { type: "task"; id: string };
  userId: string | null;
  canEdit: boolean;
  /**
   * Moves whenever this entity's files change anywhere (AT-3: the shared
   * store's `attachmentStamps`, fed by Realtime and its delta reads): an open
   * strip reads its list again on it, so a teammate's upload or delete shows
   * without reopening.
   */
  refreshStamp?: string | null;
}): EntityAttachments {
  const queue = getUploadQueue();
  const snap = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  const target = useMemo<UploadTarget | null>(
    () => (workspaceId ? { workspaceId, entityType: entity.type, entityId: entity.id } : null),
    [workspaceId, entity.type, entity.id],
  );
  const key = target ? targetKey(target) : null;
  // Only this person's uploads: on a shared device another account's pending
  // files stay theirs (Retry wouldn't run them, Dismiss would delete them).
  const uploads = useMemo(
    () =>
      key && userId
        ? snap.items.filter((i) => i.userId === userId && targetKey(i.target) === key)
        : [],
    [snap.items, key, userId],
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
      // A small image has no preview: its original is signed as one, for the
      // preview's hour, since it shows no more than a preview would (MOD-132).
      const paths = recs.map(thumbnailPath).filter((p): p is string => !!p);
      if (paths.length === 0) return;
      try {
        const signed = await signPaths(runtime, paths, ATTACHMENT_LINK_TTL_SECONDS.preview);
        // The minute check mostly gets the same links back: keep the map then.
        setPreviews((prev) =>
          [...signed].some(([path, url]) => prev.get(path) !== url)
            ? new Map([...prev, ...signed])
            : prev,
        );
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

  // Another entity: never show (or act on) the previous one's files meanwhile.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the entity changes
  useEffect(() => {
    setRecords((prev) => (prev.length > 0 ? [] : prev));
    setLoadState("loading");
  }, [key]);

  useEffect(() => {
    void reload();
    return () => {
      // A late answer for the previous entity must not land here.
      reqRef.current += 1;
    };
  }, [reload]);

  // The entity's files changed elsewhere (a teammate, another window, an
  // agent): read the list again. A new entity reads already (above), so only
  // a stamp that moves while the same entity is open counts.
  const seenStamp = useRef<{ key: string | null; stamp: string | null }>({
    key,
    stamp: refreshStamp,
  });
  useEffect(() => {
    const seen = seenStamp.current;
    seenStamp.current = { key, stamp: refreshStamp };
    if (seen.key !== key || seen.stamp === refreshStamp) return;
    void reload();
  }, [key, refreshStamp, reload]);

  // Preview links last an hour and a panel can stay open longer: sign them
  // again as they near the end, and when the window comes back (a laptop that
  // slept past the hour). Unexpired links come from the cache.
  const recordsRef = useRef(records);
  recordsRef.current = records;
  useEffect(() => {
    const refresh = () => void signPreviews(recordsRef.current);
    const timer = setInterval(refresh, PREVIEW_CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [signPreviews]);

  useEffect(
    () =>
      queue.onUploaded((rec, t) => {
        if (targetKey(t) !== key) return;
        if (!rec) {
          // Finished in another window: read the list again.
          void reload();
          return;
        }
        setRecords((prev) =>
          prev.some((r) => r.id === rec.id) ? prev : [...prev, rec].sort(byCreated),
        );
        void signPreviews([rec]);
      }),
    [queue, key, signPreviews, reload],
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
