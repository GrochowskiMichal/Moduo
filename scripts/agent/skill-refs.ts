import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// Finds skills named inside the project skills (.claude/skills/*/SKILL.md) and
// checks each one exists and is one the model may call. A skill with
// `disable-model-invocation: true` is the person's to type, so it may only be
// named on a line that tells the person to type it (or inside a fenced block
// they paste). Tested by skill-refs.test.ts, part of verify.

/**
 * Plugin skills by name → whether the model may call them, pinned to the
 * version the project enables. Bump the version and the list together; the
 * test compares them with the local plugin cache when it exists.
 */
export const PLUGIN_SKILLS: Record<string, { version: string; skills: Record<string, boolean> }> = {
  "mattpocock-skills": {
    version: "1.3.1",
    skills: {
      "ask-matt": false,
      "code-review": true,
      "codebase-design": true,
      "diagnosing-bugs": true,
      "domain-modeling": true,
      "grill-me": false,
      "grill-with-docs": false,
      grilling: true,
      handoff: false,
      implement: false,
      "implement-spec": false,
      "improve-codebase-architecture": false,
      pr: true,
      prototype: true,
      research: true,
      retro: false,
      "setup-matt-pocock-skills": false,
      tdd: true,
      teach: false,
      "to-questionnaire": false,
      "to-spec": false,
      "to-tickets": false,
      triage: false,
      "wait-what": false,
      wayfinder: false,
      wizard: true,
      "writing-for-agents": true,
    },
  },
};

export type SkillDoc = { name: string; path: string; text: string; modelInvocable: boolean };
export type Problem = { file: string; line: number; ref: string; reason: string };

const userOnly = (text: string) =>
  /^disable-model-invocation:\s*true\s*$/m.test(text.split(/^---\s*$/m)[1] ?? "");

/** The project skills, keyed by folder name (the name you type). */
export function loadProjectSkills(root: string): Map<string, SkillDoc> {
  const dir = path.join(root, ".claude/skills");
  const out = new Map<string, SkillDoc>();
  for (const name of readdirSync(dir).toSorted()) {
    const file = path.join(dir, name, "SKILL.md");
    if (!existsSync(file)) continue;
    const text = readFileSync(file, "utf8");
    out.set(name, { name, path: path.relative(root, file), text, modelInvocable: !userOnly(text) });
  }
  return out;
}

/** An installed plugin's skills (from its plugin.json) → whether the model may call them. */
export function readPluginSkills(pluginDir: string): Record<string, boolean> {
  const manifest = JSON.parse(
    readFileSync(path.join(pluginDir, ".claude-plugin/plugin.json"), "utf8"),
  );
  const out: Record<string, boolean> = {};
  for (const rel of (manifest.skills as string[]).toSorted((a, b) =>
    path.basename(a).localeCompare(path.basename(b)),
  )) {
    out[path.basename(rel)] = !userOnly(
      readFileSync(path.join(pluginDir, rel, "SKILL.md"), "utf8"),
    );
  }
  return out;
}

/** The numbered steps of a skill's `## Steps` section, each with its indented sub-lines. */
export function steps(text: string): string[] {
  const section = text.split(/^## Steps\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const out: string[] = [];
  for (const line of section.split("\n")) {
    if (/^\d+[a-z]?\.\s/.test(line)) out.push(line);
    else if (out.length > 0 && /^\s+\S/.test(line)) out[out.length - 1] += `\n${line}`;
  }
  return out;
}

// A line addresses the person when it tells them what to type.
const PERSON_LINE = /\b(types?|typed|typing)\b|\bthe person\b|\bperson's\b/i;

const pluginOf = (name: string) =>
  Object.entries(PLUGIN_SKILLS).find(([, p]) => name in p.skills)?.[0];

type Ref = {
  ref: string;
  line: number;
  personLine: boolean;
  kind: "qualified" | "local" | "bare" | "named";
};

function refs(text: string, local: Map<string, SkillDoc>): Ref[] {
  const out: Ref[] = [];
  let fenced = false;
  text.split("\n").forEach((raw, i) => {
    if (/^\s*```/.test(raw)) {
      fenced = !fenced;
      return;
    }
    const line = i + 1;
    const personLine = fenced || PERSON_LINE.test(raw);
    const add = (ref: string, kind: Ref["kind"]) => out.push({ ref, line, personLine, kind });
    for (const m of raw.matchAll(/(?:^|[\s`(*])\/?([a-z0-9-]+):([a-z0-9-]+)\b/g)) {
      if (m[1] && m[1] in PLUGIN_SKILLS) add(`${m[1]}:${m[2]}`, "qualified");
    }
    for (const m of raw.matchAll(/(?:^|[\s`(*])\/([a-z][a-z0-9-]*)(?![\w:/.-])/g)) {
      if (m[1] && local.has(m[1])) add(m[1], "local");
    }
    for (const m of raw.matchAll(/`([a-z][a-z0-9-]*)`/g)) {
      if (m[1] && local.has(m[1])) add(m[1], "local");
      else if (m[1] && pluginOf(m[1])) add(m[1], "bare");
    }
    for (const m of raw.matchAll(/\bthe ([a-z][a-z0-9-]*) skill\b/g)) {
      if (m[1] && !local.has(m[1]) && pluginOf(m[1])) add(m[1], "bare");
    }
    for (const m of raw.matchAll(/`\/?([a-z][a-z0-9:-]*)` skill\b/g)) {
      const name = m[1] ?? "";
      if (!local.has(name) && !pluginOf(name) && !name.includes(":")) add(name, "named");
    }
  });
  return out;
}

/** Every reference in `docs` to a skill that is missing, unprefixed, or the person's to type. */
export function findProblems(docs: SkillDoc[], local: Map<string, SkillDoc>): Problem[] {
  const problems: Problem[] = [];
  for (const doc of docs) {
    for (const { ref, line, personLine, kind } of refs(doc.text, local)) {
      const report = (reason: string) => problems.push({ file: doc.path, line, ref, reason });
      if (kind === "named") {
        report("no such skill");
      } else if (kind === "bare") {
        report(`call it by its exact name \`${pluginOf(ref)}:${ref}\``);
      } else if (kind === "qualified") {
        const [plugin = "", name = ""] = ref.split(":");
        const invocable = PLUGIN_SKILLS[plugin]?.skills[name];
        if (invocable === undefined)
          report(`no such skill in ${plugin} ${PLUGIN_SKILLS[plugin]?.version}`);
        else if (!invocable && !personLine)
          report("the model can't call it; tell the person to type it");
      } else if (ref !== doc.name && !local.get(ref)?.modelInvocable && !personLine) {
        report("the model can't call it; tell the person to type it");
      }
    }
  }
  return problems;
}
