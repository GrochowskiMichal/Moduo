import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import {
  SEARCH_PREFIX_MIN_LETTERS,
  SEARCH_QUERY_MAX_CHARS,
  SEARCH_QUERY_MAX_WORDS,
  SEARCH_SNIPPET_END,
  SEARCH_SNIPPET_START,
  isSearchHit,
  normalizeSearchHit,
  parseSearchHit,
} from "./search.ts";
import {
  SEARCH_MATCHES,
  isSearchMatch,
  normalizeSearchMatch,
  parseSearchMatch,
} from "./vocabularies.ts";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../migrations");

const hit = {
  entity_type: "note",
  entity_id: "6f1c2a4e-1b8f-4c55-9d1e-2f0e8f3a7b10",
  title: "Q4 planning",
  context: "… / Strategy",
  snippet: `the ${SEARCH_SNIPPET_START}planning${SEARCH_SNIPPET_END} doc`,
  icon: null,
  match: "body",
  rank: 0.42,
  updated_at: "2026-10-28T09:00:00.123456+00:00",
};

// GS-1 (specs/global-search.md, Assumption 2): one row shape every
// <module>__search returns and search_all merges.
describe("search hit row and match vocabulary", () => {
  it("the match vocabulary is closed: handle, title, title_fuzzy, body", () => {
    expect([...SEARCH_MATCHES]).toEqual(["handle", "title", "title_fuzzy", "body"]);
    for (const m of SEARCH_MATCHES) {
      expect(isSearchMatch(m)).toBe(true);
      expect(parseSearchMatch(m).success).toBe(true);
      expect(normalizeSearchMatch(m)).toBe(m);
    }
  });

  it("parseSearchMatch is strict, normalizeSearchMatch is lax", () => {
    for (const bad of ["fuzzy", "Title", " body", "", null, undefined, 3]) {
      expect(isSearchMatch(bad)).toBe(false);
      expect(parseSearchMatch(bad).success).toBe(false);
    }
    expect(normalizeSearchMatch(" Title ")).toBe("title");
    expect(normalizeSearchMatch("TITLE_FUZZY")).toBe("title_fuzzy");
    // An unknown match claims the least: a body hit.
    expect(normalizeSearchMatch("semantic")).toBe("body");
    expect(normalizeSearchMatch(null)).toBe("body");
    expect(normalizeSearchMatch(7)).toBe("body");
  });

  it("parses a well-formed hit strictly, nullable fields as null", () => {
    const parsed = parseSearchHit(hit);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toEqual(hit);
    expect(isSearchHit(hit)).toBe(true);
    const bare = { ...hit, context: null, snippet: null, icon: null, match: "title" };
    expect(parseSearchHit(bare).success).toBe(true);
  });

  it("strict parse refuses an unknown match, a rank outside 0..1, or a missing field", () => {
    expect(parseSearchHit({ ...hit, match: "semantic" }).success).toBe(false);
    expect(parseSearchHit({ ...hit, rank: 1.5 }).success).toBe(false);
    expect(parseSearchHit({ ...hit, rank: -0.1 }).success).toBe(false);
    expect(parseSearchHit({ ...hit, rank: Number.NaN }).success).toBe(false);
    expect(parseSearchHit({ ...hit, entity_type: "" }).success).toBe(false);
    expect(parseSearchHit({ ...hit, entity_id: "" }).success).toBe(false);
    const { snippet: _omit, ...noSnippet } = hit;
    expect(parseSearchHit(noSnippet).success).toBe(false);
    expect(parseSearchHit(null).success).toBe(false);
    expect(isSearchHit({ ...hit, match: "semantic" })).toBe(false);
  });

  it("entity_type stays an open string", () => {
    expect(parseSearchHit({ ...hit, entity_type: "some_future_type" }).success).toBe(true);
  });

  it("normalize reads loosely: unknown match to body, rank clamped, missing nullables to null", () => {
    const { context: _c, snippet: _s, icon: _i, ...core } = hit;
    expect(normalizeSearchHit({ ...core, match: "semantic", rank: 3 })).toEqual({
      ...core,
      context: null,
      snippet: null,
      icon: null,
      match: "body",
      rank: 1,
    });
    expect(normalizeSearchHit({ ...hit, rank: -2 })?.rank).toBe(0);
    expect(normalizeSearchHit({ ...hit, rank: "0.5" })?.rank).toBe(0.5);
    expect(normalizeSearchHit({ ...hit, rank: "nope" })?.rank).toBe(0);
    expect(normalizeSearchHit({ ...hit, title: null })?.title).toBe("");
  });

  it("normalize drops a row it can't open (no type or id), and never throws", () => {
    expect(normalizeSearchHit({ ...hit, entity_id: null })).toBeNull();
    expect(normalizeSearchHit({ ...hit, entity_type: "" })).toBeNull();
    expect(normalizeSearchHit(null)).toBeNull();
    expect(normalizeSearchHit("hit")).toBeNull();
    expect(normalizeSearchHit([])).toBeNull();
  });

  it("the snippet markers are U+E000 and U+E001", () => {
    expect(SEARCH_SNIPPET_START).toBe("");
    expect(SEARCH_SNIPPET_END).toBe("");
  });

  it("the query bounds match the search primitives migration", () => {
    const file = readdirSync(MIGRATIONS_DIR).find((f) => f.endsWith("_search_primitives.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file ?? ""), "utf8");
    expect(SEARCH_QUERY_MAX_CHARS).toBe(256);
    expect(SEARCH_QUERY_MAX_WORDS).toBe(32);
    expect(SEARCH_PREFIX_MIN_LETTERS).toBe(3);
    expect(sql).toContain(`pg_catalog.left(p_query, ${SEARCH_QUERY_MAX_CHARS})`);
    expect(sql).toContain(`[1:${SEARCH_QUERY_MAX_WORDS}]`);
    expect(sql).toContain(`{${SEARCH_PREFIX_MIN_LETTERS},}`);
    expect(sql).toContain("pg_catalog.chr(57344)");
    expect(sql).toContain("pg_catalog.chr(57345)");
  });
});
