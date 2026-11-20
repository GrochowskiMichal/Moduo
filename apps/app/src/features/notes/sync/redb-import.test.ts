import { describe, expect, it } from "@rstest/core";

import { fileLegacyRows } from "./redb-import";

describe("fileLegacyRows (NR-1)", () => {
  it("files roots with children into Pages and leaves loose roots to the Inbox default", () => {
    const rows = fileLegacyRows([
      { id: "page", parentId: null, title: "Page" },
      { id: "child", parentId: "page", title: "Child" },
      { id: "loose", parentId: null, title: "Loose" },
    ]);
    expect(rows.find((r) => r.id === "page")!.inInbox).toBe(false);
    expect(rows.find((r) => r.id === "child")!.inInbox).toBeUndefined();
    expect(rows.find((r) => r.id === "loose")!.inInbox).toBeUndefined();
  });
});
