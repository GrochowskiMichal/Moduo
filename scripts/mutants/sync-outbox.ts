#!/usr/bin/env bun
/**
 * Concern mutants for the sync outbox (HV-17, AC24): each one plants a bug
 * of a class that has bitten this code (an error read as empty data, an op
 * dropped on sign-out, a live update over a queued op, a skipped recompute),
 * runs the property harness (`apps/app/src/lib/sync/outbox.property.test.ts`
 * and `apps/app/src/lib/prefs-sync.property.test.ts`)
 * and counts it killed when the harness fails. `--reverts` instead undoes
 * each of the five #509 fixes, one at a time (as they stand in today's code,
 * after the kernel refactor moved them).
 *
 *   bun scripts/mutants/sync-outbox.ts            # the mutants
 *   bun scripts/mutants/sync-outbox.ts --reverts  # the five #509 fixes undone
 *   bun scripts/mutants/sync-outbox.ts --only M3  # one of either
 *
 * Every file is put back after each run, also on Ctrl-C. Nothing is committed.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Mutant = {
  id: string;
  concern: string;
  file: string;
  find: string;
  replace: string;
};

const STORE = "apps/app/src/lib/sync/store.ts";
const OUTBOX = "apps/app/src/lib/sync/kernel/outbox.ts";
const REGISTRY = "apps/app/src/lib/sync/kernel/registry.ts";
const PREFS = "apps/app/src/lib/prefs-sync.ts";
const PLAN = "apps/app/src/features/tasks/write-plan.ts";
const ROWS = "apps/app/src/lib/task-rows.ts";

export const MUTANTS: Mutant[] = [
  {
    id: "M1",
    concern: "error into empty: a later failed read empties the copy",
    file: STORE,
    find: "      this.syncError = message;\n",
    replace:
      "      this.syncError = message;\n      for (const t of this.tables.values()) t.forget([...t.rows.keys()]);\n",
  },
  {
    id: "M2",
    concern: "error into empty: a failed prefs read counts as no row",
    file: PREFS,
    find: '  if (read.kind === "error") return "error";\n',
    replace: "",
  },
  {
    id: "M3",
    concern: "op dropped on sign-out: check-offs left out of the kept outbox",
    file: STORE,
    find: "          if (!handled.has(entry.id)) outbox.push(entry);",
    replace: '          if (!handled.has(entry.id) && entry.kind !== "status") outbox.push(entry);',
  },
  {
    id: "M4",
    concern: "op dropped on sign-in: another person's sign-in deletes the first one's copies",
    file: REGISTRY,
    find: "      return keepOnlyWaiting((key) => !isOwnedBy(key, userId), leaving);",
    replace: "      return opts.copies().deleteWhere((key) => !isOwnedBy(key, userId));",
  },
  {
    id: "M5",
    concern: "op dropped on sign-out: wipe takes everything by default",
    file: REGISTRY,
    find: "      if (wipeOpts.keepWaiting === false) {",
    replace: "      if (wipeOpts.keepWaiting !== true) {",
  },
  {
    id: "M6",
    concern: "op dropped on sign-out: what the stopping stores held is ignored",
    file: REGISTRY,
    find: "        leaving.waiting.get(key) ?? [],",
    replace: "        [],",
  },
  {
    id: "M7",
    concern: "op dropped on a null session: stores stop without writing the copy",
    file: REGISTRY,
    find: "        dispose(() => false, true);",
    replace: "        dispose(() => false, false);",
  },
  {
    id: "M8",
    concern: "live over queued: a check-off goes live past a waiting one",
    file: STORE,
    find: "    if (this.offline || this.hasOutboxEntries(input.taskId)) return queue();",
    replace:
      '    if (this.offline || this.outbox.some((e) => e.kind === "create" && e.task.id === input.taskId)) return queue();',
  },
  {
    id: "M9",
    concern: "live over queued: the outbox sends its newest entry first",
    file: OUTBOX,
    find: "      const head = this.entries[0];",
    replace: "      const head = this.entries[this.entries.length - 1];",
  },
  {
    id: "M10",
    concern: "live over queued: the copy's older entries join behind this tab's",
    file: OUTBOX,
    find: "    this.entries = opts.first ? [...joined, ...this.entries] : [...this.entries, ...joined];",
    replace: "    this.entries = [...this.entries, ...joined];",
  },
  {
    id: "M11",
    concern: "live over queued: a Realtime echo lands over a write on its way",
    file: "apps/app/src/lib/sync/kernel/overlay.ts",
    find: "      if (row) map.set(o.patch.id, { ...row, ...o.patch.fields } as R);",
    replace: "      if (row) map.set(o.patch.id, { ...o.patch.fields, ...row } as R);",
  },
  {
    id: "M12",
    concern: "skipped recompute: a due-date edit keeps the old day",
    file: PLAN,
    find: "  const { occurrenceOn, ...change } = withDueOn(patch);",
    replace: "  const { occurrenceOn, ...change } = patch;",
  },
  {
    id: "M13",
    concern: "skipped recompute: withDueOn passes a due date through",
    file: ROWS,
    find: "  return { ...patch, dueOn: localDayOf(patch.dueDate) };",
    replace: "  return patch;",
  },
  {
    id: "M14",
    concern: "op dropped: a lost network drops the entry being sent",
    file: OUTBOX,
    find: "    if (run.isNetwork(res.error)) {\n      run.offline(entry, res.error);",
    replace:
      "    if (run.isNetwork(res.error)) {\n      outbox.remove(entry.id);\n      run.offline(entry, res.error);",
  },
  {
    id: "M15",
    concern: "op dropped: an entry leaves the outbox before its answer",
    file: OUTBOX,
    find: "    const res = await run.send(entry);\n    if (res.ok) {\n      const wasQueued = outbox.remove(entry.id) !== undefined;",
    replace:
      "    const wasQueued = outbox.remove(entry.id) !== undefined;\n    const res = await run.send(entry);\n    if (res.ok) {",
  },
  {
    id: "M16",
    concern: "op dropped: a live check-off that lost the network isn't queued",
    file: STORE,
    find: "        this.wentOffline();\n        return queue();",
    replace: '        this.wentOffline();\n        return "queued";',
  },
  {
    id: "M17",
    concern: "op dropped: a live capture that lost the network isn't queued",
    file: STORE,
    find: "        this.wentOffline();\n        return queueIt();",
    replace: "        this.wentOffline();\n        return { saved: null, queued: true };",
  },
  {
    id: "M18",
    concern: "decode error: an older build's copy drops what waited in it",
    file: STORE,
    find: "      this.adoptOutbox(copy.outbox, { first: true });\n      return;",
    replace: "      return;",
  },
  {
    id: "M19",
    concern: "decode error: one junk entry makes the whole stored outbox unreadable",
    file: OUTBOX,
    find: "    if (!Array.isArray(stored)) return [];\n",
    replace:
      '    if (!Array.isArray(stored) || stored.some((e) => !e || typeof e.id !== "string")) return [];\n',
  },
  {
    id: "M20",
    concern: "op dropped: the copy is written without this tab's outbox",
    file: STORE,
    find: "          outbox: [...outbox, ...theirs],",
    replace: "          outbox: [...theirs],",
  },
  {
    id: "M21",
    concern: "error into empty: a refused prefs push is taken as saved",
    file: PREFS,
    find: '  } catch {\n    return { kind: "failed" };\n  }\n}',
    replace: '  } catch {\n    return { kind: "saved" };\n  }\n}',
  },
  {
    id: "M22",
    concern: "seeded over: another person's newer local prefs win over the account",
    file: PREFS,
    find: "    if (ownedBySelf && toMillis(meta.updatedAt) > toMillis(cloudUpdatedAt)) {",
    replace: "    if (toMillis(meta.updatedAt) > toMillis(cloudUpdatedAt)) {",
  },
  {
    id: "M23",
    concern: "live over queued: a queued check-off's overlay goes before its answer lands",
    file: STORE,
    find: "          this.applyAnswers(answers);\n          if (op !== undefined) this.dropOverlays(op);",
    replace:
      "          if (op !== undefined) this.dropOverlays(op);\n          this.changed();\n          this.applyAnswers(answers);",
  },
  {
    id: "M24",
    concern: "op dropped: a refusal-free flush stops after the first entry",
    file: OUTBOX,
    find: "      run.sent(entry, res.value, wasQueued);\n      continue;",
    replace: "      run.sent(entry, res.value, wasQueued);\n      return;",
  },
];

/** The five #509 fixes, each undone as it stands today. */
export const REVERTS: Mutant[] = [
  {
    id: "R1",
    concern: "#509-1 prefs: a failed cloud read passes for 'no row' (.catch(() => null))",
    file: PREFS,
    find: '      (error: unknown): CloudPrefsRead => ({ kind: "error", error }),',
    replace: '      (): CloudPrefsRead => ({ kind: "none" }),',
  },
  {
    id: "R2",
    concern: "#509-2 a live check-off can jump an older queued one (isQueuedCreate only)",
    file: STORE,
    find: "    if (this.offline || this.hasOutboxEntries(input.taskId)) return queue();",
    replace: "    if (this.offline || this.isQueuedCreate(input.taskId)) return queue();",
  },
  {
    id: "R3",
    concern: "#509-3 SIGNED_OUT (and another person's sign-in) wipes offline captures",
    file: REGISTRY,
    find: "      const leaving = waitingByKey((store) => store.userId !== userId);\n      dispose((store) => store.userId === userId, false);\n      return keepOnlyWaiting((key) => !isOwnedBy(key, userId), leaving);",
    replace:
      "      dispose((store) => store.userId === userId, false);\n      return opts.copies().deleteWhere((key) => !isOwnedBy(key, userId));",
  },
  {
    id: "R4",
    concern: "#509-4 a single due-date edit leaves dueOn stale (no withDueOn)",
    file: PLAN,
    find: "  const { occurrenceOn, ...change } = withDueOn(patch);",
    replace: "  const { occurrenceOn, ...change } = patch;",
  },
  {
    id: "R5",
    concern: "#509-5 desktop: an undecodable email account list reads empty (Rust)",
    file: "apps/desktop/src-tauri/src/commands/email/storage.rs",
    find: '            .map_err(|e| format!("email_accounts_unreadable: {e}")),',
    replace: "            .or_else(|_| Ok(vec![])),",
  },
];

