// What the capture title's `@`, `#` and `/` menus list (TV-U14, research §2).
// Pure, so the order and the parsing are unit-tested:
// - `@`: people, then teams, then projects (with their sections), then things;
//   at most 8 rows, empty groups hide; you read "Alex Rivera (you)" (43);
// - `#`: tags, then "Create #name", plus "CS 201 is a project — @CS 201" when
//   a project, not a tag, matches (the Todoist habit, 33);
// - `/`: the date commands first (`/today` … `/date`), then priority,
//   estimate, remind, repeat (and due / schedule when typed), then things.
// Picking an entry is the Task body's (`onPick`); entries that set something
// carry the token they make, so the body only inserts it.

import {
  Bell,
  CalendarClock,
  CalendarDays,
  Flag,
  LayoutList,
  Plus,
  Repeat,
  Timer,
} from "lucide-react";

import { formatDay, formatDayTime } from "../../../lib/time-format";
import type { MentionActionCandidate, MentionCandidate } from "../../spine/mention";
import type { Bucket, PriorityLevel, Section, Tag, Team } from "../model";
import { parseCapture } from "../parse/capture-parser";
import { type CaptureToken, localDay } from "../parse/capture-tokens";
import { RECURRENCE_PRESETS, recurrenceFromPreset, recurrenceLabel } from "../parse/recurrence";

/** The most rows a capture menu shows (research §2). */
export const MENU_ROWS = 8;

/** What an entry does when picked. */
export type EntryEffect =
  | { kind: "token"; token: CaptureToken }
  | { kind: "destination"; projectId: string; sectionId: string | null; label: string }
  /** Open a pill's picker: the Due pill, or a field in More. */
  | {
      kind: "open";
      field: "due" | "priority" | "schedule" | "remind" | "estimate" | "repeat" | "template";
    };

export type MenuEntries = { candidates: MentionCandidate[]; effects: Map<string, EntryEffect> };

export type CapturePerson = { userId: string; name: string; isMe: boolean };

const includesWord = (name: string, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const lower = name.toLowerCase();
  return lower.startsWith(q) || lower.split(/\s+/).some((w) => w.startsWith(q));
};

/** How a person reads in the menu: "Alex Rivera (you)" for you. */
export function personLabel(person: CapturePerson): string {
  return person.isMe ? `${person.name || "You"} (you)` : person.name;
}

function action(
  effects: Map<string, EntryEffect>,
  id: string,
  label: string,
  effect: EntryEffect,
  extra: Partial<MentionActionCandidate> = {},
): MentionActionCandidate {
  effects.set(id, effect);
  return { kind: "action", id, label, ...extra };
}

/** `@`: people · teams · projects (sections nested) · things. */
export function mentionEntries(
  query: string,
  base: readonly MentionCandidate[],
  ctx: {
    people: readonly CapturePerson[];
    teams: readonly Team[];
    projects: readonly Bucket[];
    sections: readonly Section[];
  },
): MenuEntries {
  const effects = new Map<string, EntryEffect>();
  const out: MentionCandidate[] = [];
  for (const p of ctx.people.filter((p) => includesWord(p.name, query)).slice(0, 3)) {
    out.push({ kind: "person", memberId: p.userId, label: personLabel(p), icon: null });
  }
  for (const t of ctx.teams.filter((t) => includesWord(t.name, query)).slice(0, 2)) {
    out.push({ kind: "team", teamId: t.id, label: t.name, letters: t.mark || null });
  }
  const projects = ctx.projects.filter((b) => includesWord(b.name, query)).slice(0, 3);
  for (const b of projects) {
    out.push({ kind: "entity", ref: { type: "bucket", id: b.id }, label: b.name, icon: "project" });
  }
  const projectName = new Map(ctx.projects.map((b) => [b.id, b.name]));
  const sections = ctx.sections
    .filter((s) => projectName.has(s.projectId))
    .filter((s) => query.trim() !== "" && includesWord(s.name, query))
    .slice(0, 2);
  for (const s of sections) {
    const label = `${projectName.get(s.projectId)} › ${s.name}`;
    out.push(
      action(
        effects,
        `section:${s.id}`,
        label,
        { kind: "destination", projectId: s.projectId, sectionId: s.id, label },
        { icon: LayoutList },
      ),
    );
  }
  // Things from the registry: never a project (listed above, live names) or a tag.
  for (const c of base) {
    if (out.length >= MENU_ROWS) break;
    if (c.kind !== "entity") continue;
    if (c.ref.type === "bucket" || c.ref.type === "project" || c.ref.type === "tag") continue;
    out.push(c);
  }
  return { candidates: out.slice(0, MENU_ROWS), effects };
}

