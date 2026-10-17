// The time report (TV-D14, spec §14, REPLAN 75): what the sheet, its PDF and
// its CSV show, from `tasks_time_report`'s rows. The server decides which
// entries the reader may see (their own; the owner also sees people who
// share); this module only groups, rounds and writes them out. Pure.
//
// Rows are signed (a give-back after a Focus takeover is negative) and are
// summed per line; a line never shows below zero. Rounding to 15 minutes is
// per line, up to the next quarter hour, so the total is the sum of what the
// lines say.

import { formatDate, formatFullDate, formatWeekdayDate } from "../../lib/time-format";
import { toFloating } from "../../lib/zoned-time";
import type { TimeReportRow } from "./model";
import { dayToDate, isoDay } from "./time-entries";
import { formatTracked } from "./time-format";

export const REPORT_PERIODS = [
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "last_30",
  "custom",
] as const;
export type ReportPeriodId = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriodId, string> = {
  this_week: "This week",
  last_week: "Last week",
  this_month: "This month",
  last_month: "Last month",
  last_30: "Last 30 days",
  custom: "Pick dates",
};

export type ReportRange = { from: string; to: string };

/** A period's first and last day (inclusive, YYYY-MM-DD), the week starting
 *  where Time & region starts it. `custom` passes the picked range through.
 *  With `zone` (Time & region's, MOD-110), "today" is that zone's day, the
 *  one the report dates its entries in; without it, this device's. */
export function reportRange(
  id: ReportPeriodId,
  now: Date,
  weekStartsOn: number,
  custom?: ReportRange | null,
  zone?: string | null,
): ReportRange {
  const wall = zone ? toFloating(now, zone) : null;
  const today = wall
    ? new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate())
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (d: Date) => isoDay(d);
  const plus = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const weekStart = plus(today, -((today.getDay() - weekStartsOn + 7) % 7));
  switch (id) {
    case "this_week":
      return { from: day(weekStart), to: day(plus(weekStart, 6)) };
    case "last_week":
      return { from: day(plus(weekStart, -7)), to: day(plus(weekStart, -1)) };
    case "this_month":
      return {
        from: day(new Date(today.getFullYear(), today.getMonth(), 1)),
        to: day(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
      };
    case "last_month":
      return {
        from: day(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
        to: day(new Date(today.getFullYear(), today.getMonth(), 0)),
      };
    case "last_30":
      return { from: day(plus(today, -29)), to: day(today) };
    case "custom":
      return custom && custom.from <= custom.to ? custom : { from: day(today), to: day(today) };
  }
}

/** Why picked dates can't make a report (the server takes up to a year,
 *  first day first), or null. */
export function customRangeProblem(range: ReportRange): string | null {
  const from = dayToDate(range.from);
  const to = dayToDate(range.to);
  if (!from || !to) return "Pick both dates.";
  if (range.from > range.to)
    return "The first day comes after the last. Pick them the other way round.";
  if (Math.round((to.getTime() - from.getTime()) / 86_400_000) > 366) {
    return "A report covers up to a year. Pick a shorter period.";
  }
  return null;
}

/** "Oct 5 – Oct 11", "Oct 5, 2025 – Jan 4, 2026". */
export function rangeLabel(range: ReportRange, now: Date = new Date()): string {
  const from = dayToDate(range.from);
  const to = dayToDate(range.to);
  if (!from || !to) return "";
  const sameYear =
    from.getFullYear() === to.getFullYear() && to.getFullYear() === now.getFullYear();
  const fmt = (d: Date) => (sameYear ? formatDate(d, now) : formatFullDate(d));
  return range.from === range.to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}

export type ReportGroupBy = "task" | "day";

export type ReportLine = {
  key: string;
  taskId: string;
  title: string;
  project: string;
  /** Who tracked it; null when the report is one person's. */
  person: string | null;
  /** YYYY-MM-DD when grouped by day. */
  day: string | null;
  seconds: number;
  notes: string[];
};

export type ReportSection = {
  key: string;
  label: string;
  seconds: number;
  lines: ReportLine[];
};

export type ShapedReport = {
  sections: ReportSection[];
  totalSeconds: number;
  /** Everyone whose time is in it, by name. */
  people: string[];
  /** More than one person's time: lines say whose. */
  showPeople: boolean;
};

const QUARTER = 15 * 60;

/** Up to the next quarter hour (nothing stays nothing). */
export function roundUpToQuarter(seconds: number): number {
  return seconds <= 0 ? 0 : Math.ceil(seconds / QUARTER) * QUARTER;
}

/** The project a row reads under: its name, "Inbox", or "Private project". */
export function projectLabel(row: Pick<TimeReportRow, "projectName" | "projectIsInbox">): string {
  if (row.projectIsInbox) return "Inbox";
  return row.projectName ?? "Private project";
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: "base" });

