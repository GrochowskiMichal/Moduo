import { describe, expect, it } from "@rstest/core";

import { checkSendSize, sendProviderName } from "./size-limit";

const MB = 1024 * 1024;

describe("send size limit (specs/mail-v3.md §9, AC32)", () => {
  it("names provider, limit and largest file; graph 3 MB", () => {
    const files = [
      { filename: "photos.zip", size: 18 * MB },
      { filename: "notes.txt", size: 40_000 },
      // A pasted inline image is an attachment too: it counts.
      { filename: "pasted-image.png", size: 2 * MB },
    ];
    const gmail = checkSendSize(files, 1000, { bytes: 25 * MB, provider: "gmail" });
    expect(gmail.ok).toBe(false);
    if (!gmail.ok) {
      expect(gmail.largest).toBe("photos.zip");
      expect(gmail.message).toBe(
        "This message is 26.7 MB; Gmail accepts up to 25 MB. Remove photos.zip or share it as a link.",
      );
    }

    // Microsoft sending through Graph: the engine's 3 MB, and the copy says Outlook.
    const graph = checkSendSize([{ filename: "deck.pdf", size: 2.5 * MB }], 500, {
      bytes: 3 * MB,
      provider: "outlook",
    });
    expect(graph.ok).toBe(false);
    if (!graph.ok)
      expect(graph.message).toBe(
        "This message is 3.3 MB; Outlook accepts up to 3 MB. Remove deck.pdf or share it as a link.",
      );

    expect(checkSendSize(files.slice(1), 1000, { bytes: 25 * MB, provider: "gmail" }).ok).toBe(
      true,
    );
    expect(sendProviderName("google_workspace")).toBe("Gmail");
    expect(sendProviderName("icloud")).toBe("iCloud");
    expect(sendProviderName("imap")).toBe("Your provider");
  });
});
