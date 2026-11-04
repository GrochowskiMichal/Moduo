import { describe, expect, it } from "@rstest/core";

import { DEFAULT_MAIL_BEHAVIOR, sanitizeMailBehavior } from "@/features/email/engine/behavior";
import { sanitizeEmailPrefs } from "@/features/email/prefs";
import type { EmailSettingsItem } from "@/lib/runtime.types.email";

import { capChoiceGb, describeRule, moveItem, normalizeAddress, storageLine } from "./model";

const GB = 1024 ** 3;
const item = (id: string, position: number): EmailSettingsItem =>
  ({
    id,
    kind: "rule",
    position,
    value: {},
    updatedAt: "2026-11-01T00:00:00Z",
    deletedAt: null,
  }) as EmailSettingsItem;

describe("Settings → Mail model (AC36)", () => {
  it("shows mail and attachments separately", () => {
    expect(storageLine({ mailBytes: 1.2 * GB, attachmentBytes: 0.3 * GB })).toBe(
      "mail 1.2 GB · attachments 0.3 GB",
    );
  });

  it("maps a stored cap to its choice, 2 GB by default", () => {
    expect(capChoiceGb(2 * GB)).toBe(2);
    expect(capChoiceGb(4.6 * GB)).toBe(5);
  });

  it("reorders by rewriting only the rows whose position changes", () => {
    const list = [item("a", 0), item("b", 1), item("c", 2)];
    expect(moveItem(list, "c", -1).map((m) => [m.item.id, m.position])).toEqual([
      ["c", 1],
      ["b", 2],
    ]);
    expect(moveItem(list, "a", -1)).toEqual([]);
  });

  it("validates addresses and describes rules", () => {
    expect(normalizeAddress(" Anna@X.com ")).toBe("anna@x.com");
    expect(normalizeAddress("nope")).toBeNull();
    expect(
      describeRule({
        conditions: [{ field: "from", value: "a@x.com" }],
        actions: [{ action: "move_to_folder", arg: "Receipts" }],
      }),
    ).toBe("From a@x.com → move to Receipts");
  });

  it("behavior defaults match the spec and survive the email prefs round trip", () => {
    expect(DEFAULT_MAIL_BEHAVIOR).toMatchObject({
      badge: "personal",
      notifyPersonal: false,
      remoteImages: "block",
      trackerBlocking: true,
      spellCheck: true,
      undoSendSeconds: 10,
      doneOnSend: true,
      shortcutHints: true,
      senderLogos: true,
      screener: false,
      blockDestination: "trash",
    });
    const behavior = {
      ...DEFAULT_MAIL_BEHAVIOR,
      density: "compact",
      previewLines: 2,
      undoSendSeconds: 30,
    };
    expect(sanitizeEmailPrefs({ behavior }).behavior).toEqual(behavior);
    expect(sanitizeMailBehavior({ undoSendSeconds: 7, badge: "x" })).toEqual(DEFAULT_MAIL_BEHAVIOR);
  });
});
