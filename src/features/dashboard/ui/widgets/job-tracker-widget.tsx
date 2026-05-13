import { useMemo, useState } from "react";
import { getRuntime } from "../../../../lib/runtime";
import { Briefcase, Building2, Calendar, CircleDollarSign, Hash, Link2, Workflow } from "lucide-react";
import type { JobApplicationEntry, JobApplicationStage, JobSalaryUnit, WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

const STAGES: JobApplicationStage[] = [
  "applied",
  "rejected",
  "replied",
  "preinterview",
  "interview",
  "technical",
  "behavioral",
  "staff",
  "decision",
  "hired",
];

const SALARY_UNITS: JobSalaryUnit[] = ["hour", "day", "week", "month", "year"];

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function todayIsoDate(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function stageLabel(stage: JobApplicationStage): string {
  if (stage === "preinterview") return "Preinterview";
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}

function compactUnit(unit: JobSalaryUnit): string {
  if (unit === "hour") return "h";
  if (unit === "day") return "d";
  if (unit === "week") return "w";
  if (unit === "month") return "m";
  return "y";
}

function compactSalary(amount: string): string {
  const normalized = amount.trim().replace(/,/g, "");
  const value = Number(normalized);
  if (!Number.isFinite(value)) return amount.trim();
  const abs = Math.abs(value);
  if (abs >= 1000) {
    const compact = value / 1000;
    return `${compact.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${value}`;
}

function compactDate(value: string, includeYear: boolean): string {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value || "-";
  const day = parsed.getDate();
  const month = parsed.toLocaleDateString(undefined, { month: "short" });
  if (!includeYear) return `${day}${month}`;
  return `${day}${month}${parsed.getFullYear()}`;
}

async function openExternalOfferLink(url: string) {
  const target = url.trim();
  if (!target) return;

  try {
    const rt = getRuntime();
    if (rt) {
      await rt.window.openExternalUrl(target);
      return;
    }
  } catch {
    // Fallback to browser open below.
  }

  if (typeof window !== "undefined") {
    window.open(target, "_blank", "noopener,noreferrer");
  }
}

function normalizeEntries(entries: JobApplicationEntry[] | undefined): JobApplicationEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((entry) => entry && typeof entry.id === "string")
    .map((entry) => ({
      id: entry.id,
      applicationDate: typeof entry.applicationDate === "string" ? entry.applicationDate : todayIsoDate(),
      offerLink: typeof entry.offerLink === "string" ? entry.offerLink : "",
      positionName: typeof entry.positionName === "string" ? entry.positionName : "",
      companyName: typeof entry.companyName === "string" ? entry.companyName : "",
      salaryAmount: typeof entry.salaryAmount === "string" ? entry.salaryAmount : "",
      salaryUnit: SALARY_UNITS.includes(entry.salaryUnit) ? entry.salaryUnit : "year",
      stage: STAGES.includes(entry.stage) ? entry.stage : "applied",
    }));
}

type Props = {
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function JobTrackerWidget({ config, isLocked, onUpdateConfig }: Props) {
  const entries = normalizeEntries(config.jobApplications);
  const [applicationDate, setApplicationDate] = useState(todayIsoDate());
  const [offerLink, setOfferLink] = useState("");
  const [positionName, setPositionName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [salaryAmount, setSalaryAmount] = useState("");
  const [salaryUnit, setSalaryUnit] = useState<JobSalaryUnit>("year");
  const [stage, setStage] = useState<JobApplicationStage>("applied");

  const canAdd = useMemo(
    () => companyName.trim().length > 0 || positionName.trim().length > 0 || offerLink.trim().length > 0,
    [companyName, offerLink, positionName]
  );
  const shouldShowYearInView = useMemo(() => {
    const years = new Set<number>();
    for (const entry of entries) {
      const parsed = new Date(`${entry.applicationDate}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) continue;
      years.add(parsed.getFullYear());
      if (years.size > 1) return true;
    }
    return false;
  }, [entries]);

  const addEntry = () => {
    if (!canAdd || isLocked) return;
    const next: JobApplicationEntry = {
      id: safeId(),
      applicationDate: applicationDate || todayIsoDate(),
      offerLink: offerLink.trim(),
      positionName: positionName.trim(),
      companyName: companyName.trim(),
      salaryAmount: salaryAmount.trim(),
      salaryUnit,
      stage,
    };
    onUpdateConfig({ jobApplications: [next, ...entries] });
    setApplicationDate(todayIsoDate());
    setOfferLink("");
    setPositionName("");
    setCompanyName("");
    setSalaryAmount("");
    setSalaryUnit("year");
    setStage("applied");
  };

  const removeEntry = (id: string) => {
    if (isLocked) return;
    onUpdateConfig({ jobApplications: entries.filter((entry) => entry.id !== id) });
  };

  const updateEntry = (id: string, patch: Partial<JobApplicationEntry>) => {
    if (isLocked) return;
    onUpdateConfig({
      jobApplications: entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    });
  };

  return (
    <WidgetShell config={config} title="Job Application Tracker">
      {!isLocked ? (
        <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="grid gap-1 text-[11px] text-[#8f8f8f]">
              <span>Date of application</span>
              <input
                type="date"
                value={applicationDate}
                onChange={(event) => setApplicationDate(event.target.value)}
                className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"
              />
            </label>
            <label className="grid gap-1 text-[11px] text-[#8f8f8f]">
              <span>Link to offer</span>
              <input
                type="text"
                value={offerLink}
                onChange={(event) => setOfferLink(event.target.value)}
                placeholder="https://..."
                className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"
              />
            </label>
            <label className="grid gap-1 text-[11px] text-[#8f8f8f]">
              <span>Position name</span>
              <input
                type="text"
                value={positionName}
                onChange={(event) => setPositionName(event.target.value)}
                className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"
              />
            </label>
            <label className="grid gap-1 text-[11px] text-[#8f8f8f]">
              <span>Company name</span>
              <input
                type="text"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"
              />
            </label>
            <label className="grid gap-1 text-[11px] text-[#8f8f8f]">
              <span>Salary</span>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  inputMode="decimal"
                  value={salaryAmount}
                  onChange={(event) => setSalaryAmount(event.target.value)}
                  placeholder="120000"
                  className="min-w-0 flex-1 rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"
                />
                <select
                  value={salaryUnit}
                  onChange={(event) => setSalaryUnit(event.target.value as JobSalaryUnit)}
                  className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"
                >
                  {SALARY_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      /{unit}
                    </option>
                  ))}
                </select>
              </div>
            </label>
            <label className="grid gap-1 text-[11px] text-[#8f8f8f]">
              <span>Stage</span>
              <select
                value={stage}
                onChange={(event) => setStage(event.target.value as JobApplicationStage)}
                className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"
              >
                {STAGES.map((next) => (
                  <option key={next} value={next}>
                    {stageLabel(next)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <button
            type="button"
            disabled={!canAdd}
            onClick={addEntry}
            className="rounded border border-[#2b2b2b] bg-[#151515] px-2.5 py-1.5 text-[11px] text-[#d8d8d8] hover:bg-[#1b1b1b] disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Add application
          </button>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {entries.map((entry) => (
              <div key={entry.id} className="mb-2 rounded border border-[#2a2a2a] bg-[#131313] p-2">
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-[10px] text-[#7f7f7f]">
                    <span>Company</span>
                    <input
                      type="text"
                      value={entry.companyName}
                      onChange={(event) => updateEntry(entry.id, { companyName: event.target.value })}
                      className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"
                    />
                  </label>
                  <label className="grid gap-1 text-[10px] text-[#7f7f7f]">
                    <span>Position</span>
                    <input
                      type="text"
                      value={entry.positionName}
                      onChange={(event) => updateEntry(entry.id, { positionName: event.target.value })}
                      className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"
                    />
                  </label>
                  <label className="grid gap-1 text-[10px] text-[#7f7f7f]">
                    <span>Stage</span>
                    <select
                      value={entry.stage}
                      onChange={(event) => updateEntry(entry.id, { stage: event.target.value as JobApplicationStage })}
                      className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"
                    >
                      {STAGES.map((next) => (
                        <option key={next} value={next}>
                          {stageLabel(next)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-[10px] text-[#7f7f7f]">
                    <span>Date</span>
                    <input
                      type="date"
                      value={entry.applicationDate}
                      onChange={(event) => updateEntry(entry.id, { applicationDate: event.target.value })}
                      className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"
                    />
                  </label>
                  <label className="grid gap-1 text-[10px] text-[#7f7f7f]">
                    <span>Salary</span>
                    <div className="flex gap-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={entry.salaryAmount}
                        onChange={(event) => updateEntry(entry.id, { salaryAmount: event.target.value })}
                        className="min-w-0 flex-1 rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"
                      />
                      <select
                        value={entry.salaryUnit}
                        onChange={(event) => updateEntry(entry.id, { salaryUnit: event.target.value as JobSalaryUnit })}
                        className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"
                      >
                        {SALARY_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            /{unit}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <label className="grid gap-1 text-[10px] text-[#7f7f7f]">
                    <span>Offer link</span>
                    <input
                      type="text"
                      value={entry.offerLink}
                      onChange={(event) => updateEntry(entry.id, { offerLink: event.target.value })}
                      placeholder="https://..."
                      className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#d8d8d8] outline-none"
                    />
                  </label>
                </div>

                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    className="rounded border border-[#2b2b2b] bg-[#151515] px-2 py-1 text-[10px] text-[#cfcfcf] hover:bg-[#1b1b1b]"
                    onClick={() => removeEntry(entry.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
          {entries.length === 0 ? (
            <p className="text-[12px] text-[#7f7f7f]">No applications.</p>
          ) : (
            <div className="grid gap-1.5">
              <div className="grid grid-cols-[36px_repeat(6,minmax(0,1fr))] gap-1 text-[#7f7f7f]">
                <span className="flex items-center">
                  <Hash size={12} />
                </span>
                <span className="flex items-center">
                  <Building2 size={12} />
                </span>
                <span className="flex items-center">
                  <Briefcase size={12} />
                </span>
                <span className="flex items-center">
                  <Workflow size={12} />
                </span>
                <span className="flex items-center">
                  <Calendar size={12} />
                </span>
                <span className="flex items-center">
                  <CircleDollarSign size={12} />
                </span>
                <span className="flex items-center">
                  <Link2 size={12} />
                </span>
              </div>
              {entries.map((entry, index) => (
                <div key={entry.id} className="grid grid-cols-[36px_repeat(6,minmax(0,1fr))] gap-1 text-[10px] text-[#d8d8d8]">
                  <span className="truncate text-[#8f8f8f]">{index + 1}</span>
                  <span className="truncate">{entry.companyName || "-"}</span>
                  <span className="truncate">{entry.positionName || "-"}</span>
                  <span className="truncate">{stageLabel(entry.stage)}</span>
                  <span className="truncate">{compactDate(entry.applicationDate, shouldShowYearInView)}</span>
                  <span className="truncate">
                    {entry.salaryAmount ? `${compactSalary(entry.salaryAmount)}/${compactUnit(entry.salaryUnit)}` : "-"}
                  </span>
                  <span className="truncate">
                    {entry.offerLink ? (
                      <a
                        href={entry.offerLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#d8d8d8] underline decoration-[#3a3a3a] underline-offset-2"
                        onClick={(event) => {
                          event.preventDefault();
                          void openExternalOfferLink(entry.offerLink);
                        }}
                      >
                        Offer link
                      </a>
                    ) : (
                      "-"
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
