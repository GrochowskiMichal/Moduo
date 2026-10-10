import { describe, expect, it } from "@rstest/core";
import {
  AttachmentOpError,
  almostFullCaption,
  classifyUploadError,
  describeProblem,
  describeTooLarge,
  formatBytes,
  formatUsage,
  parseOpDetail,
  problemRetriesItself,
  upgradeAllowsFile,
} from "./errors";

const MB = 1048576;
const GB = 1073741824;

describe("classifyUploadError", () => {
  it("reads AT-1's refusals with their numbers", () => {
    const tooLarge = new AttachmentOpError(
      "attachment_too_large",
      parseOpDetail('{"size_bytes": 356515840, "per_file_bytes": 209715200, "tier": "pro"}'),
    );
    expect(classifyUploadError(tooLarge)).toEqual({
      kind: "too_large",
      sizeBytes: 356515840,
      perFileBytes: 209715200,
      tier: "pro",
    });
    const full = new AttachmentOpError("storage_full", {
      size_bytes: 10,
      used_bytes: 50 * GB - 100,
      pending_bytes: 100,
      total_bytes: 50 * GB,
      tier: "pro",
    });
    expect(classifyUploadError(full)).toEqual({
      kind: "storage_full",
      usedBytes: 50 * GB,
      totalBytes: 50 * GB,
      tier: "pro",
    });
    expect(classifyUploadError(new AttachmentOpError("no_edit_access")).kind).toBe("no_access");
    expect(classifyUploadError(new AttachmentOpError("entity_not_found")).kind).toBe("task_gone");
    expect(classifyUploadError(new AttachmentOpError("too_many_pending")).kind).toBe("busy");
    expect(classifyUploadError(new AttachmentOpError("upload_server", null, 503)).kind).toBe(
      "interrupted",
    );
  });

  it("splits network trouble from refusals (offline vs interrupted vs failed)", () => {
    expect(classifyUploadError(new TypeError("Failed to fetch"), true).kind).toBe("interrupted");
    expect(classifyUploadError(new TypeError("Failed to fetch"), false).kind).toBe("offline");
    expect(classifyUploadError(new Error("boom"), true).kind).toBe("failed");
  });

  it("knows which problems retry by themselves", () => {
    expect(problemRetriesItself({ kind: "offline" })).toBe(true);
    expect(problemRetriesItself({ kind: "interrupted" })).toBe(true);
    expect(problemRetriesItself({ kind: "busy" })).toBe(true);
    expect(
      problemRetriesItself({ kind: "storage_full", usedBytes: 1, totalBytes: 1, tier: "free" }),
    ).toBe(true);
    expect(problemRetriesItself({ kind: "failed" })).toBe(false);
    expect(problemRetriesItself({ kind: "mismatch" })).toBe(false);
  });

  it("ignores details that aren't JSON", () => {
    expect(parseOpDetail("nope")).toBeNull();
    expect(parseOpDetail(null)).toBeNull();
    expect(parseOpDetail("{bad")).toBeNull();
  });
});

describe("numbers", () => {
  it("formats sizes like the plan table", () => {
    expect(formatBytes(340 * MB)).toBe("340 MB");
    expect(formatBytes(20 * MB)).toBe("20 MB");
    expect(formatBytes(1.24 * GB)).toBe("1.2 GB");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatUsage(47.6 * GB, 50 * GB)).toBe("47.6 of 50 GB");
    expect(formatUsage(50 * GB, 50 * GB, " / ")).toBe("50 / 50 GB");
  });

  it("offers Upgrade only when a higher plan would take the file", () => {
    // Every paid plan is held at 50 MB for now (AT-1's platform cap).
    expect(upgradeAllowsFile(30 * MB, "free")).toBe(true);
    expect(upgradeAllowsFile(340 * MB, "free")).toBe(false);
    expect(upgradeAllowsFile(60 * MB, "pro")).toBe(false);
  });
});

describe("describeProblem — each state's message and action (owner vs member)", () => {
  const ctx = { fileName: "recording.mov", isOwner: true };

  it("too big", () => {
    const p = {
      kind: "too_large" as const,
      sizeBytes: 30 * MB,
      perFileBytes: 20 * MB,
      tier: "free",
    };
    expect(describeProblem(p, ctx)).toEqual({
      text: "recording.mov is 30 MB — your plan allows 20 MB per file",
      actions: ["upgrade", "dismiss"],
    });
    expect(describeProblem(p, { ...ctx, isOwner: false }).actions).toEqual(["dismiss"]);
  });

  it("full", () => {
    const p = {
      kind: "storage_full" as const,
      usedBytes: 50 * GB,
      totalBytes: 50 * GB,
      tier: "pro",
    };
    expect(describeProblem(p, ctx)).toEqual({
      text: "Not attached — storage is full (50 / 50 GB)",
      actions: ["free_space", "upgrade", "dismiss"],
    });
    expect(describeProblem(p, { ...ctx, isOwner: false }).actions).toEqual([
      "free_space",
      "dismiss",
    ]);
  });

  it("failed, offline, interrupted", () => {
    expect(describeProblem({ kind: "failed" }, ctx)).toEqual({
      text: "Not attached — the upload failed",
      actions: ["retry", "dismiss"],
    });
    expect(describeProblem({ kind: "offline" }, ctx).text).toMatch(/offline/);
    expect(describeProblem({ kind: "interrupted" }, ctx).actions).toContain("retry");
  });

  it("almost full", () => {
    expect(almostFullCaption(47.6 * GB, 50 * GB)).toBe("Storage almost full — 47.6 of 50 GB");
  });

  it("lists several too-big files from one drop in one line", () => {
    const copy = describeTooLarge(
      [
        { fileName: "a.mov", sizeBytes: 340 * MB },
        { fileName: "b.zip", sizeBytes: 30 * MB },
      ],
      { perFileBytes: 20 * MB, tier: "free", isOwner: true },
    );
    expect(copy.text).toBe("Not attached, over 20 MB per file: a.mov (340 MB), b.zip (30 MB)");
    expect(copy.actions).toEqual(["upgrade", "dismiss"]);
  });
});
