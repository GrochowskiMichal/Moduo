// AT-3 · Settings → Storage (AT3-4): the pool meter (owners and admins only:
// it adds up files across every workspace the owner has), the largest files
// the reader can see with Delete where they may edit the task, and the
// over-limit banner.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { ENTITY_OPEN_EVENT } from "../../../lib/entity-open";
import type { LargestAttachment, StorageStatus } from "../../../lib/runtime.types";
import { SETTINGS_CLOSE_EVENT } from "../settings-events";
import {
  LARGEST_SHOWN,
  meterLine,
  poolCaption,
  seesPool,
  StorageSectionView,
  uploaderLabel,
} from "./storage-section";

afterEach(cleanup);

const GB = 1073741824;
const MB = 1048576;

function status(over: Partial<StorageStatus> = {}): StorageStatus {
  return {
    tier: "pro",
    perFileBytes: 50 * MB,
    totalBytes: 50 * GB,
    usedBytes: 1.2 * GB,
    pendingBytes: 0,
    level: 0,
    overLimit: false,
    isOwner: true,
    ownedWorkspaces: 2,
    ...over,
  };
}

function file(id: string, over: Partial<LargestAttachment> = {}): LargestAttachment {
  return {
    id,
    taskId: `t-${id}`,
    taskTitle: `Task ${id}`,
    fileName: `${id}.png`,
    mime: "image/png",
    sizeBytes: 3 * MB,
    uploaderId: "u-me",
    createdAt: "2026-10-13T10:00:00Z",
    canDelete: true,
    ...over,
  };
}

function fakeRuntime(opts: { status?: StorageStatus; files?: LargestAttachment[] } = {}) {
  let files = opts.files ?? [file("a")];
  const attachments = {
    status: rs.fn(async () => opts.status ?? status()),
    largest: rs.fn(async () => files),
    remove: rs.fn(async (id: string) => {
      files = files.filter((f) => f.id !== id);
      return {} as never;
    }),
    restore: rs.fn(async () => ({}) as never),
  };
  return { attachments } as unknown as { attachments: typeof attachments };
}

function renderView(
  runtime: ReturnType<typeof fakeRuntime>,
  role: "owner" | "admin" | "editor" | "viewer" = "owner",
) {
  render(
    <TooltipProvider>
      <StorageSectionView
        runtime={runtime as never}
        workspaceId="w1"
        role={role}
        userId="u-me"
        members={[
          { userId: "u-me", displayName: "Alex" },
          { userId: "u-sam", displayName: "Sam" },
        ]}
      />
    </TooltipProvider>,
  );
}

