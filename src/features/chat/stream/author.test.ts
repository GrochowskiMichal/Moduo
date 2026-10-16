// CV-21 (§14): a post through a key is a named delegate, "Alex Rivera · via
// Claude", with Alex's avatar and no app badge; v1's app posts (no person)
// keep the app's name alone. The same words in search hits.
import { describe, expect, it } from "@rstest/core";

import { authorOf } from "../find/chat-search-view";
import type { ChatPerson } from "../model";
import { message, YOU } from "../store/testing";
import { authorName, viaKey } from "./rows";

const alex: ChatPerson = { userId: YOU, name: "Alex Rivera", avatarUrl: null, role: "member" };
const AT = "2026-10-16T10:00:00.000000+00:00";

describe("who wrote it (CV-21)", () => {
  it("a post through a key: the person, via the key", () => {
    const m = message("m1", "c1", AT, { authorKind: "api_key", authorLabel: "Claude" });
    expect(viaKey(m)).toBe(true);
    expect(authorName(m, alex)).toBe("Alex Rivera · via Claude");
    expect(authorName(m, undefined)).toBe("Former member · via Claude");
  });

  it("v1's app post: the app's name alone", () => {
    const m = message("m2", "c1", AT, { authorId: null, authorKind: "api_key", authorLabel: "CI" });
    expect(viaKey(m)).toBe(false);
    expect(authorName(m, undefined)).toBe("CI");
  });

  it("a person's own post: their name", () => {
    expect(authorName(message("m3", "c1", AT), alex)).toBe("Alex Rivera");
  });

  it("search hits read the same", () => {
    const personOf = (id: string) => (id === YOU ? alex : undefined);
    const hit = {
      messageId: "m1",
      channelId: "c1",
      channelKind: "channel" as const,
      channelName: "builds",
      parentId: null,
      replyToId: null,
      createdAt: AT,
      snippet: "",
    };
    expect(authorOf({ ...hit, authorId: YOU, authorLabel: "Claude" }, personOf)).toBe(
      "Alex Rivera · via Claude",
    );
    expect(authorOf({ ...hit, authorId: null, authorLabel: "CI" }, personOf)).toBe("CI");
    expect(authorOf({ ...hit, authorId: YOU, authorLabel: null }, personOf)).toBe("Alex Rivera");
  });
});
