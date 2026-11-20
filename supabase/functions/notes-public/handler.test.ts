import { describe, expect, it } from "@rstest/core";

import { handleNotesPublic, SUBTREE_RPC } from "./handler.ts";

function get(query: string): Request {
  return new Request(`https://example.supabase.co/functions/v1/notes-public${query}`);
}

function rpcReturning(value: unknown) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    return value;
  };
  return { rpc, calls };
}

describe("handleNotesPublic", () => {
  it("reads the published tree through the service-role subtree function, by token", async () => {
    const fake = rpcReturning({
      rootId: "r",
      notes: [
        { id: "r", parentId: null, title: "Handbook", icon: null, bodyMd: "Hi <!-- moduo:task:abc-1 -->", position: "a", createdAt: "2026-10-01" },
        { id: "a", parentId: "r", title: "Onboarding", icon: "📘", bodyMd: "", position: "b", createdAt: "2026-10-02" },
      ],
    });
    const res = await handleNotesPublic(get("?token=%20tok-1%20"), { rpc: fake.rpc });
    expect(res.status).toBe(200);
    expect(fake.calls).toEqual([{ fn: SUBTREE_RPC, args: { p_token: "tok-1" } }]);
    const body = (await res.json()) as { rootId: string; notes: { id: string; bodyMd: string; icon: string | null }[] };
    expect(body.rootId).toBe("r");
    expect(body.notes.map((n) => n.id)).toEqual(["r", "a"]);
    // Task-id comments are scrubbed at the trust boundary.
    expect(body.notes[0].bodyMd).toBe("Hi");
    expect(body.notes[1].icon).toBe("📘");
  });

  it("adds nothing to what the subtree function answers (the SQL test proves the private-sub-note rule)", async () => {
    // The SQL function (tested in supabase/tests/notes_public_subtree.test.sql)
    // drops a sub-note with its own sharing; the handler adds nothing back.
    const fake = rpcReturning({ rootId: "r", notes: [{ id: "r", parentId: null, title: "Root" }] });
    const res = await handleNotesPublic(get("?token=tok"), { rpc: fake.rpc });
    const body = (await res.json()) as { notes: unknown[] };
    expect(body.notes).toHaveLength(1);
  });

  it("answers 404 for an unknown, revoked or archived root (the function returns null)", async () => {
    const res = await handleNotesPublic(get("?token=gone"), rpcReturning(null));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("answers 404 without calling the database when the token is missing", async () => {
    const fake = rpcReturning(null);
    expect((await handleNotesPublic(get(""), fake)).status).toBe(404);
    expect((await handleNotesPublic(get("?token=%20"), fake)).status).toBe(404);
    expect(fake.calls).toHaveLength(0);
  });

  it("fails closed with 503 when the read fails (e.g. the function is not deployed yet)", async () => {
    const errors: unknown[] = [];
    const res = await handleNotesPublic(get("?token=tok"), {
      rpc: async () => {
        throw new Error("rpc notes_public_subtree: 404 PGRST202");
      },
      onError: (e) => errors.push(e),
    });
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(errors).toHaveLength(1);
  });

  it("answers preflight and refuses other methods", async () => {
    const fake = rpcReturning(null);
    const pre = await handleNotesPublic(new Request("https://e.co/notes-public", { method: "OPTIONS" }), fake);
    expect(pre.status).toBe(204);
    const post = await handleNotesPublic(new Request("https://e.co/notes-public?token=t", { method: "POST" }), fake);
    expect(post.status).toBe(405);
  });
});
