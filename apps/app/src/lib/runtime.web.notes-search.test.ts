// GS-2 (specs/global-search.md AC10): Notes' sidebar search asks the server's
// notes__search, the same function MCP's notes_search and the ⌘K palette use,
// so all three return the same notes for the same query. Visibility is the
// server's (applied before its limit); the client reads the SearchHit rows.
import { afterEach, describe, expect, it, rs } from "@rstest/core";

import { supabaseClient } from "./runtime.web.client";
import { webNotes } from "./runtime.web.notes";

const WS = "00000000-0000-4000-8000-0000000000c3";
const NOTE = "00000000-0000-4000-8000-0000000000d4";

function stubRpc(answer: { data: unknown; error: unknown }) {
  return rs
    .spyOn(supabaseClient, "rpc")
    .mockImplementation((() => Promise.resolve(answer)) as never);
}

afterEach(() => {
  rs.restoreAllMocks();
});

describe("notesV2.search goes through notes__search", () => {
  it("calls notes__search with the workspace, the query and the limit", async () => {
    const rpc = stubRpc({ data: [], error: null });
    await webNotes.notesV2.search({ workspaceId: WS, query: "  kumquat jam ", limit: 30 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0]).toEqual([
      "notes__search",
      { p_workspace_id: WS, p_query: "kumquat jam", p_limit: 30 },
    ]);
  });

  it("reads the SearchHit rows: title, parent path, marked snippet and match", async () => {
    stubRpc({
      data: [
        {
          entity_type: "note",
          entity_id: NOTE,
          title: "Retro",
          context: "… / Planning / Quarterly review",
          snippet: "We tasted a kumquat at lunch",
          icon: "🍊",
          match: "body",
          rank: 0.42,
          updated_at: "2026-10-28T09:00:00Z",
        },
        // A row that breaks the contract (no id) is dropped, never drawn.
        { entity_type: "note", title: "Broken", match: "body", rank: 0.1 },
      ],
      error: null,
    });
    const hits = await webNotes.notesV2.search({ workspaceId: WS, query: "kumquat" });
    expect(hits).toEqual([
      {
        id: NOTE,
        title: "Retro",
        icon: "🍊",
        context: "… / Planning / Quarterly review",
        snippet: "We tasted a kumquat at lunch",
        match: "body",
      },
    ]);
  });

  it("asks nothing for an empty query", async () => {
    const rpc = stubRpc({ data: [], error: null });
    expect(await webNotes.notesV2.search({ workspaceId: WS, query: "   " })).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers nothing before the function is deployed, and throws on any other error", async () => {
    stubRpc({
      data: null,
      error: { code: "PGRST202", message: "Could not find the function public.notes__search" },
    });
    expect(await webNotes.notesV2.search({ workspaceId: WS, query: "plan" })).toEqual([]);
    rs.restoreAllMocks();
    stubRpc({ data: null, error: { code: "57014", message: "canceling statement due to timeout" } });
    await expect(webNotes.notesV2.search({ workspaceId: WS, query: "plan" })).rejects.toThrow();
  });
});
