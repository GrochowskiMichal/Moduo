// Renaming yourself writes the name twice: the auth user's metadata and the
// `profiles` row teammates read. A failed `profiles` write is a failed rename,
// never a reported success (HV-12, supabase-error-swallowed). Runs the real
// runtime over a stand-in for the Supabase client.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

const h = rs.hoisted(() => ({
  user: "00000000-0000-4000-8000-0000000000a1",
  profileError: null as { message: string } | null,
  profileWrites: [] as unknown[],
}));

rs.mock("@supabase/supabase-js", () => {
  const chain = (table: string): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) =>
              Promise.resolve({
                data: null,
                error: table === "profiles" ? h.profileError : null,
              }).then(resolve);
          }
          return (...args: unknown[]) => {
            if (table === "profiles" && prop === "update") h.profileWrites.push(args[0]);
            return chain(table);
          };
        },
      },
    );
  const noop = () => ({ data: { subscription: { unsubscribe() {} } } });
  const auth = {
    onAuthStateChange: noop,
    getUser: async () => ({ data: { user: { id: h.user } }, error: null }),
    updateUser: async () => ({ data: { user: { id: h.user } }, error: null }),
  };
  const client = new Proxy(
    {
      from: (table: string) => chain(table),
      rpc: async () => ({ data: null, error: null }),
      auth: new Proxy(auth, { get: (t, p) => (t as never)[p] ?? noop }),
    },
    { get: (t, p) => (t as never)[p] ?? noop },
  );
  return { createClient: () => client };
});

import { webRuntime } from "./runtime.web";

describe("updateDisplayName", () => {
  beforeEach(() => {
    h.profileError = null;
    h.profileWrites.length = 0;
  });

  it("writes the new name to profiles and reports success", async () => {
    const res = await webRuntime.auth.updateDisplayName("Ada");
    expect(res.error).toBeNull();
    expect(h.profileWrites).toEqual([{ display_name: "Ada" }]);
  });

  it("reports a failed profiles write as a failed rename", async () => {
    h.profileError = { message: "TypeError: Failed to fetch" };
    const res = await webRuntime.auth.updateDisplayName("Ada");
    expect(res.error?.message).toContain("Failed to fetch");
  });
});
