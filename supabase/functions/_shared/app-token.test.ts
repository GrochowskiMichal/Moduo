import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "@rstest/core";

import { APP_TOKEN_REFUSAL, personBearer, verifiedPerson } from "./app-token.ts";

const FUNCTIONS = resolve(import.meta.dirname, "..");

function token(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "ES256", typ: "JWT" })}.${part(claims)}.signature`;
}

// Every way to put "Bearer " inside a token instead of in front of it.
function spliced(t: string): string[] {
  return Array.from({ length: t.length - 1 }, (_, i) => `${t.slice(0, i + 1)}Bearer ${t.slice(i + 1)}`);
}

describe("every function that accepts a person's token refuses an app's", () => {
  // Every source file of every function, shared helpers included, except
  // moduo-mcp (the one place an app's token is meant to work, MCPO-3) and the
  // helper that does the verifying.
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
      const path = join(dir, d.name);
      if (d.isDirectory()) return d.name === "moduo-mcp" || d.name === "node_modules" ? [] : sources(path);
      return d.name.endsWith(".ts") && !d.name.endsWith(".test.ts") ? [path] : [];
    });
  }
  const files = sources(FUNCTIONS).filter((f) => !f.endsWith(join("_shared", "app-token.ts")));
  const read = (f: string) => readFileSync(f, "utf8");

  it("finds the functions", () => {
    expect(files.filter((f) => f.endsWith("index.ts")).length).toBeGreaterThan(10);
  });

  it("no file verifies a token itself or rewrites the Authorization header", () => {
    // getUser() on its own would verify a string nobody checked for an app (MOD-570);
    // a client built with the caller's header would trust it unchecked.
    const offenders = files
      .filter((f) =>
        /\.auth\.(getUser|getClaims)\(|\bjwtVerify\(|\/auth\/v1\/user\b|replace\([^)]*Bearer|global\s*:\s*\{\s*headers/.test(read(f)),
      )
      .map((f) => relative(FUNCTIONS, f));
    expect(offenders).toEqual([]);
  });

  for (const file of files.filter((f) => /\b(verifiedPerson|authenticate)\(/.test(read(f)))) {
    const name = relative(FUNCTIONS, file);
    if (name === join("_shared", "billing.ts")) continue;
    it(`${name} answers an app's token with the refusal`, () => {
      expect(read(file)).toMatch(/APP_TOKEN_REFUSAL/);
    });
  }

  it("billing's shared authenticate goes through verifiedPerson", () => {
    expect(read(join(FUNCTIONS, "_shared", "billing.ts"))).toMatch(/verifiedPerson<User>\(supabase\.auth, authHeader\)/);
  });

  it("refuses with one body", () => {
    expect(APP_TOKEN_REFUSAL.error).toBe("app_token");
  });
});

describe("personBearer", () => {
  const person = token({ sub: "u1", role: "authenticated", session_id: "s" });
  const app = token({ sub: "u1", role: "authenticated", client_id: "c-123" });

  it("accepts a person's token and hands back exactly that token", () => {
    expect(personBearer(`Bearer ${person}`)).toEqual({ kind: "person", token: person });
    expect(personBearer(`bearer  ${person}`)).toEqual({ kind: "person", token: person });
  });

  it("refuses an app's token", () => {
    expect(personBearer(`Bearer ${app}`)).toEqual({ kind: "app" });
  });

  it("reads payloads that need base64url padding and characters", () => {
    expect(personBearer(`Bearer ${token({ sub: "ü?>", client_id: "a/b+c" })}`).kind).toBe("app");
  });

  it("treats a client_id of any value as an app", () => {
    for (const clientId of ["", 42, false, {}]) {
      expect(personBearer(`Bearer ${token({ sub: "u1", client_id: clientId })}`).kind).toBe("app");
    }
  });

  it("refuses a header with anything around the token", () => {
    for (const header of [
      ...spliced(app),
      ...spliced(`Bearer ${app}`).slice(7),
      `Bearer ${person} ${app}`,
      `Bearer ${person}\n`,
      ` Bearer ${person}`,
      `Token ${person}`,
      person,
      `Bearer ${person}.x`,
      `Bearer a.${Buffer.from("[]").toString("base64url")}.c`,
      `Bearer a.${Buffer.from("null").toString("base64url")}.c`,
      "Bearer a.%%%.c",
      "Bearer ",
      "",
      null,
      undefined,
    ]) {
      expect(personBearer(header).kind).toBe("unauthorized");
    }
  });
});

describe("verifiedPerson", () => {
  const person = token({ sub: "u1", role: "authenticated" });
  const app = token({ sub: "u1", role: "authenticated", client_id: "c-123" });
  // Stands in for Auth: accepts any well-formed three-part token, like getUser() would a valid one.
  function auth() {
    const seen: string[] = [];
    return {
      seen,
      getUser: async (jwt: string) => {
        seen.push(jwt);
        return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(jwt)
          ? { data: { user: { id: "u1" } }, error: null }
          : { data: { user: null }, error: new Error("invalid") };
      },
    };
  }

  it("verifies a person's token and returns the user", async () => {
    const a = auth();
    expect(await verifiedPerson(a, `Bearer ${person}`)).toEqual({ kind: "person", user: { id: "u1" } });
    expect(a.seen).toEqual([person]);
  });

  it("refuses an app's token without asking Auth", async () => {
    const a = auth();
    expect(await verifiedPerson(a, `Bearer ${app}`)).toEqual({ kind: "app" });
    expect(a.seen).toEqual([]);
  });

  it("refuses a header with text around an app's token without asking Auth", async () => {
    const a = auth();
    for (const header of [...spliced(app), ...spliced(`Bearer ${app}`).slice(7)]) {
      expect((await verifiedPerson(a, header)).kind).toBe("unauthorized");
    }
    expect(a.seen).toEqual([]);
  });

  it("answers unauthorized when Auth rejects the token", async () => {
    const reject = { getUser: async () => ({ data: { user: null }, error: new Error("expired") }) };
    expect(await verifiedPerson(reject, `Bearer ${person}`)).toEqual({ kind: "unauthorized" });
  });
});

describe("a table published to Realtime later refuses app tokens too", () => {
  // Realtime's postgres-changes reads through each table's RLS, and the
  // lockout migration covered only the tables published when it ran.
  const LOCKOUT = "20261022230000";
  const migrations = readdirSync(resolve(FUNCTIONS, "..", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const later = migrations
    .filter((f) => f.slice(0, 14) > LOCKOUT)
    .map((f) => readFileSync(resolve(FUNCTIONS, "..", "migrations", f), "utf8"));

  it("every ADD TABLE after the lockout comes with its app_tokens_refused policy", () => {
    const missing: string[] = [];
    later.forEach((sql) => {
      for (const m of sql.matchAll(/alter\s+publication\s+supabase_realtime\s+add\s+table\s+([^;]+)/gi)) {
        for (const table of m[1].split(",").map((t) => t.trim().replace(/^public\./i, ""))) {
          const policy = new RegExp(
            `create\\s+policy\\s+app_tokens_refused\\s+on\\s+(public\\.)?${table}\\s+as\\s+restrictive`,
            "i",
          );
          if (!later.some((s) => policy.test(s))) missing.push(table);
        }
      }
    });
    expect(missing).toEqual([]);
  });
});
