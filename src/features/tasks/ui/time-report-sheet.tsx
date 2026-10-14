// The time report sheet (TV-D14, spec §14, REPLAN 75): opened from a project's
// overview and from a client's hub. Period · by task or by day · totals ·
// optional 15-minute rounding · Export PDF (one printable layout, the same in
// light and dark) · Export CSV. No rates, no invoices. The rows come from
// `tasks_time_report`, which returns only entries the reader may see.

import { Download, FileText } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { PrintRoot } from "../../../components/app/print-root";
import { Button } from "../../../components/ui/button";
import { DateField } from "../../../components/ui/date-field";
import { EmptyState } from "../../../components/ui/empty-state";
import { Label } from "../../../components/ui/label";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui/sheet";
import { Switch } from "../../../components/ui/switch";
import { printPage } from "../../../lib/print";
import { getRuntime } from "../../../lib/runtime";
import { formatFullDate } from "../../../lib/time-format";
import { useTimeRegion } from "../../../lib/time-region";
import { saveBlob } from "../../attachments/files";
import { useAssignees } from "../assignees";
import type { TimeReportResult } from "../model";
import { dayToDate, isoDay } from "../time-entries";
import {
  customRangeProblem,
  REPORT_PERIOD_LABELS,
  REPORT_PERIODS,
  type ReportGroupBy,
  type ReportPeriodId,
  type ReportRange,
  rangeLabel,
  reportCsv,
  reportFileName,
  reportLength,
  reportRange,
  type ShapedReport,
  shapeTimeReport,
} from "../time-report";

/** What a report covers: a project's tasks, or every project of a client. */
export type TimeReportScope =
  | { kind: "project"; projectId: string; name: string }
  | { kind: "client"; clientContactId: string; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  scope: TimeReportScope;
};

