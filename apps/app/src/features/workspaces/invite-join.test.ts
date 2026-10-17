import { afterEach, describe, expect, it } from "@rstest/core";

import {
  InviteEmailMismatchError,
  isInviteEmailMismatch,
  joinPath,
  PENDING_JOIN_KEY,
  PENDING_JOIN_TTL_MS,
  setPendingJoin,
  takePendingJoin,
} from "./invite-join";

afterEach(() => window.localStorage.clear());

describe("pending join", () => {
  it("is read once", () => {
    setPendingJoin("ab+cd/ef==");
    expect(takePendingJoin()).toBe("ab+cd/ef==");
    expect(takePendingJoin()).toBeNull();
    expect(window.localStorage.getItem(PENDING_JOIN_KEY)).toBeNull();
  });

  it("is dropped after a day, so an abandoned invite doesn't hijack a later sign-in", () => {
    setPendingJoin("ab+cd/ef==", 0);
    expect(takePendingJoin(PENDING_JOIN_TTL_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(PENDING_JOIN_KEY)).toBeNull();
    setPendingJoin("ab+cd/ef==", 0);
    expect(takePendingJoin(PENDING_JOIN_TTL_MS)).toBe("ab+cd/ef==");
  });

  it("still reads a bare token an older build wrote", () => {
    window.localStorage.setItem(PENDING_JOIN_KEY, "ab+cd/ef==");
    expect(takePendingJoin()).toBe("ab+cd/ef==");
  });

  it("links to /join with the token encoded (invite tokens are base64)", () => {
    expect(joinPath("ab+cd/ef==")).toBe("/join?invite=ab%2Bcd%2Fef%3D%3D");
  });
});

describe("invite for another address (AC35)", () => {
  it("recognises the accept function's refusal", () => {
    expect(isInviteEmailMismatch("invite_email_mismatch")).toBe(true);
    expect(isInviteEmailMismatch("Invalid or expired invite")).toBe(false);
  });

  it("says which address the invite is for, masked", () => {
    const error = new InviteEmailMismatchError("t•••@becker.studio");
    expect(error.maskedEmail).toBe("t•••@becker.studio");
    expect(error.message).toBe(
      "This invite is for t•••@becker.studio. Sign in with that address to join.",
    );
  });

  it("never shows a hint that isn't a masked address", () => {
    for (const hint of [
      undefined,
      "",
      "tom@becker.studio",
      "<b>x</b>•••@a",
      "t•••@becker studio",
    ]) {
      const error = new InviteEmailMismatchError(hint);
      expect(error.maskedEmail).toBeNull();
      expect(error.message).toBe(
        "This invite is for a different email address. Sign in with that address to join.",
      );
    }
  });
});
