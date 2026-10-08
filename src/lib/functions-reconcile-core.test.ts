import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "@rstest/core";

import {
  COMMITTED_FUNCTIONS_GIT_ARGS,
  compareFunctions,
  type DeployedFunction,
  failsCheck,
  formatReport,
  isHeaderSafe,
  KNOWN_EXTERNAL_FUNCTIONS,
  parseDeployedFunctions,
  redact,
  repoFunctionsFromPaths,
  untrustworthyList,
} from "./functions-reconcile-core";

// Guard for `bun run functions:reconcile`. Its failure mode is a check that passes when it
// shouldn't: a parse that returns [], a repo scan that counts too much, or an allowlist that
// swallows a slug all read as "no orphans". These cases pin what makes a clean run mean
// something.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// Entrypoints as prod reports them: a CLI deploy from a checkout keeps the repo path, while
// the Sync Engine's own functions (and some MCP deploys) sit at source/index.ts.
const fromCheckout = (slug: string) =>
  `file:///tmp/user_fn_ref_1/source/supabase/functions/${slug}/index.ts`;
const fromBundle = "file:///tmp/user_fn_ref_1/source/index.ts";

const fn = (slug: string, extra: Partial<DeployedFunction> = {}): DeployedFunction => ({
  slug,
  status: "ACTIVE",
  version: 1,
  updatedAt: Date.UTC(2026, 9, 7),
  entrypointPath: fromCheckout(slug),
  ...extra,
});
const integration = (slug: string) => fn(slug, { entrypointPath: fromBundle });