export function TimeReportSheet({ open, onOpenChange, workspaceId, scope }: Props) {
  const region = useTimeRegion();
  const { byId } = useAssignees();
  const [period, setPeriod] = useState<ReportPeriodId>("this_month");
  const [custom, setCustom] = useState<ReportRange | null>(null);
  const [groupBy, setGroupBy] = useState<ReportGroupBy>("task");
  const [round, setRound] = useState(false);
  const [result, setResult] = useState<TimeReportResult | null>(null);
  const [failed, setFailed] = useState(false);

  const range = useMemo(
    () => reportRange(period, new Date(), region.weekStartsOn, custom),
    [period, custom, region.weekStartsOn],
  );
  // Picked dates the report can't take say why, instead of failing.
  const rangeProblem = period === "custom" && custom ? customRangeProblem(custom) : null;
  const projectId = scope.kind === "project" ? scope.projectId : null;
  const clientId = scope.kind === "client" ? scope.clientContactId : null;

  useEffect(() => {
    if (!open || rangeProblem) return;
    const runtime = getRuntime();
    if (!runtime) return;
    let live = true;
    setResult(null);
    setFailed(false);
    runtime.tasks
      .timeReport({
        workspaceId,
        from: range.from,
        to: range.to,
        projectIds: projectId ? [projectId] : null,
        clientContactId: clientId,
        zone: region.timeZone,
      })
      .then(
        (r) => {
          if (live) setResult(r);
        },
        () => {
          if (live) setFailed(true);
        },
      );
    return () => {
      live = false;
    };
  }, [open, rangeProblem, workspaceId, projectId, clientId, range.from, range.to, region.timeZone]);

  const nameOf = (userId: string) => {
    const person = byId(userId);
    return person ? person.fullName || person.name : "Former member";
  };
  const report = useMemo(
    () =>
      result && !rangeProblem
        ? shapeTimeReport(result.rows, { groupBy, roundToQuarter: round, nameOf })
        : null,
    // nameOf reads the members list, which byId follows.
    // biome-ignore lint/correctness/useExhaustiveDependencies: byId is nameOf's input
    [result, rangeProblem, groupBy, round, byId],
  );
  const label = rangeLabel(range);

  const exportCsv = () => {
    if (!report) return;
    saveBlob(
      reportFileName(scope.name, range, "csv"),
      // The byte-order mark tells a spreadsheet the file is UTF-8.
      new Blob(["﻿", reportCsv(report, groupBy)], { type: "text/csv;charset=utf-8" }),
    );
  };
  const exportPdf = () => {
    printPage().catch(() => toast.error("Couldn't open printing. Try Export CSV instead."));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-hairline">
          <SheetTitle>Time report</SheetTitle>
          <SheetDescription>
            {scope.name} · {label}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
          <Select value={period} onValueChange={(v) => setPeriod(v as ReportPeriodId)}>
            <SelectTrigger className="w-40" size="sm" aria-label="Period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {REPORT_PERIODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {REPORT_PERIOD_LABELS[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {period === "custom" ? (
            <>
              <DateField
                variant="outline"
                aria-label="From"
                value={dayToDate(custom?.from ?? range.from)}
                formatValue={formatFullDate}
                onChange={(d) => d && setCustom({ from: isoDay(d), to: custom?.to ?? range.to })}
              />
              <DateField
                variant="outline"
                aria-label="To"
                value={dayToDate(custom?.to ?? range.to)}
                formatValue={formatFullDate}
                onChange={(d) =>
                  d && setCustom({ from: custom?.from ?? range.from, to: isoDay(d) })
                }
              />
            </>
          ) : null}
          <SegmentedControl
            size="sm"
            aria-label="Group"
            value={groupBy}
            onValueChange={(v) => setGroupBy(v as ReportGroupBy)}
            items={[
              { value: "task", label: "By task" },
              { value: "day", label: "By day" },
            ]}
          />
          <Label className="font-normal text-muted-foreground">
            <Switch checked={round} onCheckedChange={setRound} aria-label="Round to 15 minutes" />
            Round to 15 min
          </Label>
        </div>
        <div className="pane-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {rangeProblem ? (
            <p className="font-sans text-sm text-muted-foreground" role="alert">
              {rangeProblem}
            </p>
          ) : failed ? (
            <EmptyState
              size="inline"
              title="Couldn't load the report"
              description="Check your connection and open it again."
            />
          ) : !report ? (
            <p className="font-sans text-sm text-muted-foreground">Loading…</p>
          ) : report.sections.length === 0 ? (
            <EmptyState
              size="inline"
              title="No tracked time"
              description={`Nothing tracked for ${scope.name} in ${label}.`}
            />
          ) : (
            <ReportBody report={report} />
          )}
          {result?.truncated ? (
            <p className="mt-3 font-sans text-xs text-muted-foreground">
              Showing the first 20,000 entries. Pick a shorter period for the rest.
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-hairline px-4 py-3">
          <span className="font-sans text-sm text-foreground tabular-nums">
            Total {report ? reportLength(report.totalSeconds) : "…"}
          </span>
          <span className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" disabled={!report} onClick={exportCsv}>
              <Download aria-hidden />
              Export CSV
            </Button>
            <Button
              size="sm"
              disabled={!report || report.sections.length === 0}
              onClick={exportPdf}
            >
              <FileText aria-hidden />
              Export PDF
            </Button>
          </span>
        </div>
        {open && report ? (
          <PrintRoot label="Time report, print layout">
            <ReportDocument report={report} scope={scope.name} period={label} rounded={round} />
          </PrintRoot>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** The sheet's lines: sections (projects or days) with their tasks. */
function ReportBody({ report }: { report: ShapedReport }) {
  return (
    <div className="flex flex-col gap-4">
      {report.sections.map((section) => (
        <section key={section.key} className="flex flex-col">
          <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-1">
            <h3 className="min-w-0 break-words font-display text-sm font-medium text-foreground">
              {section.label}
            </h3>
            <span className="shrink-0 font-sans text-sm text-muted-foreground tabular-nums">
              {reportLength(section.seconds)}
            </span>
          </div>
          <ul className="flex flex-col">
            {section.lines.map((line) => (
              <li key={line.key} className="flex items-start gap-3 py-1.5 font-sans text-sm">
                <span className="min-w-0 flex-1">
                  <span className="break-words text-foreground">{line.title}</span>
                  {line.person ? (
                    <span className="text-muted-foreground"> · {line.person}</span>
                  ) : null}
                  {line.notes.length > 0 ? (
                    <span className="block break-words text-xs text-muted-foreground">
                      {line.notes.join(" · ")}
                    </span>
                  ) : null}
                </span>
                <span className="shrink-0 tabular-nums text-foreground">
                  {reportLength(line.seconds)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The printed report (REPLAN 75's "clean, branded time report"): the client
 * or project, the period and the total on top; time by task or by day with
 * notes; who tracked it where more than one person did; a quiet footer.
 */
function ReportDocument({
  report,
  scope,
  period,
  rounded,
}: {
  report: ShapedReport;
  scope: string;
  period: string;
  rounded: boolean;
}) {
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6 font-sans text-sm text-foreground">
      <header className="flex items-end justify-between gap-6 border-b border-border pb-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">Time report</p>
          <h1 className="font-display text-2xl font-semibold text-foreground">{scope}</h1>
          <p className="text-muted-foreground">{period}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="font-display text-2xl font-semibold tabular-nums">
            {reportLength(report.totalSeconds)}
          </p>
          {rounded ? (
            <p className="text-xs text-muted-foreground">Rounded up to 15 minutes</p>
          ) : null}
        </div>
      </header>
      {report.sections.map((section) => (
        <section key={section.key} className="print-avoid-break flex flex-col">
          <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1">
            <h2 className="font-display text-base font-medium">{section.label}</h2>
            <span className="tabular-nums text-muted-foreground">
              {reportLength(section.seconds)}
            </span>
          </div>
          {section.lines.map((line) => (
            <div key={line.key} className="flex items-start gap-4 border-b border-hairline py-1.5">
              <div className="min-w-0 flex-1">
                <p className="break-words">
                  {line.title}
                  {line.person ? (
                    <span className="text-muted-foreground"> · {line.person}</span>
                  ) : null}
                </p>
                {line.notes.length > 0 ? (
                  <p className="break-words text-xs text-muted-foreground">
                    {line.notes.join(" · ")}
                  </p>
                ) : null}
              </div>
              <span className="shrink-0 tabular-nums">{reportLength(line.seconds)}</span>
            </div>
          ))}
        </section>
      ))}
      <footer className="flex justify-between border-t border-border pt-3 text-xs text-muted-foreground">
        <span>{report.showPeople ? report.people.join(", ") : ""}</span>
        <span>Made with Moduo</span>
      </footer>
    </article>
  );
}