describe("the pool meter", () => {
  it("shows the owner how full the pool is, the plan, and how far it reaches", async () => {
    renderView(fakeRuntime());
    expect(await screen.findByText("1.2 of 50 GB used")).toBeTruthy();
    expect(
      screen.getByText("Your Pro plan · 50 MB per file · shared across the 2 workspaces you own"),
    ).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Storage used" })).toBeTruthy();
  });

  it("an admin sees it as the owner's plan", async () => {
    renderView(fakeRuntime({ status: status({ isOwner: false, ownedWorkspaces: null }) }), "admin");
    expect(await screen.findByText(/The workspace owner's Pro plan/)).toBeTruthy();
  });

  it("members never see the pool's total (it adds up files they may not see)", async () => {
    const rt = fakeRuntime();
    renderView(rt, "editor");
    expect(await screen.findByText("a.png")).toBeTruthy();
    expect(rt.attachments.status).not.toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(document.body.textContent).not.toMatch(/GB used/);
  });

  it("gains emphasis from 80%, never red", () => {
    expect(meterLine({ usedBytes: 42 * GB, totalBytes: 50 * GB })).toEqual({
      text: "42 of 50 GB used · 84%",
      percent: 84,
      emphasis: true,
    });
    expect(meterLine({ usedBytes: 1 * GB, totalBytes: 50 * GB }).emphasis).toBe(false);
    // A little use never reads as "0 of 2 GB".
    expect(meterLine({ usedBytes: 9 * MB, totalBytes: 2 * GB }).text).toBe("9 MB of 2 GB used");
  });

  it("over the limit, the owner sees why uploads paused and can upgrade", async () => {
    renderView(fakeRuntime({ status: status({ usedBytes: 52 * GB, overLimit: true }) }));
    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain(
      "Uploads are paused: 52 of 50 GB used. Nothing is deleted.",
    );
    expect(screen.getByRole("button", { name: "Upgrade" })).toBeTruthy();
  });
});

describe("the largest files", () => {
  it("lists name, task, who, size; Delete only where the reader may edit the task", async () => {
    renderView(
      fakeRuntime({
        files: [
          file("big", { sizeBytes: 40 * MB, uploaderId: "u-sam" }),
          file("mine", { sizeBytes: 2 * MB, canDelete: false }),
        ],
      }),
      "editor",
    );
    const rows = await screen.findAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("big.png"),
      expect.stringContaining("mine.png"),
    ]);
    expect(rows[0]?.textContent).toContain("Task big · Sam");
    expect(rows[0]?.textContent).toContain("40 MB");
    expect(rows[1]?.textContent).toContain("Task mine · You");
    expect(screen.getByRole("button", { name: "Delete big.png" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Delete mine.png" })).toBeNull();
  });

  it("a file's task name closes Settings and opens that task", async () => {
    renderView(fakeRuntime({ files: [file("big")] }), "editor");
    const opened: unknown[] = [];
    let closed = 0;
    const onOpen = (e: Event) => opened.push((e as CustomEvent).detail);
    const onClose = () => {
      closed += 1;
    };
    window.addEventListener(ENTITY_OPEN_EVENT, onOpen);
    window.addEventListener(SETTINGS_CLOSE_EVENT, onClose);
    fireEvent.click(await screen.findByRole("button", { name: "Task big" }));
    window.removeEventListener(ENTITY_OPEN_EVENT, onOpen);
    window.removeEventListener(SETTINGS_CLOSE_EVENT, onClose);
    expect(closed).toBe(1);
    expect(opened).toEqual([{ type: "task", id: "t-big" }]);
  });

  it("Delete moves the file to the trash and reads the list again", async () => {
    const rt = fakeRuntime({ files: [file("a"), file("b")] });
    renderView(rt);
    fireEvent.click(await screen.findByRole("button", { name: "Delete a.png" }));
    expect(screen.queryByText("a.png")).toBeNull();
    await waitFor(() => expect(rt.attachments.remove).toHaveBeenCalledWith("a"));
    await waitFor(() => expect(rt.attachments.largest).toHaveBeenCalledTimes(2));
    expect(screen.getByText("b.png")).toBeTruthy();
  });

  it("says so when there are none", async () => {
    renderView(fakeRuntime({ files: [] }), "editor");
    expect(await screen.findByText("No files on the tasks you can see yet.")).toBeTruthy();
  });

  it("says the list stops at the largest 50", async () => {
    const many = Array.from({ length: LARGEST_SHOWN }, (_, i) => file(`f${i}`));
    renderView(fakeRuntime({ files: many }), "editor");
    expect(await screen.findByText(`Showing the ${LARGEST_SHOWN} largest files.`)).toBeTruthy();
    cleanup();
    renderView(fakeRuntime({ files: [file("one")] }), "editor");
    await screen.findByText("one.png");
    expect(screen.queryByText(/largest files\./)).toBeNull();
  });
});

describe("the words", () => {
  it("who added a file", () => {
    const members = [{ userId: "u-sam", displayName: "Sam" }];
    expect(uploaderLabel("u-me", members, "u-me")).toBe("You");
    expect(uploaderLabel("u-sam", members, "u-me")).toBe("Sam");
    expect(uploaderLabel("u-gone", members, "u-me")).toBe("A member");
    expect(uploaderLabel(null, members, "u-me")).toBe("Someone who left");
  });

  it("whose plan, and who sees the pool", () => {
    expect(poolCaption(status({ ownedWorkspaces: 1 }))).toBe(
      "Your Pro plan · 50 MB per file · shared across the workspaces you own",
    );
    expect(seesPool("owner")).toBe(true);
    expect(seesPool("admin")).toBe(true);
    expect(seesPool("editor")).toBe(false);
    expect(seesPool("viewer")).toBe(false);
    expect(seesPool(null)).toBe(false);
  });
});