/** `#`: tags · "Create #name" · a project that matches. */
export function tagEntries(
  query: string,
  base: readonly MentionCandidate[],
  ctx: { tags: readonly Tag[]; projects: readonly Bucket[] },
  loading: boolean,
): MenuEntries {
  const effects = new Map<string, EntryEffect>();
  const out: MentionCandidate[] = base.filter((c) => c.kind === "tag").slice(0, 6);
  const q = query.trim();
  const lower = q.toLowerCase();
  const known =
    out.some((c) => c.kind === "tag" && c.label.toLowerCase() === lower) ||
    ctx.tags.some((t) => t.name.toLowerCase() === lower);
  if (q && !known && !loading) {
    const existing = ctx.tags.find((t) => t.name.toLowerCase() === lower);
    out.push(
      action(
        effects,
        `tag-new:${lower}`,
        `Create #${q}`,
        {
          kind: "token",
          token: { kind: "tag", tagId: existing?.id ?? null, label: q, color: null },
        },
        { icon: Plus },
      ),
    );
  }
  if (q) {
    const squash = (s: string) => s.toLowerCase().replace(/\s+/g, "");
    const project = ctx.projects.find((b) => squash(b.name).startsWith(squash(q)));
    if (project) {
      out.push(
        action(
          effects,
          `project-hint:${project.id}`,
          `${project.name} is a project — @${project.name}`,
          {
            kind: "destination",
            projectId: project.id,
            sectionId: null,
            label: project.name,
          },
        ),
      );
    }
  }
  return { candidates: out.slice(0, MENU_ROWS), effects };
}

const PRIORITIES: Array<{ level: PriorityLevel; label: string }> = [
  { level: "high", label: "High priority" },
  { level: "medium", label: "Medium priority" },
  { level: "low", label: "Low priority" },
];

/** "2h", "30m", "1h30", "1.5h", "90" (minutes) → minutes; null when it isn't one. */
export function parseEstimate(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return null;
  let m = /^(\d+(?:\.\d+)?)h(?:(\d{1,2})m?)?$/.exec(t);
  if (m) {
    const minutes = Math.round(Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0));
    return minutes > 0 ? minutes : null;
  }
  m = /^(\d+)(?:m|min|mins)?$/.exec(t);
  if (m) {
    const minutes = Number(m[1]);
    return minutes > 0 ? minutes : null;
  }
  return null;
}

/** "~2h", "~45m", "~1h 30m": how an estimate reads on a chip. */
export function estimateLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `~${m}m`;
  return m ? `~${h}h ${m}m` : `~${h}h`;
}

/** The command words, as the menu offers them with nothing more typed. */
const COMMANDS = [
  "priority",
  "estimate",
  "remind",
  "repeat",
  "due",
  "schedule",
  "template",
] as const;
type Command = (typeof COMMANDS)[number];

