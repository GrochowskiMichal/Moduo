#!/usr/bin/env bun
// Regenerate apps/app/src/types/supabase.ts, the `Database` type behind the typed
// Supabase client (apps/app/src/lib/runtime.db.ts).
//
//   bun run db:types         # from prod (read-only; needs `supabase login` once)
//   bun run db:types:local   # from the local stack, for a migration not on prod yet
//
// Prod is the default because it is what the shipped app talks to; the shared
// local stack can lag prod or carry another session's unmerged migration.
//
// One post-processing step: the generator types every RPC argument as non-null
// (`p_x?: string`), but Postgres passes NULL to any argument and the runtime
// sends `null` on purpose (to clear a field, or as "no value" for a defaulted
// argument). Each `Args` member therefore gets `| null`, so the types match what
// the database accepts and call sites keep their exact behaviour.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const OUT = "apps/app/src/types/supabase.ts";
const PROD_REF = "wtoonrvuqumihpkbvwvs";

/** Index just past the `{ … }` that opens at `start`. */
function matchBrace(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return i + 1;
  }
  throw new Error(`db-types: unbalanced brace at ${start}`);
}

/** `{ a: T; b?: U }` → `{ a: T | null; b?: U | null }` (top-level members only). */
function nullableMembers(obj: string): string {
  const inner = obj.slice(1, -1);
  let out = "";
  let depth = 0;
  let member = "";
  const flush = (sep: string) => {
    const m = member.match(/^(\s*[A-Za-z_][\w]*\??:\s*)([\s\S]*?)(\s*)$/);
    out += m && !/\bnull\b/.test(m[2]) ? `${m[1]}${m[2]} | null${m[3]}${sep}` : member + sep;
    member = "";
  };
  for (const ch of inner) {
    if ("{[(<".includes(ch)) depth++;
    if ("}])>".includes(ch)) depth--;
    if (depth === 0 && (ch === ";" || ch === "\n")) flush(ch);
    else member += ch;
  }
  flush("");
  return `{${out}}`;
}

export function nullableRpcArgs(src: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const at = src.indexOf("Args:", i);
    if (at < 0) return out + src.slice(i);
    let j = at + "Args:".length;
    out += src.slice(i, j);
    // One object, or a union of overloads: `| { … } | { … }`.
    for (;;) {
      const ws = src.slice(j).match(/^\s*(\|\s*)?/)?.[0] ?? "";
      if (src[j + ws.length] !== "{") break;
      const end = matchBrace(src, j + ws.length);
      out += ws + nullableMembers(src.slice(j + ws.length, end));
      j = end;
    }
    i = j;
  }
}

if (import.meta.main) {
  const local = process.argv.includes("--local");
  const source = local ? ["--local"] : ["--project-id", PROD_REF];
  const gen = spawnSync(
    "supabase",
    ["gen", "types", "typescript", ...source, "--schema", "public"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (gen.status !== 0 || !gen.stdout.includes("export type Database")) {
    console.error(
      `✗ supabase gen types failed (${local ? "is the local stack up? bun run local:up" : "run `supabase login` first"}).`,
    );
    process.exit(1);
  }
  writeFileSync(OUT, nullableRpcArgs(gen.stdout));
  console.log(`✓ ${OUT} regenerated from ${local ? "the local stack" : "prod"}.`);
}
