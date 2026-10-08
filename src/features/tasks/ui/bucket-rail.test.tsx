// DS-3 — the Tasks bucket rail on NavRow: aria-current, count ⇄ ⋯ on bucket
// rows only, drift as a mark outside the slot, remembered section collapse, and
// focus handed back to the rail when the delete confirm closes (it used to
// land on the page body: the dialog has no trigger to return to).

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import type { Bucket } from "../model";
import { BucketRail, parseCollapsedSections } from "./bucket-rail";

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
  bucket("mkt", "Marketing"),
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
}: {
  canEdit?: boolean;
  selection?: string;
  drift?: Map<string, number>;
  collapsed?: Set<string>;
} = {}) {
  const onDeleteBucket = rs.fn();
  const onTriageBucket = rs.fn();
  const onToggleSection = rs.fn();
  function Harness() {
    const [buckets, setBuckets] = useState(START);
    const [selection, setSelection] = useState(initialSelection);
    const ids = new Set(buckets.map((b) => b.id));
    // The page's "keep selection valid" effect, inline.
    const current =
      ["all", "today", "inbox"].includes(selection) || ids.has(selection) ? selection : "inbox";
    return (
      <TooltipProvider>
        <BucketRail
          mode="plan"
          onModeChange={() => {}}
          selection={current}
          onSelect={setSelection}
          buckets={buckets}
          inbox={INBOX}
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
          committedCount={2}
          canEdit={canEdit}
          onCreateBucket={() => {}}
          onRenameBucket={() => {}}
          onDeleteBucket={(id) => {
            onDeleteBucket(id);
            setBuckets((prev) => prev.filter((b) => b.id !== id));
          }}
          onTriageBucket={onTriageBucket}
          timeBlockByBucket={new Map()}
          onSetTimeBlock={() => {}}
          onSetBucketGroup={() => {}}
          collapsedSections={collapsed}
          onToggleSection={onToggleSection}
        />
      </TooltipProvider>
    );
  }
  render(<Harness />);
  return { onDeleteBucket, onTriageBucket, onToggleSection };
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
    expect(onDeleteBucket).toHaveBeenCalledWith("mkt");
    expect(screen.queryByRole("button", { name: /^Marketing,/ })).toBeNull();
    // The deleted bucket was current, so the scope fell back to Inbox.
    expect(document.activeElement).toBe(main(/^Inbox,/));
    expect(document.activeElement).not.toBe(document.body);
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

describe("parseCollapsedSections", () => {
  it("reads a stored list and treats anything unreadable as nothing collapsed", () => {
    expect([...parseCollapsedSections('["Clients","Personal"]')]).toEqual(["Clients", "Personal"]);
    expect(parseCollapsedSections(null).size).toBe(0);
    expect(parseCollapsedSections("not json").size).toBe(0);
    expect(parseCollapsedSections('{"Clients":true}').size).toBe(0);
    expect([...parseCollapsedSections('["Clients", 3, "", null]')]).toEqual(["Clients"]);
  });
});