export function shapeTimeReport(
  rows: readonly TimeReportRow[],
  opts: { groupBy: ReportGroupBy; roundToQuarter: boolean; nameOf: (userId: string) => string },
): ShapedReport {
  const people = new Set(rows.map((r) => r.userId));
  const showPeople = people.size > 1 || rows.some((r) => !r.isMine);
  const lines = new Map<string, ReportLine & { section: string; sectionLabel: string }>();
  for (const r of rows) {
    const project = projectLabel(r);
    const section = opts.groupBy === "day" ? r.day : `${r.projectId ?? ""}|${project}`;
    const sectionLabel =
      opts.groupBy === "day" ? formatWeekdayDate(dayToDate(r.day) ?? r.day) : project;
    const key = [opts.groupBy === "day" ? r.day : "", r.taskId, showPeople ? r.userId : ""].join(
      "|",
    );
    const line =
      lines.get(key) ??
      ({
        key,
        taskId: r.taskId,
        title: r.taskTitle,
        project,
        person: showPeople ? opts.nameOf(r.userId) : null,
        day: opts.groupBy === "day" ? r.day : null,
        seconds: 0,
        notes: [],
        section,
        sectionLabel,
      } as ReportLine & { section: string; sectionLabel: string });
    line.seconds += r.seconds;
    const note = r.note?.trim();
    if (note && !line.notes.includes(note)) line.notes.push(note);
    lines.set(key, line);
  }

  const sections = new Map<string, ReportSection>();
  for (const line of lines.values()) {
    const raw = Math.max(0, line.seconds);
    const seconds = opts.roundToQuarter ? roundUpToQuarter(raw) : raw;
    if (seconds <= 0) continue;
    const s = sections.get(line.section) ?? {
      key: line.section,
      label: line.sectionLabel,
      seconds: 0,
      lines: [],
    };
    const { section: _s, sectionLabel: _l, ...plain } = line;
    s.lines.push({ ...plain, seconds });
    s.seconds += seconds;
    sections.set(line.section, s);
  }
  const ordered = [...sections.values()].sort((a, b) =>
    opts.groupBy === "day" ? a.key.localeCompare(b.key) : byText(a.label, b.label),
  );
  for (const s of ordered) {
    s.lines.sort((a, b) => byText(a.title, b.title) || byText(a.person ?? "", b.person ?? ""));
  }
  return {
    sections: ordered,
    totalSeconds: ordered.reduce((sum, s) => sum + s.seconds, 0),
    people: [...people].map(opts.nameOf).sort(byText),
    showPeople,
  };
}

/** "2h 15m". */
export function reportLength(seconds: number): string {
  return formatTracked(seconds);
}

/** Hours as a number for spreadsheets: 2.25. */
export function decimalHours(seconds: number): string {
  return (Math.round((seconds / 3600) * 100) / 100).toFixed(2);
}

/**
 * One CSV cell: quoted when it holds a comma, quote or line break, and never
 * read as a formula by a spreadsheet (a cell starting with = + - @ or a tab
 * gets a leading apostrophe).
 */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvLine(cells: ReadonlyArray<string | number>): string {
  return cells.map(csvCell).join(",");
}

/** The report as CSV, the same lines the sheet shows, with a total. */
export function reportCsv(report: ShapedReport, groupBy: ReportGroupBy): string {
  const header = [
    ...(groupBy === "day" ? ["Date"] : []),
    "Project",
    "Task",
    ...(report.showPeople ? ["Person"] : []),
    "Hours",
    "Duration",
    "Notes",
  ];
  const out = [csvLine(header)];
  for (const section of report.sections) {
    for (const line of section.lines) {
      out.push(
        csvLine([
          ...(groupBy === "day" ? [line.day ?? ""] : []),
          line.project,
          line.title,
          ...(report.showPeople ? [line.person ?? ""] : []),
          decimalHours(line.seconds),
          reportLength(line.seconds),
          line.notes.join("; "),
        ]),
      );
    }
  }
  const pad = (groupBy === "day" ? 1 : 0) + (report.showPeople ? 1 : 0);
  out.push(
    csvLine([
      "Total",
      "",
      ...Array.from({ length: pad }, () => ""),
      decimalHours(report.totalSeconds),
      reportLength(report.totalSeconds),
      "",
    ]),
  );
  return `${out.join("\r\n")}\r\n`;
}

/** A file name for an export: "time-report-acme-2026-10-01-2026-10-31.csv". */
export function reportFileName(scope: string, range: ReportRange, ext: string): string {
  const slug = scope
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `time-report${slug ? `-${slug}` : ""}-${range.from}-${range.to}.${ext}`;
}