describe("parseDeployedFunctions", () => {
  it("reads the Management API shape, which the CLI's `-o json` prints unchanged", () => {
    const raw = [
      {
        id: "00000000-0000-0000-0000-000000000000",
        slug: "delete-account",
        name: "delete-account",
        status: "ACTIVE",
        version: 15,
        created_at: 1788118859971,
        updated_at: 1791334729582,
        verify_jwt: false,
        import_map: false,
        entrypoint_path: fromBundle,
      },
    ];
    expect(parseDeployedFunctions(raw)).toEqual([
      {
        slug: "delete-account",
        status: "ACTIVE",
        version: 15,
        updatedAt: 1791334729582,
        entrypointPath: fromBundle,
      },
    ]);
  });

  it("throws on anything that is not a list, instead of reading it as zero functions", () => {
    expect(() => parseDeployedFunctions({ message: "Unauthorized" })).toThrow(/JSON array/);
    expect(() => parseDeployedFunctions({ functions: [] })).toThrow(/JSON array/);
    expect(() => parseDeployedFunctions(null)).toThrow(/JSON array/);
  });

  it("throws on an entry without a slug, since it can't be compared", () => {
    expect(() => parseDeployedFunctions([{ name: "x" }])).toThrow(/#0 has no slug/);
    expect(() => parseDeployedFunctions([{ slug: "" }])).toThrow(/#0 has no slug/);
    expect(() => parseDeployedFunctions(["delete-account"])).toThrow(/#0 has no slug/);
  });

  it("keeps a function whose display fields are missing", () => {
    expect(parseDeployedFunctions([{ slug: "a" }])).toEqual([
      { slug: "a", status: "UNKNOWN", version: null, updatedAt: null, entrypointPath: null },
    ]);
  });
});

describe("repoFunctionsFromPaths", () => {
  it("counts slug folders with an index.ts, and never _shared/ or deno.json", () => {
    const { functions, skipped } = repoFunctionsFromPaths([
      "supabase/functions/deno.json",
      "supabase/functions/_shared/billing.ts",
      "supabase/functions/_shared/contracts/index.ts",
      "supabase/functions/waitlist-join/index.ts",
      "supabase/functions/moduo-mcp/index.ts",
      "supabase/functions/moduo-mcp/modules/tasks.ts",
      "supabase/migrations/20261007000830_founders_interest_revoke_client_grants.sql",
    ]);
    expect(functions).toEqual(["moduo-mcp", "waitlist-join"]);
    expect(skipped).toEqual([]);
  });

  it("names folders the CLI wouldn't deploy: no index.ts at the top, or a bad slug", () => {
    const { functions, skipped } = repoFunctionsFromPaths([
      "supabase/functions/tests/helpers.ts",
      "supabase/functions/nested/src/index.ts",
      "supabase/functions/9lives/index.ts",
      "supabase/functions/.vscode/settings.json",
      "supabase/functions/_utils/x.ts",
    ]);
    expect(functions).toEqual([]);
    expect(skipped).toEqual(["9lives", "nested", "tests"]);
  });
});

describe("untrustworthyList", () => {
  it("refuses an empty deployed list while the repo has functions", () => {
    expect(untrustworthyList([], ["waitlist-join"])).toMatch(/empty but the repo has 1 functions/);
  });

  it("accepts any non-empty list, and an empty one against an empty repo", () => {
    expect(untrustworthyList([fn("a")], ["a", "b"])).toBeNull();
    expect(untrustworthyList([], [])).toBeNull();
  });
});

describe("compareFunctions", () => {
  it("reports the founders-apply case as an orphan and fails", () => {
    const drift = compareFunctions(
      [fn("waitlist-join"), fn("founders-apply"), integration("stripe-webhook")],
      ["waitlist-join"],
    );
    expect(drift.orphans.map((f) => f.slug)).toEqual(["founders-apply"]);
    expect(drift.inSync.map((f) => f.slug)).toEqual(["waitlist-join"]);
    expect(failsCheck(drift)).toBe(true);
  });

  it("puts the Sync Engine's slugs in the external group, never in orphans", () => {
    const drift = compareFunctions(
      [
        integration("stripe-worker"),
        integration("stripe-webhook"),
        integration("stripe-setup"),
        fn("waitlist-join"),
      ],
      ["waitlist-join"],
    );
    expect(drift.orphans).toEqual([]);
    expect(drift.external.map((e) => [e.slug, e.deployed?.slug ?? null])).toEqual([
      ["stripe-setup", "stripe-setup"],
      ["stripe-webhook", "stripe-webhook"],
      ["stripe-worker", "stripe-worker"],
    ]);
    expect(drift.external.some((e) => e.replaced)).toBe(false);
    expect(failsCheck(drift)).toBe(false);
  });

  it("allowlists exact slugs only, not inherited object keys or prefixes", () => {
    const drift = compareFunctions([fn("constructor"), fn("stripe-webhook-v2")], []);
    expect(drift.orphans.map((f) => f.slug)).toEqual(["constructor", "stripe-webhook-v2"]);
  });

  it("fails when an integration's function was redeployed from a checkout", () => {
    // What `supabase functions deploy` from origin/main would do: main still has stripe-webhook/.
    const drift = compareFunctions([fn("stripe-webhook")], []);
    expect(drift.external.find((e) => e.slug === "stripe-webhook")?.replaced).toBe(true);
    expect(drift.orphans).toEqual([]);
    expect(failsCheck(drift)).toBe(true);
  });

  it("flags any entrypoint but the integration's own, and can't judge a missing one", () => {
    // The slug-folder shape is what the MCP connector gave delete-account on 2026-10-07.
    const drift = compareFunctions(
      [
        integration("stripe-setup"),
        fn("stripe-webhook", {
          entrypointPath: "file:///tmp/user_fn_ref_1/source/stripe-webhook/index.ts",
        }),
        fn("stripe-worker", { entrypointPath: null }),
      ],
      [],
    );
    const replaced = drift.external.filter((e) => e.replaced).map((e) => e.slug);
    expect(replaced).toEqual(["stripe-webhook"]);
  });

  it("reports a repo function with nothing deployed without failing", () => {
    const drift = compareFunctions([integration("stripe-webhook")], ["brand-new", "waitlist-join"]);
    expect(drift.notDeployed).toEqual(["brand-new", "waitlist-join"]);
    expect(failsCheck(drift)).toBe(false);
  });

  it("shows an allowlisted slug that isn't deployed, without failing", () => {
    const drift = compareFunctions([fn("waitlist-join")], ["waitlist-join"]);
    expect(drift.external.every((e) => e.deployed === null)).toBe(true);
    expect(failsCheck(drift)).toBe(false);
  });

  it("fails when a repo folder takes an integration's slug, and doesn't call it in sync", () => {
    const drift = compareFunctions([integration("stripe-webhook")], ["stripe-webhook"]);
    expect(drift.collisions).toEqual(["stripe-webhook"]);
    expect(drift.inSync).toEqual([]);
    expect(drift.notDeployed).toEqual([]);
    expect(failsCheck(drift)).toBe(true);
  });
});

describe("token handling", () => {
  it("only lets visible ASCII into the Authorization header", () => {
    expect(isHeaderSafe("sbp_0123456789abcdef")).toBe(true);
    expect(isHeaderSafe("“sbp_0123456789abcdef”")).toBe(false);
    expect(isHeaderSafe("sbp_one\nsbp_two")).toBe(false);
    expect(isHeaderSafe("sbp_one sbp_two")).toBe(false);
    expect(isHeaderSafe("")).toBe(false);
  });

  it("redacts every copy of the token, as in the error fetch throws for a bad header", () => {
    const token = "“sbp_secret”";
    const message = `Header '14' has invalid value: 'Bearer ${token}' (${token})`;
    expect(redact(message, token)).toBe(
      "Header '14' has invalid value: 'Bearer <redacted>' (<redacted>)",
    );
    expect(redact("HTTP 401", "")).toBe("HTTP 401");
  });
});

describe("formatReport", () => {
  const opts = { projectRef: "wtoonrvuqumihpkbvwvs", source: "a fixture" };

  it("prints all three groups and OK on a clean run", () => {
    const report = formatReport(
      compareFunctions(
        [fn("waitlist-join"), fn("stripe-webhook", { version: 41, entrypointPath: fromBundle })],
        ["waitlist-join"],
      ),
      opts,
    );
    expect(report).toContain("Deployed but not in the repo (orphans): none");
    expect(report).toContain("In the repo but not deployed: none");
    expect(report).toContain("Known external, not built from this repo (3):");
    expect(report).toMatch(
      /stripe-webhook\s+ACTIVE v41, deployed 2026-10-07\s+installed by the Stripe Sync Engine integration/,
    );
    expect(report).toMatch(/stripe-worker\s+not deployed/);
    expect(report).toContain(
      "Deployed and in the repo: 1 (names only; the deployed code is not compared)",
    );
    expect(report).toContain("OK:");
    expect(report).not.toContain("FAIL");
  });

  it("names each orphan and the steps to take, without claiming to have done any", () => {
    const report = formatReport(compareFunctions([fn("founders-apply")], []), opts);
    expect(report).toContain("Deployed but not in the repo (orphans) (1):");
    expect(report).toMatch(/founders-apply\s+ACTIVE v1/);
    expect(report).toContain("FAIL: 1 deployed function is not on the allowlist");
    expect(report).toContain("after a git fetch:");
    expect(report).toContain("git log --all --oneline -- supabase/functions/<slug>/");
    expect(report).toContain("supabase functions delete <slug> --project-ref wtoonrvuqumihpkbvwvs");
    expect(report).toContain("It never deploys or deletes anything.");
    expect(report).not.toContain("OK:");
  });

  it("explains a collision and lists folders it didn't count", () => {
    const report = formatReport(compareFunctions([], ["stripe-webhook"]), {
      ...opts,
      skipped: ["tests"],
    });
    expect(report).toContain(
      "FAIL: supabase/functions/stripe-webhook/ uses the slug of a function installed by the Stripe Sync Engine integration.",
    );
    expect(report).toContain(
      "Not counted as functions (a function needs a slug name and an index.ts): tests",
    );
  });

  it("explains an integration's function that something else replaced", () => {
    const report = formatReport(compareFunctions([fn("stripe-webhook")], []), opts);
    expect(report).toMatch(
      /stripe-webhook\s+ACTIVE v1, deployed 2026-10-07, NOT THE INTEGRATION'S BUILD/,
    );
    expect(report).toContain(
      "FAIL: the deployed stripe-webhook does not have the …/source/index.ts entrypoint of the Stripe Sync Engine integration's own deploys",
    );
    expect(report).toContain(`Its entrypoint: ${fromCheckout("stripe-webhook")}`);
  });

  it("says when it can't tell whether an integration's function was replaced", () => {
    const report = formatReport(
      compareFunctions([fn("stripe-worker", { entrypointPath: null })], []),
      opts,
    );
    expect(report).toContain(
      "Can't tell whether stripe-worker is still the build the Stripe Sync Engine integration deployed",
    );
    expect(report).toContain("OK:");
  });

  it("flags an in-sync function that isn't ACTIVE", () => {
    const report = formatReport(
      compareFunctions([fn("waitlist-join", { status: "THROTTLED" })], ["waitlist-join"]),
      opts,
    );
    expect(report).toContain("Not ACTIVE: waitlist-join (THROTTLED)");
  });

  it("drops a timestamp that isn't a date instead of throwing", () => {
    const report = formatReport(compareFunctions([fn("x", { updatedAt: 1e20 })], []), opts);
    expect(report).toMatch(/x\s+ACTIVE v1\n/);
  });
});

// The same committed tree, read with the same arguments, as the script.
const committedPaths = execFileSync("git", [...COMMITTED_FUNCTIONS_GIT_ARGS], {
  cwd: REPO_ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);
const repoScan = repoFunctionsFromPaths(committedPaths);

describe("the repo's own supabase/functions/", () => {
  it("is read as functions, with _shared/ and deno.json left out", () => {
    expect(committedPaths).toContain("supabase/functions/deno.json");
    expect(repoScan.functions).toContain("delete-account");
    expect(repoScan.functions).not.toContain("_shared");
    expect(repoScan.functions).not.toContain("deno.json");
    expect(
      repoScan.skipped,
      "every folder under supabase/functions/ must be a deployable function (a slug name and an index.ts); shared code goes in _shared/",
    ).toEqual([]);
  });

  it("has no folder named like a function an integration installed", () => {
    // Deploying such a folder would overwrite the integration's function (the Sync Engine
    // owns `stripe-webhook` since 2026-10-06). The live check fails on this too; this catches
    // it in `bun run verify`, before anyone can deploy it.
    expect(
      repoScan.functions.filter((slug) => KNOWN_EXTERNAL_FUNCTIONS.has(slug)),
      "rename or remove the folder: an integration owns that slug on prod",
    ).toEqual([]);
  });
});

// The script's own contract: the exit codes CI will rely on, and a token that never gets
// printed. Every run here reads a fixture or stops before fetch, so none of them calls Supabase.
describe("scripts/functions-reconcile.ts", () => {
  const dir = mkdtempSync(join(tmpdir(), "functions-reconcile-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const fixture = (name: string, list: unknown) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(list));
    return path;
  };
  const listed = (slug: string, entrypoint: string) => ({
    slug,
    status: "ACTIVE",
    version: 1,
    updated_at: Date.UTC(2026, 9, 8),
    entrypoint_path: entrypoint,
  });
  const cleanList = [
    ...repoScan.functions.map((slug) => listed(slug, fromCheckout(slug))),
    ...[...KNOWN_EXTERNAL_FUNCTIONS.keys()].map((slug) => listed(slug, fromBundle)),
  ];
  const run = (args: string[], token?: string) => {
    const { SUPABASE_ACCESS_TOKEN: _, ...env } = process.env;
    const result = spawnSync("bun", ["scripts/functions-reconcile.ts", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: token === undefined ? env : { ...env, SUPABASE_ACCESS_TOKEN: token },
    });
    expect(result.error, "bun must be on PATH to run the script").toBeUndefined();
    return result;
  };

  it("exits 0 on a clean list", () => {
    const result = run(["--fixture", fixture("clean.json", cleanList)]);
    expect(result.stdout).toContain("OK:");
    expect(result.status).toBe(0);
  }, 30_000);

  it("exits 1 on an orphan", () => {
    const list = [...cleanList, listed("founders-apply", fromCheckout("founders-apply"))];
    const result = run(["--fixture", fixture("orphan.json", list)]);
    expect(result.stdout).toContain("founders-apply");
    expect(result.status).toBe(1);
  }, 30_000);

  it("exits 2, not 0, on an empty list", () => {
    const result = run(["--fixture", fixture("empty.json", [])]);
    expect(result.stderr).toContain("the deployed list is empty");
    expect(result.status).toBe(2);
  }, 30_000);

  it("refuses a malformed token before sending it, and never prints it", () => {
    const result = run([], "“sbp_not-a-real-token”");
    expect(result.stderr).toContain("so it was not sent");
    expect(`${result.stdout}${result.stderr}`).not.toContain("sbp_not-a-real-token");
    expect(result.status).toBe(2);
  }, 30_000);
});
