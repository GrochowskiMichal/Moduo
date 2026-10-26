// The docs eval's grader (specs/harness-v3.md, HV-13, AC32): one question's answer against its key in
// questions.jsonl. No model: every `must` group needs one matching pattern, and no `stale` pattern
// may match (the answer an agent gives when it stops at a superseded decision).
//
//   bun scripts/evals/docs/grade.ts <id> [answer-file]    (default: $HARNESS_AB_ANSWER; exit 0 = pass)

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const EVAL_DIR = path.dirname(new URL(import.meta.url).pathname);
export const QUESTIONS = path.join(EVAL_DIR, "questions.jsonl");

export type Kind = "how" | "why" | "id" | "status";

export type Question = {
  /** E01…E46: the transcript study's numbering, kept when a question was replaced. */
  id: string;
  kind: Kind;
  question: string;
  /** Where the answer lives at the base commit, for people; the grader never reads it. */
  source: string;
  /** A correct answer, in prose. It must pass its own key (the self-test). */
  gold: string;
  /** Each group is a fact; the answer must match at least one pattern of every group. */
  must: string[][];
  /** Patterns only an outdated answer contains. */
  stale?: string[];
  /** An answer from the superseded decision; it must fail the key (the self-test). */
  staleAnswer?: string;
  /** The repository doesn't answer it: a correct answer says so. */
  abstain?: boolean;
  /** Why the question was replaced or reworded since the 23 Oct transcript study. */
  note?: string;
};

export type Verdict = { id: string; pass: boolean; missing: string[][]; stale: string[] };

export function loadQuestions(file = QUESTIONS): Question[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Question);
}

/** Markdown and case don't count: `**bun check**` matches /bun check/. */
export const normalize = (text: string) =>
  text
    .replace(/[`*]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .toLowerCase();

const hit = (pattern: string, text: string) => new RegExp(pattern, "i").test(text);

export function grade(q: Question, answer: string): Verdict {
  const text = normalize(answer);
  const missing = q.must.filter((group) => !group.some((p) => hit(p, text)));
  const stale = (q.stale ?? []).filter((p) => hit(p, text));
  return { id: q.id, pass: text.trim() !== "" && !missing.length && !stale.length, missing, stale };
}

function main(argv: string[]) {
  const [id, file = process.env.HARNESS_AB_ANSWER] = argv;
  const q = loadQuestions().find((x) => x.id === id);
  if (!q || !file) {
    console.error("usage: grade.ts <id> [answer-file]   (or set HARNESS_AB_ANSWER)");
    return 2;
  }
  const answer = existsSync(file) ? readFileSync(file, "utf8") : "";
  const v = grade(q, answer);
  console.log(JSON.stringify(v));
  return v.pass ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
