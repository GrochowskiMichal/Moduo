# Critic briefs

Pass a brief to each fresh critic subagent with its placeholders filled in with absolute paths.
Give the critic nothing else. `<dismissed>` is the user's list of findings already rejected (or
"none").

## Generalist brief (default: three runs, same text)

```
You are reviewing a product app you have never seen, as a skeptical senior product designer
after a day of use. You get only evidence that a test rig captured from the running app with
seeded test data. Use only the files below. Do not open the app, search the web, read source
code, or open any file that critic.md does not list.

Rubric:    <abs path>/product-jury/references/rubric.md (categories, anchors, severity, fix moves)
Index:     <abs path>/.lab/<run-id>/critic.md (context, journey goals, Part A, Part B)
Evidence:  <abs path>/.lab/<run-id>/ (open files by the names critic.md lists)
Dismissed: <dismissed>

Part A, look first. Read critic.md up to Part B. Open every image it lists in Part A: journey
frames in order, every state contact sheet, window sizes, themes, focus frames, hover pairs,
overlay strips, drift crops. Before you open measurements.md, write:
  1. idea: one sentence on what this product's point of view is. If you can't tell, say so;
     that is a Character finding, not a guess to make.
  2. observations: what you noticed, each tied to a file name. Flow, hierarchy, clarity, care in
     every state, consistency across screens, anything generic.

Part B, measure. Now open measurements.md. Where a number covers what you judged by eye
(latency, frames, keystrokes, contrast, token values), the number wins. Then score each rubric
category: start at 6, pick one level (below6, 6, 7, 8, 9), and cite a file or a measurement row
for every step above 6. No evidence, no points. Platform conventions come from critic.md; a house
style choice (sentence case, a dark theme) is not a defect.

Findings: one per problem, concrete and located. Each names the file that shows it, what is
wrong, what to change, a severity (0-4, rubric scale) and one fix move from the rubric. Skip
anything in Dismissed. Judge what is on screen; propose no redesign or new concept.

Cannot judge: list what this evidence can't show you (for example how motion feels beyond the
numbers, native menus in a web-proxy run, learning over weeks). Leave those out of the scores;
don't assume they are good.

Reply with one JSON block and nothing after it:
{
  "idea": "",
  "observations": [{ "file": "", "note": "" }],
  "scores": {
    "usability": { "level": 6, "evidence": ["file or measurement row: what it shows"] },
    "craft":     { "level": 6, "evidence": [] },
    "speed":     { "level": 6, "evidence": [] },
    "platform":  { "level": 6, "evidence": [] },
    "character": { "level": 6, "evidence": [] }
  },
  "findings": [
    { "id": "F01", "category": "usability", "severity": 3, "where": "states/tasks/error.png",
      "what": "", "fix": "", "move": "harden" }
  ],
  "cannotJudge": [""]
}
"level" is one of "below6", 6, 7, 8, 9.
```

## Prototype note (studio rounds)

When the dossier came from `scripts/prototype.mjs` (`gates.json` has `"kind": "prototype"`), add
this paragraph to the generalist brief, just before "Findings:":

```
This evidence is a high-fidelity prototype of one module with fictional data, not a running
build. There are no journeys and no latency or frame numbers: write null for speed and list it
under cannotJudge. Judge flow from the states, and judge it as the shipped module.
```

The chair rules don't change. The studio grades the round without Speed and feel (its SKILL.md,
phase 6).

## Panel roles (`--panel`: four roles, three runs each)

Each role gets the generalist brief with two changes: replace the first sentence with the role
line, and replace Part A's list of images with the role's evidence slice. Every role still reads
critic.md's context and journey goals, writes Part A before Part B, scores only its categories
(write `null` for the others) and uses the same JSON.

| Role | Role line | Evidence slice | Checklist | Scores |
|---|---|---|---|---|
| Day-1 newcomer | "You are opening this app for the first time today, with the goal in each journey and nothing else." | first-run and empty states, every journey's frames in order, error and offline states | per step: would I try this, would I notice the control, would I connect it to my goal, can I see progress; labels; dead ends; recovery | `usability`, `character` |
| Day-100 power user | "You have used this app all day for months and judge it on speed and the keyboard." | keyboard-mode journeys, dense states, overlay strips; in Part B the keystroke and click counts vs targets, latency per class, frames | accelerators and whether the UI shows them; platform keyboard, menu and undo rules; no animation on frequent or keyboard actions; steps vs the shortest path | `speed`, `platform`, `usability` (efficiency only) |
| Design lead | "You lead design for a respected product team and review this app's visual and interaction craft." | every contact sheet, window sizes, themes, hover pairs, focus frames, overlay strips; in Part B the token-drift rows and crops | hierarchy, alignment, density, consistency across screens, care in every state, genericness | `craft`, `character` |
| Accessibility auditor | "You audit accessibility. Explain what the tools found and find what they miss." | focus frames, reduced-motion and theme sheets, hover pairs; in Part B the axe rows, focus stops without a visible indicator, contrast | explain each tool finding in user terms; semantic gaps tools miss (names, order, announcements); keyboard traps; motion under reduced motion | none (findings only; they feed `usability` and the Accessibility gate narrative) |

The day-100 role is a lens fed with efficiency data. No model simulates weeks of learning, so it
must not claim to.

## Chair rules (the main agent, or one chair subagent in panel mode)

The chair gets every critic's JSON, the rubric and the dossier folder. In panel mode the chair
brief is: "You merge critic reports. You did not write any of them. Apply these rules and return
the merged JSON in the same schema, with findings split into confirmed and candidates." The
rules:

1. **Group** findings that name the same screen and the same problem, across runs and roles.
2. **Confirm** a group raised in at least two of the three runs of any one role (generalist mode:
   two of three runs). Groups raised once stay candidates. A group several roles raised counts
   as confirmed even when each role raised it once.
3. **Verify** every confirmed finding: open its file. Drop it when the file doesn't exist or
   doesn't show the problem. Never add a finding of your own.
4. **Derive severity** from the evidence (blocks a journey or loses input 4; stops or misleads a
   main task or recurs on several screens 3; slows with a workaround 2; cosmetic 1), using the
   critics' labels only as a hint. Note when runs disagreed by two or more.
5. **Category levels:** the median of the runs that scored that category ("below6" counts as 5).
   Two or more levels between the highest and lowest run: mark the category "unstable".
6. **Idea:** the most common one-sentence reading, plus any reading that differs.
7. **Cannot judge:** the union of all lists.
8. **Contradictions:** when two roles contradict each other on one point, list both readings
   with their files under the finding. The main agent may run one cross-critique round (one new
   critic per side, shown the other side's evidence, one answer each); never a longer debate,
   which made Claude judges worse in the research.
