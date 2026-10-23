import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "@rstest/core";

import { APP_TOKEN_REFUSAL, appTokenClientId, isAppToken } from "./app-token.ts";

const FUNCTIONS = resolve(import.meta.dirname, "..");

function token(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "ES256", typ: "JWT" })}.${part(claims)}.signature`;
}

describe("appTokenClientId", () => {
  it("reads the client_id of an app's token, with or without Bearer", () => {
    const t = token({ sub: "u1", role: "authenticated", client_id: "c-123" });
    expect(appTokenClientId(t)).toBe("c-123");
    expect(appTokenClientId(`Bearer ${t}`)).toBe("c-123");
    expect(isAppToken(`bearer ${t}`)).toBe(true);
  });

  it("answers null for a person's own session", () => {
    expect(appTokenClientId(token({ sub: "u1", role: "authenticated", session_id: "s" }))).toBeNull();
    expect(isAppToken(token({ sub: "u1", client_id: "" }))).toBe(false);
    expect(isAppToken(token({ sub: "u1", client_id: 42 }))).toBe(false);
  });

  it("answers null for anything that isn't a token", () => {
    for (const bad of [null, undefined, "", "Bearer ", "abc", "a.%%%.c", "a.bnVsbA.c"]) {
      expect(appTokenClientId(bad)).toBeNull();
    }
  });

  it("reads payloads that need base64url padding and characters", () => {
    const claims = { sub: "ü?>", client_id: "a/b+c" };
    expect(appTokenClientId(token(claims))).toBe("a/b+c");
  });

  it("refuses with one body", () => {
    expect(APP_TOKEN_REFUSAL.error).toBe("app_token");
  });
});

describe("every function that accepts a person's token refuses an app's", () => {
  const dirs = readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name);

  it("finds the functions", () => {
    expect(dirs.length).toBeGreaterThan(10);
  });

  for (const dir of dirs) {
    let source = "";
    try {
      source = readFileSync(join(FUNCTIONS, dir, "index.ts"), "utf8");
    } catch {
      continue;
    }
    // moduo-mcp is the one place an app's token is meant to work (MCPO-3).
    if (dir === "moduo-mcp") continue;
    const takesPersonToken =
      /\.auth\.(getUser|getClaims)\(|\bjwtVerify\(|\bauthenticate\(/.test(source);
    if (!takesPersonToken) continue;
    it(`${dir} checks isAppToken before trusting the token`, () => {
      expect(source).toMatch(/import \{[^}]*\bisAppToken\b[^}]*\} from "\.\.\/_shared\/app-token\.ts"/);
      const check = source.search(/\bisAppToken\(/);
      const trust = source.search(/\.auth\.getUser\(|\bauthenticate\(/);
      expect(check).toBeGreaterThan(-1);
      expect(check).toBeLessThan(trust);
    });
  }

  it("billing's shared authenticate refuses an app's token too", () => {
    const billing = readFileSync(join(FUNCTIONS, "_shared", "billing.ts"), "utf8");
    expect(billing).toMatch(/isAppToken\(authHeader\)/);
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
