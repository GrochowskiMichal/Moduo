import { describe, expect, it } from "@rstest/core";

import { classify, type OpenPr, type RemoteBranch, renderText } from "./branch-audit.ts";

const b = (name: string, extra: Partial<RemoteBranch> = {}): RemoteBranch => ({
  name,
  sha: "0".repeat(40),
  date: "2026-10-01",
  author: "Mike",
  subject: `work on ${name}`,
  merged: true,
  ahead: 0,
  ...extra,
});

describe("branch-audit classify (AC13)", () => {
  it("keeps the long-lived branches whatever their merge state", () => {
    const rows = classify([b("develop"), b("mike", { merged: false, ahead: 3 }), b("maciej")], []);
    expect(rows.map((r) => r.bucket)).toEqual(["kept", "kept", "kept"]);
  });

  it("puts the four retired mirror branches in their own bucket, never in the group delete", () => {
    const rows = classify(
      [b("main"), b("prod-app"), b("staging-app", { merged: false, ahead: 2 }), b("prod-landing")],
      [],
    );
    expect(new Set(rows.map((r) => r.bucket))).toEqual(new Set(["mirror"]));
  });

  it("marks a branch merged into develop with no open PR as safe to delete", () => {
    expect(classify([b("t/mike/done")], [])[0].bucket).toBe("merged");
  });

  it("holds back a merged branch that an open PR still uses, as head or as base", () => {
    const prs: OpenPr[] = [
      { number: 7, head: "t/mike/open", base: "mike", title: "x" },
      { number: 8, head: "t/maciej/child", base: "t/maciej/parent", title: "y" },
    ];
    const rows = classify([b("t/mike/open"), b("t/maciej/parent")], prs);
    expect(rows.map((r) => [r.name, r.bucket, r.prs])).toEqual([
      ["t/maciej/parent", "unmerged", ["#8 (base, from t/maciej/child)"]],
      ["t/mike/open", "unmerged", ["#7 (head → mike)"]],
    ]);
  });

  it("lists unmerged branches oldest first, with date, author, commits ahead and subject", () => {
    const rows = classify(
      [
        b("claude/new", { merged: false, ahead: 2, date: "2026-10-10", author: "Maciej" }),
        b("archive/old", { merged: false, ahead: 40, date: "2026-05-13" }),
      ],
      [],
    );
    expect(rows.map((r) => r.name)).toEqual(["archive/old", "claude/new"]);
    const text = renderText(rows, "origin/develop");
    expect(text).toContain("2026-05-13  archive/old  Mike  +40  · work on archive/old");
    expect(text).toContain("2026-10-10  claude/new  Maciej  +2  · work on claude/new");
    expect(text).toContain("safe to delete as a group): 0");
  });
});
