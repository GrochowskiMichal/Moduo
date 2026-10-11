// DS-3 — the Tasks bucket rail on NavRow: aria-current, count ⇄ ⋯ on bucket
// rows only, drift as a mark outside the slot, remembered section collapse, and
// focus handed back to the rail when the delete confirm closes (it used to
// land on the page body: the dialog has no trigger to return to).
// TV-U6 (U6-1–4) — colour dots and the Colour menu, the hover "+" that
// captures into a bucket, Archive and the Archived section, the delete
// choice, Recently deleted, and sortable rows inside the page's DndContext.

import { DndContext } from "@dnd-kit/core";
import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import type { Bucket } from "../model";
import {
  asRailBucket,
  BucketRail,
  parseCollapsedSections,
  RAIL_BUCKET_PREFIX,
  TRASH_SELECTION,
} from "./bucket-rail";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

const NOW = "2026-10-01T00:00:00.000Z";
function bucket(id: string, name: string, extra: Partial<Bucket> = {}): Bucket {
  return {
    id,
    workspaceId: "w",
    ownerId: "u",
    name,
    isSystem: false,
    group: null,
    position: id,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  };
}

const INBOX = bucket("inbox-id", "Inbox", { isSystem: true });
const START = [
  bucket("mkt", "Marketing", { color: "teal" }),
  bucket("op", "OP"),
  bucket("acme", "Acme", { group: "Clients" }),
  bucket("globex", "Globex", { group: "Clients" }),
];

// Long enough for a menu/dialog to unmount and Radix's focus return.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 80)));
const main = (name: RegExp) => screen.getByRole("button", { name });

function renderRail({
  canEdit = true,
  selection: initialSelection = "mkt",
  drift = new Map<string, number>(),
  collapsed = new Set<string>(),
  myTasks = null,
  archived = [] as Bucket[],
  archivedOpen = false,
  trashCount = 0,
  dnd = false,
}: {
  canEdit?: boolean;
  selection?: string;
  drift?: Map<string, number>;
  collapsed?: Set<string>;
  myTasks?: number | null;
  archived?: Bucket[];
  archivedOpen?: boolean;
  trashCount?: number;
  /** Inside a DndContext, with sortable rows. */
  dnd?: boolean;
} = {}) {
  const onDeleteBucket = rs.fn();
  const onTriageBucket = rs.fn();
  const onToggleSection = rs.fn();
  const onArchiveBucket = rs.fn();
  const onUnarchiveBucket = rs.fn();
  const onSetBucketColor = rs.fn();
  const onCaptureInto = rs.fn();
  const onToggleArchived = rs.fn();
  function Harness() {
    const [buckets, setBuckets] = useState(START);
    const [selection, setSelection] = useState(initialSelection);
    const ids = new Set(buckets.map((b) => b.id));
    // The page's "keep selection valid" effect, inline.
    const current =
      ["all", "today", "mine", "inbox", TRASH_SELECTION].includes(selection) ||
      ids.has(selection) ||
      archived.some((b) => b.id === selection)
        ? selection
        : "inbox";
    const rail = (
      <BucketRail
        mode="plan"
        onModeChange={() => {}}
        selection={current}
        onSelect={setSelection}
        buckets={buckets}
        inbox={INBOX}
        archivedBuckets={archived}
        trashCount={trashCount}
        openCountByBucket={
          new Map([
            ["mkt", 5],
            ["op", 0],
            ["acme", 2],
            ["globex", 3],
            ["inbox-id", 4],
          ])
        }
        taskCountByBucket={new Map([["mkt", 5]])}
        driftCountByBucket={drift}
        totalOpenCount={14}
        queueCount={2}
        myTasksCount={myTasks}
        canEdit={canEdit}
        onCreateBucket={() => {}}
        onRenameBucket={() => {}}
        onDeleteBucket={(id, withTasks) => {
          onDeleteBucket(id, withTasks);
          setBuckets((prev) => prev.filter((b) => b.id !== id));
        }}
        onArchiveBucket={onArchiveBucket}
        onUnarchiveBucket={onUnarchiveBucket}
        onSetBucketColor={onSetBucketColor}
        onMoveBucket={dnd ? () => {} : undefined}
        onCaptureInto={onCaptureInto}
        onTriageBucket={onTriageBucket}
        timeBlockByBucket={new Map()}
        onSetTimeBlock={() => {}}
        onSetBucketGroup={() => {}}
        collapsedSections={collapsed}
        onToggleSection={onToggleSection}
        archivedOpen={archivedOpen}
        onToggleArchived={onToggleArchived}
      />
    );
    return <TooltipProvider>{dnd ? <DndContext>{rail}</DndContext> : rail}</TooltipProvider>;
  }
  render(<Harness />);
  return {
    onDeleteBucket,
    onTriageBucket,
    onToggleSection,
    onArchiveBucket,
    onUnarchiveBucket,
    onSetBucketColor,
    onCaptureInto,
    onToggleArchived,
  };
}

async function openMenu(name: string) {
  fireEvent.contextMenu(
    main(new RegExp(`^${name}(,|$)`)).closest('[data-slot="nav-row"]') as Element,
  );
  await settle();
}

