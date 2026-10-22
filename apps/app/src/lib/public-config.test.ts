import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "@rstest/core";

import {
  PUBLIC_CONFIG_KEYS,
  type PublicConfig,
  publicConfig,
  resetPublicConfigForTests,
  resolvePublicConfig,
} from "./public-config";

const BUILD: PublicConfig = {
  supabaseUrl: "https://build.supabase.co",
  supabasePublishableKey: "sb_publishable_build",
  stripePublishableKey: "pk_test_build",
  posthogKey: "",
  posthogHost: "",
  vapidPublicKey: "",
  webOrigin: "https://build.example",
  stagingPortal: "",
  desktopChannel: "",
};

describe("edge config wins, build-time fallback (AC7)", () => {
  it("uses every edge value it gets", () => {
    const edge: PublicConfig = {
      supabaseUrl: "https://edge.supabase.co",
      supabasePublishableKey: "sb_publishable_edge",
      stripePublishableKey: "pk_live_edge",
      posthogKey: "phc_edge",
      posthogHost: "https://eu.i.posthog.com",
      vapidPublicKey: "BEdge",
      webOrigin: "https://app.moduo.app",
      stagingPortal: "true",
      desktopChannel: "production",
    };
    expect(resolvePublicConfig(edge, BUILD)).toEqual(edge);
  });

  it("no edge object (desktop, dev) → the build-time values", () => {
    expect(resolvePublicConfig(undefined, BUILD)).toEqual(BUILD);
    expect(resolvePublicConfig(null, BUILD)).toEqual(BUILD);
  });

  it("a malformed edge object never empties a value", () => {
    for (const bad of ["oops", 42, [], true]) {
      expect(resolvePublicConfig(bad, BUILD)).toEqual(BUILD);
    }
    const partial = resolvePublicConfig(
      { webOrigin: "", posthogKey: 7, vapidPublicKey: " BKey " },
      BUILD,
    );
    expect(partial.webOrigin).toBe(BUILD.webOrigin);
    expect(partial.posthogKey).toBe("");
    expect(partial.vapidPublicKey).toBe("BKey");
  });

  it("the Supabase URL and key only come as a pair, never one project's URL with another's key", () => {
    const urlOnly = resolvePublicConfig({ supabaseUrl: "https://edge.supabase.co" }, BUILD);
    expect(urlOnly.supabaseUrl).toBe(BUILD.supabaseUrl);
    expect(urlOnly.supabasePublishableKey).toBe(BUILD.supabasePublishableKey);
    const keyOnly = resolvePublicConfig({ supabasePublishableKey: "sb_publishable_edge" }, BUILD);
    expect(keyOnly.supabasePublishableKey).toBe(BUILD.supabasePublishableKey);
  });

  it("an edge Supabase URL that isn't https is ignored", () => {
    const bad = resolvePublicConfig(
      { supabaseUrl: "javascript:alert(1)", supabasePublishableKey: "k" },
      BUILD,
    );
    expect(bad.supabaseUrl).toBe(BUILD.supabaseUrl);
    expect(bad.supabasePublishableKey).toBe(BUILD.supabasePublishableKey);
  });

  it("publicConfig() reads window.__MODUO_CONFIG__ once", () => {
    resetPublicConfigForTests();
    window.__MODUO_CONFIG__ = {
      supabaseUrl: "https://edge.supabase.co",
      supabasePublishableKey: "sb_publishable_edge",
      webOrigin: "https://app.staging.moduo.app",
    };
    const first = publicConfig();
    expect(first.supabaseUrl).toBe("https://edge.supabase.co");
    expect(first.webOrigin).toBe("https://app.staging.moduo.app");
    window.__MODUO_CONFIG__ = { webOrigin: "https://changed.example" };
    expect(publicConfig().webOrigin).toBe("https://app.staging.moduo.app");
  });
});

describe("one list of config keys", () => {
  it("the edge Worker injects exactly the keys the app reads", () => {
    const worker = readFileSync(join(__dirname, "../../edge/config.ts"), "utf8");
    for (const key of PUBLIC_CONFIG_KEYS) expect(worker).toContain(`${key}:`);
  });

  it("no app file reads import.meta.env.PUBLIC_* except this module", () => {
    const src = join(__dirname, "..");
    const hits = (readdirSync(src, { recursive: true }) as string[]).filter(
      (f) =>
        /\.tsx?$/.test(f) &&
        !/\.test\.tsx?$/.test(f) &&
        !f.endsWith("public-config.ts") &&
        readFileSync(join(src, f), "utf8").includes("import.meta.env.PUBLIC_"),
    );
    expect(hits).toEqual([]);
  });
});

afterEach(() => {
  window.__MODUO_CONFIG__ = undefined;
  resetPublicConfigForTests();
});