// R3 undoes both halves of the sign-out fix: the sign-out wipe goes too.
const R3_WIPE: Mutant = {
  id: "R3",
  concern: "",
  file: REGISTRY,
  find: "      const leaving = waitingByKey(() => true);\n      dispose(() => false, false);\n      return keepOnlyWaiting(() => true, leaving);",
  replace: "      dispose(() => false, false);\n      return opts.copies().clear();",
};

const root = path.resolve(import.meta.dirname, "../..");
const originals = new Map<string, string>();

function restore() {
  for (const [file, text] of originals) fs.writeFileSync(path.join(root, file), text);
  originals.clear();
}
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});

function apply(m: Mutant): void {
  const abs = path.join(root, m.file);
  const text = originals.get(m.file) ?? fs.readFileSync(abs, "utf8");
  if (!originals.has(m.file)) originals.set(m.file, text);
  const current = fs.readFileSync(abs, "utf8");
  const count = current.split(m.find).length - 1;
  if (count !== 1) throw new Error(`${m.id}: expected the text once in ${m.file}, found ${count}`);
  fs.writeFileSync(abs, current.replace(m.find, m.replace));
}

function harness(): { killed: boolean; ms: number; why: string } {
  const started = Date.now();
  const res = spawnSync(
    "bun",
    [
      "x",
      "rstest",
      "run",
      "src/lib/sync/outbox.property.test.ts",
      "src/lib/prefs-sync.property.test.ts",
    ],
    {
      cwd: path.join(root, "apps/app"),
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    },
  );
  const out = `${res.stdout}\n${res.stderr}`;
  const why =
    out.match(/Got (?:AssertionError|error|Error): ([^\n\\]*)/)?.[1]?.slice(0, 110) ??
    (res.status === 0 ? "" : "failed");
  return { killed: res.status !== 0, ms: Date.now() - started, why };
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  const set = args.includes("--reverts") || only?.startsWith("R") ? REVERTS : MUTANTS;
  const picked = set.filter((m) => !only || m.id === only);
  let killed = 0;
  for (const m of picked) {
    let result: ReturnType<typeof harness>;
    try {
      apply(m);
      if (m.id === "R3") apply(R3_WIPE);
      result = harness();
    } finally {
      restore();
    }
    if (result.killed) killed += 1;
    console.log(
      `${m.id.padEnd(4)} ${result.killed ? "KILLED  " : "SURVIVED"} ${(result.ms / 1000).toFixed(1)}s  ${m.concern}${result.why ? `\n       ↳ ${result.why}` : ""}`,
    );
  }
  console.log(`\n${killed}/${picked.length} killed`);
}

if (import.meta.main) main();
