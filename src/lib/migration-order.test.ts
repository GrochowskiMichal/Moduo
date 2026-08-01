import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// A repo-hygiene guard, not a unit test — there is no `migration-order.ts` to import.
// It lives under src/ only because vitest.config.ts scopes `include` to `src/**/*.test.ts`.
//
// OPS-1. Supabase applies `supabase/migrations/*.sql` in lexicographic filename order,
// so a timestamp prefix shared by two files leaves the apply order of that pair
// UNDEFINED on a fresh bootstrap. Two collisions had already landed (20260702160000 ×2,
// 20260712120000 ×2) before anyone noticed, because nothing in `bun run verify` looks at
// this directory — the SQL never runs here (gotchas §Supabase). This is that missing
// check: it fails the build the moment a new migration reuses a stamp, instead of a
// future `supabase db reset` silently producing a different schema than prod.
//
// Resolved off this file's own location, NOT process.cwd(): the vitest worker inherits
// the launch cwd, so `vitest run --root ..` from a subdirectory would look in the wrong
// place. `bun run verify` happens to be safe (bun chdirs to the package root) — don't
// rely on that.
const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);

const listMigrations = () =>
  readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

describe("supabase/migrations", () => {
  it("resolves the migrations directory and finds migrations in it", () => {
    // Read inside the test (not at module scope) so a bad path fails as ONE readable
    // assertion rather than throwing during collection and skipping the whole file.
    expect(() => listMigrations()).not.toThrow();
    expect(listMigrations().length).toBeGreaterThan(0);
  });

  it("names every migration <14-digit-timestamp>_<snake_case>.sql", () => {
    const malformed = listMigrations().filter((name) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(name));
    expect(
      malformed,
      "migration filenames must be <14-digit-timestamp>_<snake_case>.sql — rename these (note `supabase migration new addFooBar` emits camelCase verbatim)",
    ).toEqual([]);
  });

  it("gives every migration a UNIQUE timestamp so the apply order is total", () => {
    const byStamp = new Map<string, string[]>();
    for (const name of listMigrations()) {
      const stamp = name.slice(0, 14);
      byStamp.set(stamp, [...(byStamp.get(stamp) ?? []), name]);
    }
    const collisions = [...byStamp.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([stamp, names]) => `${stamp}: ${names.join(", ")}`);
    expect(
      collisions,
      "two migrations share a timestamp, so their apply order is undefined on a fresh DB — re-stamp the one whose SQL is idempotent, keeping the stamp any prod-apply record names",
    ).toEqual([]);
  });
});
