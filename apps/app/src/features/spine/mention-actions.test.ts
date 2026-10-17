import { describe, expect, it, rs } from "@rstest/core";

import type { ModuoRuntime } from "@/lib/runtime.types";
import { executeMention } from "./mention-actions";

function fakeRuntime() {
  const createLink = rs.fn(async () => ({}));
  return { runtime: { spine: { createLink } } as unknown as ModuoRuntime, createLink };
}

const ctx = { workspaceId: "w1", source: { type: "note", id: "n1" } };

describe("executeMention · link", () => {
  it("links an ordinary item and inserts its chip", async () => {
    const { runtime, createLink } = fakeRuntime();
    const insert = await executeMention(runtime, ctx, {
      action: "link",
      target: { type: "task", id: "t1" },
      relationKind: "mentions",
      origin: "mention",
      label: "Logo",
      icon: "task",
    });
    expect(createLink).toHaveBeenCalledTimes(1);
    expect(insert).toEqual({ ref: { type: "task", id: "t1" }, label: "Logo", icon: "task" });
  });

  it("a conversation or a message stays a chip with no link written", async () => {
    for (const type of ["chat_channel", "chat_message"]) {
      const { runtime, createLink } = fakeRuntime();
      const insert = await executeMention(runtime, ctx, {
        action: "link",
        target: { type, id: "c1" },
        relationKind: "references",
        origin: "ref",
        label: "acme",
        icon: null,
      });
      expect(createLink).not.toHaveBeenCalled();
      expect(insert).toEqual({ ref: { type, id: "c1" }, label: "acme", icon: null });
    }
  });
});
