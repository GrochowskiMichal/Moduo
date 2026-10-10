// Help menu targets (tasks-v3 call 96): the bug report's text, subject and
// mailto link.

import { describe, expect, it } from "@rstest/core";

import {
  type BugReportContext,
  bugReportSubject,
  describeBugReportContext,
  formatBugReport,
  mailtoUrl,
} from "./help-links";

const ctx: BugReportContext = {
  version: "1.4.0",
  build: "a1b2c3d",
  platform: "web",
  page: "/tasks",
};

describe("bug report", () => {
  it("puts the person's words first, then the version, build, platform and page", () => {
    expect(formatBugReport("  The timer froze.\n", ctx)).toBe(
      [
        "The timer froze.",
        "",
        "--",
        "Moduo 1.4.0 (build a1b2c3d)",
        "Platform: web",
        "Page: /tasks",
      ].join("\n"),
    );
    expect(describeBugReportContext(ctx)).toBe("Moduo 1.4.0 (build a1b2c3d) · web · /tasks");
  });

  it("takes the subject from the first line and cuts a long one", () => {
    expect(bugReportSubject("The timer froze\nafter a break")).toBe("Bug: The timer froze");
    expect(bugReportSubject("   ")).toBe("Bug report");
    const long = bugReportSubject("x".repeat(80));
    expect(long).toBe(`Bug: ${"x".repeat(60)}…`);
  });

  it("encodes the subject and body of the mailto link", () => {
    expect(mailtoUrl("hello@moduo.app", "Bug: a & b", "line 1\nline 2")).toBe(
      "mailto:hello@moduo.app?subject=Bug%3A%20a%20%26%20b&body=line%201%0Aline%202",
    );
    expect(mailtoUrl("support@moduo.app", "Moduo support")).toBe(
      "mailto:support@moduo.app?subject=Moduo%20support",
    );
  });
});
