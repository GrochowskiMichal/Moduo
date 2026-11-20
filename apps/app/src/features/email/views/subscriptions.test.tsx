import { describe, expect, it } from "@rstest/core";
import { fireEvent, render } from "@testing-library/react";

import { row } from "../testing/intel-fixtures";
import { groupBySender } from "./newsletter-groups";
import { SubscriptionsView } from "./subscriptions";

const DAY = 86_400_000;
const now = Date.UTC(2026, 10, 4, 12);
const rows = [
  row({
    threadId: "1",
    from: "news@paper.test",
    name: "Paper",
    tab: "newsletters",
    lastDateMs: now - 3 * DAY,
    unread: true,
  }),
  row({
    threadId: "2",
    from: "NEWS@paper.test",
    name: "Paper",
    tab: "newsletters",
    lastDateMs: now - DAY,
  }),
  row({
    threadId: "3",
    from: "deals@shop.test",
    name: "Shop",
    tab: "newsletters",
    lastDateMs: now - 10 * DAY,
  }),
  row({ threadId: "4", from: "ann@x.test", tab: "personal", lastDateMs: now }),
];

describe("newsletter grouping (AC25)", () => {
  it("groups newsletters by sender, newest first", () => {
    const g = groupBySender(rows);
    expect(g.map((x) => [x.email, x.threadIds, x.unread])).toEqual([
      ["news@paper.test", ["1", "2"], 1],
      ["deals@shop.test", ["3"], 0],
    ]);
    expect(g[0]?.lastDateMs).toBe(now - DAY);
  });
});

describe("SubscriptionsView (AC29)", () => {
  it("lists every newsletter sender with last-received, Unsubscribe and Done all", () => {
    const unsub: string[] = [];
    const done: string[][] = [];
    const ui = render(
      <SubscriptionsView
        rows={rows}
        nowMs={now}
        onUnsubscribe={(g) => unsub.push(g.email)}
        onDoneAll={(g) => done.push(g.threadIds)}
      />,
    );
    expect(ui.getAllByRole("listitem")).toHaveLength(2);
    expect(ui.getByText(/yesterday/)).toBeTruthy();
    expect(ui.getByText(/10 days ago/)).toBeTruthy();
    expect(ui.queryByText("ann@x.test")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Unsubscribe from Paper" }));
    fireEvent.click(ui.getByRole("button", { name: "Done all from Shop" }));
    expect(unsub).toEqual(["news@paper.test"]);
    expect(done).toEqual([["3"]]);
  });

  it("marks an unsubscribed sender and shows an empty state with none", () => {
    const ui = render(
      <SubscriptionsView
        rows={rows}
        nowMs={now}
        onUnsubscribe={() => {}}
        onDoneAll={() => {}}
        unsubscribed={new Set(["news@paper.test"])}
      />,
    );
    expect(
      (ui.getByRole("button", { name: "Unsubscribe from Paper" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    ui.unmount();
    const empty = render(
      <SubscriptionsView rows={[]} nowMs={now} onUnsubscribe={() => {}} onDoneAll={() => {}} />,
    );
    expect(empty.getByText("No subscriptions")).toBeTruthy();
  });
});