async function deleteFromMenu(name: string) {
  fireEvent.contextMenu(main(new RegExp(`^${name},`)).closest('[data-slot="nav-row"]') as Element);
  await settle();
  fireEvent.click(screen.getByRole("menuitem", { name: "Delete bucket…" }));
  await settle();
}

describe("BucketRail on NavRow", () => {
  it("marks the current bucket with aria-current and gives only bucket rows a ⋯", () => {
    renderRail();
    expect(main(/^Marketing,/).getAttribute("aria-current")).toBe("page");
    expect(main(/^All,/).getAttribute("aria-current")).toBeNull();
    expect(screen.getByRole("button", { name: "Marketing options" })).toBeTruthy();
    // All, Queue and Inbox (no drift) reserve no action slot.
    expect(screen.queryByRole("button", { name: "All options" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Queue options" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Inbox options" })).toBeNull();
  });

  it("has no menus for someone who can't edit", () => {
    renderRail({ canEdit: false });
    expect(screen.queryByRole("button", { name: "Marketing options" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New bucket" })).toBeNull();
  });

  it("hands focus back to the bucket's row when the delete confirm is cancelled", async () => {
    const { onDeleteBucket } = renderRail();
    await deleteFromMenu("Marketing");
    expect(screen.getByRole("dialog", { name: "Delete “Marketing”?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onDeleteBucket).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(main(/^Marketing,/));
  });

  it("hands focus to the rail's current row once a confirmed delete removes the bucket", async () => {
    const { onDeleteBucket } = renderRail();
    await deleteFromMenu("Marketing");
    fireEvent.click(screen.getByRole("button", { name: "Delete bucket" }));
    await settle();
    expect(onDeleteBucket).toHaveBeenCalledWith("mkt", false);
    expect(screen.queryByRole("button", { name: /^Marketing,/ })).toBeNull();
    // The deleted bucket was current, so the scope fell back to Inbox.
    expect(document.activeElement).toBe(main(/^Inbox,/));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("hands focus back to the row when New section… is closed with Esc", async () => {
    renderRail();
    fireEvent.contextMenu(main(/^Marketing,/).closest('[data-slot="nav-row"]') as Element);
    await settle();
    fireEvent.pointerMove(screen.getByRole("menuitem", { name: "Section" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Section" }), { key: "ArrowRight" });
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "New section…" }));
    await settle();
    const input = screen.getByPlaceholderText("Section name — Enter");
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
    await settle();
    expect(document.activeElement).toBe(main(/^Marketing,/));
  });

  it("shows drift as a mark outside the count's slot that opens triage", () => {
    const { onTriageBucket } = renderRail({ drift: new Map([["op", 2]]) });
    const mark = screen.getByRole("button", { name: "2 drifted · triage" });
    expect(mark.closest('[data-slot="nav-row-trail"]')).toBeNull();
    fireEvent.click(mark);
    expect(onTriageBucket).toHaveBeenCalledWith("op");
  });

  it("gives Inbox a menu (Triage) only while it has drift", async () => {
    const { onTriageBucket } = renderRail({ drift: new Map([["inbox-id", 1]]) });
    fireEvent.contextMenu(main(/^Inbox,/).closest('[data-slot="nav-row"]') as Element);
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Triage 1 drifted…" }));
    await settle();
    expect(onTriageBucket).toHaveBeenCalledWith("inbox-id");
  });

  it("hides a collapsed section's buckets, keeps its total and surfaces its drift", () => {
    const { onToggleSection } = renderRail({
      collapsed: new Set(["Clients"]),
      drift: new Map([["acme", 1]]),
    });
    expect(screen.queryByRole("button", { name: /^Acme,/ })).toBeNull();
    const header = screen.getByRole("button", { name: /^Clients/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(header.textContent).toContain("5 open");
    expect(screen.getByRole("img", { name: /1 drifted in Clients/ })).toBeTruthy();
    fireEvent.click(header);
    expect(onToggleSection).toHaveBeenCalledWith("Clients");
  });
});

describe("BucketRail: Queue and My tasks (TV-D4)", () => {
  it("counts my queue on the Queue row", () => {
    renderRail();
    expect(main(/^Queue, 2 queued$/)).toBeTruthy();
  });

  it("shows My tasks only when the page passes a count (two or more members)", () => {
    renderRail();
    expect(screen.queryByRole("button", { name: /^My tasks/ })).toBeNull();
    cleanup();
    renderRail({ myTasks: 3 });
    expect(main(/^My tasks, 3 open$/)).toBeTruthy();
  });

  it("selects My tasks as the 'mine' scope", () => {
    renderRail({ myTasks: 3 });
    fireEvent.click(main(/^My tasks, 3 open$/));
    expect(main(/^My tasks, 3 open$/).getAttribute("aria-current")).toBe("page");
  });
});

describe("BucketRail: colours, archive, delete, Recently deleted (TV-U6)", () => {
  it("shows each bucket's colour dot, neutral when it has none", () => {
    renderRail();
    const dot = (name: RegExp) =>
      main(name).querySelector('[data-slot="nav-row-dot"]')?.getAttribute("data-label");
    expect(dot(/^Marketing,/)).toBe("teal");
    expect(dot(/^OP$/)).toBe("gray");
  });

  it("lists the spec's menu: Rename · Colour · Open at · Section · Share · Archive · Delete…", async () => {
    renderRail();
    await openMenu("Marketing");
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent?.trim())).toEqual([
      "Rename",
      "Colour",
      "Open at",
      "Section",
      "Share",
      "Archive",
      "Delete bucket…",
    ]);
  });

  it("picks a colour from the Colour menu", async () => {
    const { onSetBucketColor } = renderRail();
    await openMenu("Marketing");
    fireEvent.pointerMove(screen.getByRole("menuitem", { name: "Colour" }));
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Colour" }), { key: "ArrowRight" });
    await settle();
    const teal = screen.getByRole("menuitemradio", { name: "Teal" });
    expect(teal.getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("menuitemradio", { name: "Neutral" })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Violet" }));
    expect(onSetBucketColor).toHaveBeenCalledWith("mkt", "violet");
  });

  it("archives from the menu", async () => {
    const { onArchiveBucket } = renderRail();
    await openMenu("Marketing");
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(onArchiveBucket).toHaveBeenCalledWith("mkt");
  });

  it("captures into a bucket from its hover +, for people who can edit", () => {
    const { onCaptureInto } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "New task in Marketing" }));
    expect(onCaptureInto).toHaveBeenCalledWith("mkt");
    cleanup();
    renderRail({ canEdit: false });
    expect(screen.queryByRole("button", { name: "New task in Marketing" })).toBeNull();
  });

  it("deletes the tasks too when that's chosen in the confirm", async () => {
    const { onDeleteBucket } = renderRail();
    await deleteFromMenu("Marketing");
    fireEvent.click(screen.getByRole("radio", { name: "Delete the 5 tasks too" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete bucket" }));
    await settle();
    expect(onDeleteBucket).toHaveBeenCalledWith("mkt", true);
  });

  it("shows Archived only with archived buckets, collapsed until opened", () => {
    renderRail();
    expect(screen.queryByRole("button", { name: /^Archived/ })).toBeNull();
    cleanup();
    const old = bucket("old", "Old project", { archivedAt: NOW, color: "amber" });
    const { onToggleArchived } = renderRail({ archived: [old] });
    const header = screen.getByRole("button", { name: /^Archived/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: /^Old project/ })).toBeNull();
    fireEvent.click(header);
    expect(onToggleArchived).toHaveBeenCalledOnce();
  });

  it("opens an archived bucket, and its menu is Unarchive and Delete", async () => {
    const old = bucket("old", "Old project", { archivedAt: NOW });
    const { onUnarchiveBucket } = renderRail({ archived: [old], archivedOpen: true });
    fireEvent.click(main(/^Old project$/));
    expect(main(/^Old project$/).getAttribute("aria-current")).toBe("page");
    await openMenu("Old project");
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent?.trim())).toEqual([
      "Unarchive",
      "Delete bucket…",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: "Unarchive" }));
    expect(onUnarchiveBucket).toHaveBeenCalledWith("old");
  });

  it("shows Recently deleted at the bottom only while it holds anything, and selects it", () => {
    renderRail();
    expect(screen.queryByRole("button", { name: /^Recently deleted/ })).toBeNull();
    cleanup();
    renderRail({ trashCount: 3 });
    const row = main(/^Recently deleted, 3 items$/);
    const rows = screen.getAllByRole("button").filter((el) => el.dataset.slot === "nav-row-main");
    expect(rows.at(-1)).toBe(row);
    fireEvent.click(row);
    expect(row.getAttribute("aria-current")).toBe("page");
  });

  it("makes bucket rows sortable inside the page's DndContext, and only bucket rows", () => {
    renderRail({ dnd: true });
    // The sortable wrapper is the drag activator around each bucket row.
    const mkt = main(/^Marketing,/).closest('[data-slot="nav-row"]')?.parentElement?.parentElement;
    expect(mkt?.getAttribute("aria-roledescription")).toBeNull(); // not a focus stop
    expect(screen.getAllByRole("button", { name: /options$/ }).length).toBeGreaterThan(0);
    expect(asRailBucket({ type: "rail-bucket", bucketId: "mkt" })).toBe("mkt");
    expect(asRailBucket({ type: "task", taskId: "t" })).toBeNull();
    expect(asRailBucket(undefined)).toBeNull();
    expect(RAIL_BUCKET_PREFIX).toBe("rail:bucket:");
  });
});

describe("parseCollapsedSections", () => {
  it("reads a stored list and treats anything unreadable as nothing collapsed", () => {
    expect([...parseCollapsedSections('["Clients","Personal"]')]).toEqual(["Clients", "Personal"]);
    expect(parseCollapsedSections(null).size).toBe(0);
    expect(parseCollapsedSections("not json").size).toBe(0);
    expect(parseCollapsedSections('{"Clients":true}').size).toBe(0);
    expect([...parseCollapsedSections('["Clients", 3, "", null]')]).toEqual(["Clients"]);
  });
});
