// CV-19 · the search hook and Chat's Search box: a query with no word to find
// asks nothing, "Show older" never mixes two queries' pages, and typing keeps
// the box while the link catches up.

import { describe, expect, test } from "@rstest/core";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { type ReactNode, useState } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { ChatResult, ChatRuntime, ChatSearchHit, ChatSearchQuery } from "../model";
import { ChatSearchView } from "./chat-search-view";
import { FindBar } from "./find-bar";
import type { SearchParams } from "./model";
import { useChatSearch } from "./use-chat-search";

const hit = (id: string, at: string): ChatSearchHit => ({
  messageId: id,
  channelId: "c",
  channelKind: "channel",
  channelName: "general",
  parentId: null,
  replyToId: null,
  authorId: null,
  authorLabel: "Bot",
  createdAt: at,
  snippet: id,
});

type Call = { args: ChatSearchQuery; resolve: (r: ChatResult<ChatSearchHit[]>) => void };

function fakeChat() {
  const calls: Call[] = [];
  const chat = {
    search: (args: ChatSearchQuery) =>
      new Promise<ChatResult<ChatSearchHit[]>>((resolve) => calls.push({ args, resolve })),
  } as unknown as ChatRuntime;
  return { chat, calls };
}

const page = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) =>
    hit(`${prefix}${i}`, new Date(Date.UTC(2026, 9, 16, 12, 0, 0) - i * 1000).toISOString()),
  );

describe("useChatSearch (CV-19)", () => {
  test("negated words only ask the server nothing", async () => {
    const { chat, calls } = fakeChat();
    const { result } = renderHook(() =>
      useChatSearch(chat, { workspaceId: "w", query: "-standup" }),
    );
    expect(result.current.state.status).toBe("nothing");
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toHaveLength(0);
  });

  test("before Chat's runtime is here, words are on their way, never 'nothing to find'", async () => {
    const { chat, calls } = fakeChat();
    const { result, rerender } = renderHook(
      ({ c, q }: { c: ChatRuntime | null; q: string }) =>
        useChatSearch(c, { workspaceId: "w", query: q }),
      { initialProps: { c: null as ChatRuntime | null, q: "" } },
    );
    expect(result.current.state.status).toBe("idle");
    rerender({ c: null, q: "żółw" });
    expect(result.current.state.status).toBe("loading");
    rerender({ c: chat, q: "żółw" });
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  test("Show older belongs to the query that produced the list", async () => {
    const { chat, calls } = fakeChat();
    const { result, rerender } = renderHook(
      ({ q }: { q: string }) => useChatSearch(chat, { workspaceId: "w", query: q }, 2),
      { initialProps: { q: "alpha" } },
    );
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0]?.resolve({ data: page("a", 2), error: null }));
    expect(result.current.state).toMatchObject({ status: "ready", more: true });

    // New words: the old list stays while they're asked, but can't be continued.
    rerender({ q: "beta" });
    expect(result.current.state).toMatchObject({ status: "ready", more: false });
    act(() => result.current.loadMore());
    expect(calls).toHaveLength(1);

    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.args.query).toBe("beta");
    await act(async () => calls[1]?.resolve({ data: page("b", 2), error: null }));
    expect(result.current.state).toMatchObject({ status: "ready", more: true });

    // An older page asked for "beta", answered after the words moved on, is dropped.
    act(() => result.current.loadMore());
    expect(calls[2]?.args).toMatchObject({ query: "beta", before: { messageId: "b1" } });
    rerender({ q: "gamma" });
    await act(async () => calls[2]?.resolve({ data: page("x", 2), error: null }));
    await waitFor(() => expect(calls).toHaveLength(4));
    await act(async () => calls[3]?.resolve({ data: page("g", 1), error: null }));
    const state = result.current.state;
    expect(state.status === "ready" ? state.hits.map((h) => h.messageId) : null).toEqual(["g0"]);
  });
});

const wrap = (ui: ReactNode) => render(<TooltipProvider>{ui}</TooltipProvider>);

describe("Chat's Search box (CV-19)", () => {
  function Harness({ chat, delayed }: { chat: ChatRuntime; delayed: string[] }) {
    // The link follows typing a beat later, as the router does.
    const [params, setParams] = useState<SearchParams>({});
    return (
      <>
        <button type="button" onClick={() => setParams({ q: delayed.shift() ?? "" })}>
          deliver
        </button>
        <button type="button" onClick={() => setParams({ q: "from outside" })}>
          outside
        </button>
        <ChatSearchView
          chat={chat}
          workspaceId="w"
          params={params}
          onParamsChange={(next) => delayed.push(next.q ?? "")}
          people={[]}
          conversations={[]}
          personOf={() => undefined}
          conversationLabel={() => "general"}
          onOpenHit={() => {}}
          onOpenPerson={() => {}}
          selfId="me"
        />
      </>
    );
  }

  test("typing keeps the box while the link catches up; a change from outside lands", () => {
    const { chat } = fakeChat();
    const delayed: string[] = [];
    wrap(<Harness chat={chat} delayed={delayed} />);
    const box = screen.getByLabelText("Search messages") as HTMLInputElement;
    fireEvent.change(box, { target: { value: "s" } });
    fireEvent.change(box, { target: { value: "st" } });
    fireEvent.click(screen.getByText("deliver")); // the link now says "s"
    expect(box.value).toBe("st");
    fireEvent.click(screen.getByText("deliver")); // and now "st"
    expect(box.value).toBe("st");
    fireEvent.click(screen.getByText("outside"));
    expect(box.value).toBe("from outside");
  });

  test("negated words only say what to do instead of listing everything", () => {
    const { chat } = fakeChat();
    wrap(
      <ChatSearchView
        chat={chat}
        workspaceId="w"
        params={{ q: "-standup" }}
        onParamsChange={() => {}}
        people={[]}
        conversations={[]}
        personOf={() => undefined}
        conversationLabel={() => "general"}
        onOpenHit={() => {}}
        onOpenPerson={() => {}}
        selfId="me"
      />,
    );
    expect(screen.getByText("Type a word to search for.")).toBeTruthy();
  });
});

describe("A conversation's own Search (CV-19)", () => {
  test("before Chat's runtime is here it says it's searching, never 'type a word'", () => {
    wrap(
      <FindBar
        chat={null}
        workspaceId="w"
        channelId="c"
        onJump={() => {}}
        onClose={() => {}}
        onSeeAll={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Search in this conversation"), {
      target: { value: "żółw" },
    });
    expect(screen.getByRole("status").textContent).toBe("Searching…");
  });
});
