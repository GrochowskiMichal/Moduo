import { describe, expect, it } from "vitest";
import { shapeRecentNotes, timeAgo, type RecentNoteRow } from "./recent";

const NOW = new Date("2026-07-04T12:00:00Z");

function row(p: Partial<RecentNoteRow> & { id: string }): RecentNoteRow {
  return {
    id: p.id,
    title: p.title ?? p.id,
    bodyText: p.bodyText ?? "",
    updatedAt: p.updatedAt ?? "2026-07-04T10:00:00Z",
    isArchived: p.isArchived ?? false,
    publishedAt: p.publishedAt ?? null,
  };
}

describe("recent-notes widget shaper (AC13)", () => {
  it("orders latest-touched first and caps to the limit", () => {
    const rows = [
      row({ id: "old", updatedAt: "2026-07-01T00:00:00Z" }),
      row({ id: "new", updatedAt: "2026-07-04T11:00:00Z" }),
      row({ id: "mid", updatedAt: "2026-07-03T00:00:00Z" }),
    ];
    const out = shapeRecentNotes(rows, { limit: 2, now: NOW });
    expect(out.map((r) => r.id)).toEqual(["new", "mid"]);
  });

  it("derives a one-line snippet from the body, dropping the echoed title line", () => {
    const out = shapeRecentNotes(
      [row({ id: "n", title: "Roadmap", bodyText: "Roadmap\nShip NO-9 then NO-10\n\nPublish flow" })],
      { now: NOW },
    );
    expect(out[0].title).toBe("Roadmap");
    expect(out[0].snippet).toBe("Ship NO-9 then NO-10 Publish flow");
  });

  it("gives an empty snippet when the body is only the title", () => {
    const out = shapeRecentNotes([row({ id: "n", title: "Just a title", bodyText: "Just a title" })], { now: NOW });
    expect(out[0].snippet).toBe("");
  });

  it("truncates a long snippet with an ellipsis", () => {
    const long = "word ".repeat(60);
    const out = shapeRecentNotes([row({ id: "n", title: "T", bodyText: `T\n${long}` })], { now: NOW });
    expect(out[0].snippet.length).toBeLessThanOrEqual(121);
    expect(out[0].snippet.endsWith("…")).toBe(true);
  });

  it("falls back to Untitled and flags published + archived", () => {
    const out = shapeRecentNotes(
      [row({ id: "n", title: "  ", isArchived: true, publishedAt: "2026-07-04T09:00:00Z" })],
      { now: NOW },
    );
    expect(out[0].title).toBe("Untitled");
    expect(out[0].isArchived).toBe(true);
    expect(out[0].isPublished).toBe(true);
  });

  it("timeAgo renders a human relative label", () => {
    expect(timeAgo("2026-07-04T11:59:30Z", NOW)).toBe("just now");
    expect(timeAgo("2026-07-04T11:30:00Z", NOW)).toBe("30m ago");
    expect(timeAgo("2026-07-04T09:00:00Z", NOW)).toBe("3h ago");
    expect(timeAgo("2026-07-01T12:00:00Z", NOW)).toBe("3d ago");
  });
});