/** `/`: the date commands (the menu's own) · capture's commands · things. */
export function commandEntries(
  query: string,
  base: readonly MentionCandidate[],
  opts: { now?: Date; templates?: boolean } = {},
): MenuEntries {
  const now = opts.now ?? new Date();
  const effects = new Map<string, EntryEffect>();
  const out: MentionCandidate[] = base.filter((c) => c.kind === "command");
  const q = query.trim().toLowerCase();
  const [word = "", ...restWords] = q.split(/\s+/);
  const rest = restWords.join(" ");
  const wants = (cmd: Command) =>
    q === ""
      ? cmd !== "due" && cmd !== "schedule" && cmd !== "template"
      : cmd.startsWith(word) && word.length > 0;

  for (const cmd of COMMANDS) {
    if (cmd === "template" && !opts.templates) continue;
    if (!wants(cmd)) continue;
    if (cmd === "priority") {
      if (q === "") {
        out.push(
          action(
            effects,
            "open:priority",
            "Priority…",
            { kind: "open", field: "priority" },
            { icon: Flag },
          ),
        );
        continue;
      }
      for (const p of PRIORITIES.filter((p) => p.level.startsWith(rest))) {
        out.push(
          action(
            effects,
            `priority:${p.level}`,
            p.label,
            { kind: "token", token: PRIORITY_TOKEN[p.level] },
            { icon: Flag },
          ),
        );
      }
      continue;
    }
    if (cmd === "estimate") {
      const minutes = parseEstimate(rest);
      out.push(
        minutes
          ? action(
              effects,
              `estimate:${minutes}`,
              `Estimate ${estimateLabel(minutes).slice(1)}`,
              {
                kind: "token",
                token: { kind: "estimate", minutes, label: estimateLabel(minutes) },
              },
              { icon: Timer },
            )
          : action(
              effects,
              "open:estimate",
              "Estimate…",
              { kind: "open", field: "estimate" },
              { icon: Timer },
            ),
      );
      continue;
    }
    if (cmd === "remind") {
      const at = rest ? whenOf(rest, now) : null;
      out.push(
        at
          ? action(
              effects,
              `remind:${at}`,
              `Remind me ${formatDayTime(at, now)}`,
              {
                kind: "token",
                token: { kind: "remind", at, label: `Remind ${formatDayTime(at, now)}` },
              },
              { icon: Bell },
            )
          : action(
              effects,
              "open:remind",
              "Remind me…",
              { kind: "open", field: "remind" },
              { icon: Bell },
            ),
      );
      continue;
    }
    if (cmd === "repeat") {
      const parsed = rest
        ? parseCapture(rest.startsWith("every") ? rest : `every ${rest}`, now)
        : null;
      if (parsed?.recurrence) {
        const label = cap(recurrenceLabel(parsed.recurrence));
        out.push(
          action(
            effects,
            `repeat:${parsed.recurrence.rrule}`,
            `Repeat ${label.toLowerCase()}`,
            { kind: "token", token: { kind: "repeat", rule: parsed.recurrence, label } },
            { icon: Repeat },
          ),
        );
      } else if (!rest) {
        out.push(
          action(
            effects,
            "open:repeat",
            "Repeat…",
            { kind: "open", field: "repeat" },
            { icon: Repeat },
          ),
        );
      } else {
        for (const p of RECURRENCE_PRESETS.filter((p) => p.label.toLowerCase().includes(rest))) {
          const rule = recurrenceFromPreset(p.value);
          out.push(
            action(
              effects,
              `repeat:${p.value}`,
              p.label,
              { kind: "token", token: { kind: "repeat", rule, label: p.label } },
              { icon: Repeat },
            ),
          );
        }
      }
      continue;
    }
    if (cmd === "due") {
      const parsed = rest ? parseCapture(rest, now) : null;
      const day = parsed?.dueDate
        ? localDay(parsed.dueDate)
        : parsed?.scheduledAt
          ? localDay(parsed.scheduledAt)
          : null;
      out.push(
        day
          ? action(
              effects,
              `due:${day}`,
              `Due ${formatDay(`${day}T12:00:00`, now)}`,
              {
                kind: "token",
                token: { kind: "due", day, label: formatDay(`${day}T12:00:00`, now) },
              },
              { icon: CalendarDays },
            )
          : action(
              effects,
              "open:due",
              "Due…",
              { kind: "open", field: "due" },
              { icon: CalendarDays },
            ),
      );
      continue;
    }
    if (cmd === "schedule") {
      const at = rest ? whenOf(rest, now) : null;
      out.push(
        at
          ? action(
              effects,
              `schedule:${at}`,
              `Schedule ${formatDayTime(at, now)}`,
              { kind: "token", token: { kind: "schedule", at, label: formatDayTime(at, now) } },
              { icon: CalendarClock },
            )
          : action(
              effects,
              "open:schedule",
              "Schedule…",
              { kind: "open", field: "schedule" },
              { icon: CalendarClock },
            ),
      );
      continue;
    }
    if (cmd === "template") {
      out.push(action(effects, "open:template", "Template…", { kind: "open", field: "template" }));
    }
  }
  if (q) {
    for (const c of base) {
      if (out.length >= MENU_ROWS) break;
      if (c.kind === "entity" && c.ref.type !== "bucket" && c.ref.type !== "tag") out.push(c);
    }
  }
  return { candidates: out.slice(0, MENU_ROWS), effects };
}

const PRIORITY_TOKEN: Record<PriorityLevel, CaptureToken> = {
  high: { kind: "priority", level: "high", label: "High priority" },
  medium: { kind: "priority", level: "medium", label: "Medium priority" },
  low: { kind: "priority", level: "low", label: "Low priority" },
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "4pm" → today 4 PM (or tomorrow when it's passed); "tomorrow 9am"; a day alone is 9 AM. */
export function whenOf(text: string, now: Date = new Date()): string | null {
  const parsed = parseCapture(/\d/.test(text) && !/\bat\b/.test(text) ? `at ${text}` : text, now);
  if (parsed.scheduledAt) return parsed.scheduledAt;
  if (parsed.dueDate) {
    const d = new Date(parsed.dueDate);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  }
  return null;
}
