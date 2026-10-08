// Upload problems → the calm copy and the one way forward (specs/attachments.md
// "Upload errors — mirrors, not walls"; AT2-4). Facts with numbers, never red,
// never a blocking dialog. Pure: the strip renders what `describeProblem` says.

import { isNetworkError } from "@/features/notes/sync/meta-outbox";

/** An attachments op refusal: AT-1 raises machine codes (`attachment_too_large`,
 *  `storage_full`, …) with the numbers as JSON in the error's DETAIL. */
export class AttachmentOpError extends Error {
  readonly code: string;
  readonly detail: Record<string, unknown> | null;
  readonly status: number | null;
  constructor(code: string, detail: Record<string, unknown> | null = null, status?: number) {
    super(code);
    this.name = "AttachmentOpError";
    this.code = code;
    this.detail = detail;
    this.status = status ?? null;
  }
}

/** Parse a PostgREST error's `details` (AT-1 puts JSON there). */
export function parseOpDetail(details: unknown): Record<string, unknown> | null {
  if (typeof details !== "string" || !details.trim().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(details) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export type UploadProblem =
  /** Over the plan's per-file limit (checked before any bytes move). */
  | { kind: "too_large"; sizeBytes: number; perFileBytes: number; tier: string }
  /** The owner's pool can't take it. Waits and retries by itself. */
  | { kind: "storage_full"; usedBytes: number; totalBytes: number; tier: string }
  /** No connection right now. Retries by itself when back online. */
  | { kind: "offline" }
  /** The connection dropped mid-way. Retries with backoff; Retry runs it now. */
  | { kind: "interrupted" }
  /** The server stored something other than what was sent. Retry starts over. */
  | { kind: "mismatch" }
  /** Can't add files to this task (view-only, or it's gone). */
  | { kind: "no_access" }
  | { kind: "task_gone" }
  /** Too many unfinished uploads for this person; waits a little. */
  | { kind: "busy" }
  /** Anything else the server refused. */
  | { kind: "failed" };

export type ProblemAction = "retry" | "upgrade" | "free_space" | "dismiss";

const num = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : Number.NaN;
  return Number.isFinite(n) ? n : 0;
};

/**
 * What a failure means for the queue entry, split the same way the notes
 * meta-outbox splits a replay: network trouble waits, a refusal never retries
 * on its own (poison), a full pool waits for space.
 */
export function classifyUploadError(
  error: unknown,
  online = typeof navigator === "undefined" ? true : navigator.onLine,
): UploadProblem {
  if (error instanceof AttachmentOpError) {
    const d = error.detail ?? {};
    switch (error.code) {
      case "attachment_too_large":
        return {
          kind: "too_large",
          sizeBytes: num(d.size_bytes),
          perFileBytes: num(d.per_file_bytes),
          tier: typeof d.tier === "string" ? d.tier : "free",
        };
      case "storage_full":
        return {
          kind: "storage_full",
          usedBytes: num(d.used_bytes) + num(d.pending_bytes),
          totalBytes: num(d.total_bytes),
          tier: typeof d.tier === "string" ? d.tier : "free",
        };
      case "too_many_pending":
        return { kind: "busy" };
      case "no_edit_access":
        return { kind: "no_access" };
      case "entity_not_found":
      case "unsupported_entity":
        return { kind: "task_gone" };
      case "not_signed_in":
        return { kind: "offline" };
      case "upload_mismatch":
        return { kind: "mismatch" };
      case "upload_server":
        // Storage hiccup (5xx): same as a dropped connection.
        return { kind: "interrupted" };
      default:
        return { kind: "failed" };
    }
  }
  if (!online) return { kind: "offline" };
  if (isNetworkError(error)) return { kind: "interrupted" };
  return { kind: "failed" };
}

/** True when the queue should keep the file and try again by itself. */
export function problemRetriesItself(problem: UploadProblem): boolean {
  return (
    problem.kind === "offline" ||
    problem.kind === "interrupted" ||
    problem.kind === "storage_full" ||
    problem.kind === "busy"
  );
}

// ── numbers ───────────────────────────────────────────────────────────────────

const MiB = 1048576;
const GiB = 1073741824;

/** "340 MB", "1.2 GB", "820 KB". Binary units, labelled like the plan table
 *  (the server's "20 MB" is 20 × 1048576 bytes). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes >= GiB) return `${trim(bytes / GiB)} GB`;
  if (bytes >= MiB) return `${trim(bytes / MiB)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function trim(n: number): string {
  if (n >= 100) return String(Math.round(n));
  return String(Math.round(n * 10) / 10);
}

/** "47.6 of 50 GB": both numbers in the total's unit. */
export function formatUsage(usedBytes: number, totalBytes: number, sep = " of "): string {
  const unit = totalBytes >= GiB ? GiB : MiB;
  const label = unit === GiB ? "GB" : "MB";
  return `${trim(usedBytes / unit)}${sep}${trim(totalBytes / unit)} ${label}`;
}

// ── plans (mirrors storage__limits_for_owner + attachments__platform_file_cap in
// 20261008210500_attachments_storage.sql; change both together) ───────────────

/** The hosted project's global upload cap: every plan's per-file limit is held
 *  under it until the org moves to Supabase Pro (AT-1 decision). */
export const PLATFORM_FILE_CAP_BYTES = 50 * MiB;
const PLAN_PER_FILE_BYTES: Record<string, number> = {
  free: 20 * MiB,
  pro: 200 * MiB,
  duo: 200 * MiB,
  team: 500 * MiB,
  founder: 500 * MiB,
};

/** Would a higher plan take this file? Only then is Upgrade worth offering. */
export function upgradeAllowsFile(sizeBytes: number, tier: string): boolean {
  const current = Math.min(
    PLAN_PER_FILE_BYTES[tier] ?? PLAN_PER_FILE_BYTES.free,
    PLATFORM_FILE_CAP_BYTES,
  );
  const best = Math.min(PLAN_PER_FILE_BYTES.team, PLATFORM_FILE_CAP_BYTES);
  return best > current && sizeBytes <= best;
}

// ── copy ──────────────────────────────────────────────────────────────────────

export type ProblemCopy = { text: string; actions: ProblemAction[] };

/**
 * The caption and actions for one file's problem. Only the workspace owner is
 * offered Upgrade (it's their plan); everyone can Retry what can be retried.
 */
export function describeProblem(
  problem: UploadProblem,
  ctx: { fileName: string; isOwner: boolean },
): ProblemCopy {
  switch (problem.kind) {
    case "too_large":
      return {
        text: `${ctx.fileName} is ${formatBytes(problem.sizeBytes)} — your plan allows ${formatBytes(problem.perFileBytes)} per file`,
        actions: [
          ...(ctx.isOwner && upgradeAllowsFile(problem.sizeBytes, problem.tier)
            ? (["upgrade"] as const)
            : []),
          "dismiss",
        ],
      };
    case "storage_full":
      return {
        text: `Not attached — storage is full (${formatUsage(problem.usedBytes, problem.totalBytes, " / ")})`,
        actions: [
          "free_space",
          ...(ctx.isOwner && problem.tier !== "founder" ? (["upgrade"] as const) : []),
          "dismiss",
        ],
      };
    case "offline":
      return {
        text: "Not attached yet — offline. It attaches when you're back",
        actions: ["dismiss"],
      };
    case "interrupted":
      return { text: "Upload interrupted — trying again", actions: ["retry", "dismiss"] };
    case "busy":
      return { text: "Waiting for your other uploads to finish", actions: ["dismiss"] };
    case "mismatch":
      return {
        text: "Not attached — the upload didn't arrive whole",
        actions: ["retry", "dismiss"],
      };
    case "no_access":
      return {
        text: "Not attached — you can view this task but not add files",
        actions: ["dismiss"],
      };
    case "task_gone":
      return { text: "Not attached — the task was deleted", actions: ["dismiss"] };
    case "failed":
      return { text: "Not attached — the upload failed", actions: ["retry", "dismiss"] };
  }
}

/**
 * Several files from one drop over the per-file limit: one line, not a tile
 * each ("A multi-file drop attaches what fits and lists the rest in one line").
 */
export function describeTooLarge(
  files: { fileName: string; sizeBytes: number }[],
  ctx: { perFileBytes: number; tier: string; isOwner: boolean },
): ProblemCopy {
  if (files.length === 1) {
    const [f] = files;
    return describeProblem(
      { kind: "too_large", sizeBytes: f.sizeBytes, perFileBytes: ctx.perFileBytes, tier: ctx.tier },
      { fileName: f.fileName, isOwner: ctx.isOwner },
    );
  }
  const list = files.map((f) => `${f.fileName} (${formatBytes(f.sizeBytes)})`).join(", ");
  const upgrade = ctx.isOwner && files.some((f) => upgradeAllowsFile(f.sizeBytes, ctx.tier));
  return {
    text: `Not attached, over ${formatBytes(ctx.perFileBytes)} per file: ${list}`,
    actions: [...(upgrade ? (["upgrade"] as const) : []), "dismiss"],
  };
}

/** The 95% caption uploaders see under the strip (no popup). */
export function almostFullCaption(usedBytes: number, totalBytes: number): string {
  return `Storage almost full — ${formatUsage(usedBytes, totalBytes)}`;
}

export const ACTION_LABELS: Record<ProblemAction, string> = {
  retry: "Retry",
  upgrade: "Upgrade",
  free_space: "Free up space",
  dismiss: "Dismiss",
};
