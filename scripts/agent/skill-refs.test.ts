import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "@rstest/core";

import {
  findProblems,
  loadProjectSkills,
  PLUGIN_SKILLS,
  readPluginSkills,
  type SkillDoc,
  steps,
} from "./skill-refs.ts";

// HV-3 (specs/harness-v3.md AC15, AC17): every skill a project skill names
// exists and is one the model may call, unless the line tells the person to
// type it; the workflow skills call the engineering skills by exact name.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const skills = loadProjectSkills(ROOT);
const skill = (name: string): SkillDoc => {
  const doc = skills.get(name);
  if (!doc) throw new Error(`no project skill ${name}`);
  return doc;
};
const doc = (name: string, text: string, modelInvocable = true): SkillDoc => ({
  name,
  path: `.claude/skills/${name}/SKILL.md`,
  text,
  modelInvocable,
});

describe("skill-refs scanner", () => {
  const local = new Map([
    ["s2", doc("s2", "")],
    ["ship", doc("ship", "", false)],
  ]);

  it("flags a user-only plugin skill the model is told to use", () => {
    const problems = findProblems(
      [doc("s1", "Use `mattpocock-skills:to-tickets` to cut blocks.")],
      local,
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).toMatch(/model can't call/);
  });

  it("allows a user-only skill on a line that tells the person to type it", () => {
    const text = "The person types `/mattpocock-skills:to-tickets` themselves.";
    expect(findProblems([doc("s1", text)], local)).toEqual([]);
  });

  it("allows user-only commands inside a fenced block the person pastes", () => {
    const text = "Start it with:\n\n```\n/ship then /mattpocock-skills:wayfinder\n```\n";
    expect(findProblems([doc("s3", text)], local)).toEqual([]);
  });

  it("flags a user-only project skill named outside a person line", () => {
    const problems = findProblems([doc("s3", "Releasing is `/ship`.")], local);
    expect(problems.map((p) => p.ref)).toEqual(["ship"]);
  });

  it("lets a skill name itself", () => {
    expect(findProblems([doc("ship", "`/ship vX.Y.Z` finishes it.", false)], local)).toEqual([]);
  });

  it("flags a plugin skill named without its plugin prefix", () => {
    const problems = findProblems(
      [doc("s2", "Use the `tdd` skill. Then the diagnosing-bugs skill.")],
      local,
    );
    expect(problems.map((p) => p.ref)).toEqual(["tdd", "diagnosing-bugs"]);
    expect(problems[0]?.reason).toMatch(/mattpocock-skills:tdd/);
  });

  it("flags a qualified name the plugin doesn't have", () => {
    const problems = findProblems([doc("s2", "Call `mattpocock-skills:tddd`.")], local);
    expect(problems[0]?.reason).toMatch(/no such skill/);
  });

  it("flags an unknown skill named as a skill", () => {
    const problems = findProblems([doc("s2", "Use the `wayfinding` skill.")], local);
    expect(problems[0]?.reason).toMatch(/no such skill/);
  });

  it("leaves paths and unrelated code spans alone", () => {
    const text =
      "Read `.claude/skills/s2/SKILL.md` and the `moduo` connector; run `bun run verify`.";
    expect(findProblems([doc("s1", text)], local)).toEqual([]);
  });
});

describe("project skills (AC15)", () => {
  it("name only skills that exist and that the model may call, unless the line addresses the person", () => {
    const problems = findProblems([...skills.values()], skills);
    expect(problems.map((p) => `${p.file}:${p.line} ${p.ref}: ${p.reason}`)).toEqual([]);
  });

  it("/s2 calls tdd, diagnosing-bugs and code-review by exact name in its steps", () => {
    const text = steps(skill("s2").text).join("\n");
    for (const name of ["tdd", "diagnosing-bugs", "code-review"]) {
      expect(text).toContain(`\`mattpocock-skills:${name}\``);
    }
  });

  it("/s3 writes the PR body with the pr skill by exact name in its steps", () => {
    expect(steps(skill("s3").text).join("\n")).toContain("`mattpocock-skills:pr`");
  });

  it("/s1 keeps the designer posture and hands engineer-mode flows to the person", () => {
    const text = skill("s1").text;
    expect(text).toMatch(/recommended answer/);
    expect(text).toMatch(/Never ask the designer implementation/);
    expect(text).toMatch(/types `\/mattpocock-skills:grill-with-docs`/);
    expect(text).toMatch(/`\/mattpocock-skills:to-tickets`/);
  });

  it("/s2 has the bug lane, the fast-lane rule and the three-strikes stop (AC2, AC16)", () => {
    const text = skill("s2").text;
    expect(text).toMatch(/fits one sentence/);
    expect(text).toMatch(/failing test that reproduces the bug/);
    expect(text).toMatch(/3.5 plausible wrong fixes/);
    expect(text).toMatch(/third failure of the same check/);
    expect(text).toMatch(/defect report/);
    expect(text).toContain("never edit a test to make it pass");
  });
});

describe("one validator step (AC17)", () => {
  const validatorSteps = (name: string) =>
    steps(skill(name).text).filter((s) => /\bvalidator\b/.test(s));

  it("/s2 has exactly one, advisory, asking for explicit disagreements", () => {
    const found = validatorSteps("s2");
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/once/);
    expect(found[0]).toMatch(/advis/);
    expect(found[0]).toMatch(/disagree/);
  });

  it("/s3 has none", () => {
    expect(validatorSteps("s3")).toEqual([]);
  });
});

describe("plugin registry", () => {
  for (const [plugin, { version, skills: registered }] of Object.entries(PLUGIN_SKILLS)) {
    const dir = path.join(
      homedir(),
      ".claude/plugins/cache/claude-plugins-official",
      plugin,
      version,
    );
    // CI has no plugin cache; on a developer's Mac this catches a registry that
    // drifted from the installed version.
    it.skipIf(!existsSync(dir))(`${plugin} ${version} matches the installed plugin`, () => {
      expect(readPluginSkills(dir)).toEqual(registered);
    });
  }

  it("is enabled for the project", () => {
    const settings = JSON.parse(readFileSync(path.join(ROOT, ".claude/settings.json"), "utf8"));
    for (const plugin of Object.keys(PLUGIN_SKILLS)) {
      expect(settings.enabledPlugins[`${plugin}@claude-plugins-official`]).toBe(true);
    }
  });
});
