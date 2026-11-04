import { describe, expect, it } from "@rstest/core";

import type { MailEngine, MailReaderPrefs } from "@/lib/runtime.types.mail-engine";

import { DEFAULT_MAIL_BEHAVIOR, pushReaderPrefs, readerPrefs } from "./behavior";

describe("reader prefs mirrored to the engine", () => {
  it("carries sender logos and the undo window, sanitized", () => {
    expect(readerPrefs({ ...DEFAULT_MAIL_BEHAVIOR, senderLogos: false })).toEqual({
      senderLogos: false,
      undoSendSeconds: 10,
    });
  });

  it("pushes them through setReaderPrefs and tolerates a missing engine", async () => {
    const got: MailReaderPrefs[] = [];
    const engine = {
      setReaderPrefs: async (p: MailReaderPrefs) => void got.push(p),
    } as unknown as MailEngine;
    pushReaderPrefs(engine, { ...DEFAULT_MAIL_BEHAVIOR, undoSendSeconds: 30 });
    pushReaderPrefs(null, DEFAULT_MAIL_BEHAVIOR);
    await Promise.resolve();
    expect(got).toEqual([{ senderLogos: true, undoSendSeconds: 30 }]);
  });
});
