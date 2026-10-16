// CV-14 · A decision in a reply chain can be taken back from the chain panel
// (it has no ⋯ menu): "Unmark" beside the label, for people who can post.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { message } from "../store/testing";
import { ChainItem } from "./chain-item";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const C = "00000000-0000-4000-8000-0000000000c1";
const ROOT = "00000000-0000-4000-8000-000000000001";
const ME = "00000000-0000-4000-8000-0000000000a1";
const root = message(ROOT, C, "2026-10-16T10:00:00Z", { body: "Which logo?", replyCount: 2 });
const decided = message("00000000-0000-4000-8000-000000000002", C, "2026-10-16T10:01:00Z", {
  body: "the square one",
  parentId: ROOT,
  decisionAt: "2026-10-16T10:02:00Z",
  decisionBy: ME,
});
const plain = message("00000000-0000-4000-8000-000000000003", C, "2026-10-16T10:03:00Z", {
  body: "agreed",
  parentId: ROOT,
});

function chain(onUnmarkDecision?: (m: typeof decided) => void) {
  return (
    <ChainItem
      chat={null}
      rootId={ROOT}
      chain={{ root, replies: [decided, plain], loading: false, loaded: true }}
      selfId={ME}
      personOf={() => undefined}
      onLoad={() => {}}
      onUnmarkDecision={onUnmarkDecision}
    />
  );
}

describe("ChainItem · decisions (CV-14)", () => {
  it("a decided reply offers Unmark, which takes back that reply's decision", () => {
    const onUnmark = rs.fn();
    render(chain(onUnmark));
    const unmark = screen.getAllByRole("button", { name: "Unmark decision" });
    expect(unmark).toHaveLength(1);
    fireEvent.click(unmark[0]!);
    expect(onUnmark).toHaveBeenCalledWith(decided);
  });

  it("without post rights the label shows alone", () => {
    render(chain(undefined));
    expect(screen.getByText("Decision")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Unmark decision" })).toBeNull();
  });
});
