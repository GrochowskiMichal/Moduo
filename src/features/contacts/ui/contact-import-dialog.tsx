// CSV import dialog (block CO-3, specs/contacts.md AC6). A 3-step flow —
// drop → column-map → dedupe-preview → import — that lands the directory
// populated (the adoption gate). The parsing/dedupe brain is pure (../import);
// this is the shell: file intake, the mapping editor, the preview, and the single
// op call. Tokens + shadcn primitives only (R4/R7/R10); sentence case (R8).

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FileUp, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { Company, Contact } from "../model";
import {
  buildImportRows,
  guessColumnMapping,
  IMPORT_FIELDS,
  parseCsv,
  planImport,
  toImportPayload,
  type ContactImportResult,
  type ContactImportRow,
  type ImportAction,
  type ImportField,
} from "../import";

type Step = "drop" | "map" | "preview";

/** Story/test seed — start the dialog mid-flow with parsed data (no file intake). */
export type ImportDialogSeed = {
  fileName?: string;
  headers: string[];
  rows: string[][];
  step?: "map" | "preview";
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existingContacts: Contact[];
  existingCompanies: Company[];
  onImport: (rows: ContactImportRow[]) => Promise<ContactImportResult>;
  /** Called after a successful import (e.g. reload the directory + toast). */
  onDone?: (result: ContactImportResult) => void;
  /** For stories/tests only. */
  seed?: ImportDialogSeed;
};

const ACTION_BADGE: Record<ImportAction, { label: string; variant: "success" | "info" | "secondary" | "destructive" }> = {
  create: { label: "New", variant: "success" },
  merge: { label: "Merge", variant: "info" },
  duplicate: { label: "Duplicate", variant: "secondary" },
  error: { label: "Skipped", variant: "destructive" },
};

export function ContactImportDialog({
  open,
  onOpenChange,
  existingContacts,
  existingCompanies,
  onImport,
  onDone,
  seed,
}: Props) {
  const [step, setStep] = useState<Step>("drop");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [mapping, setMapping] = useState<ImportField[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset (or seed) the flow each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setImporting(false);
    if (seed) {
      setParsed({ headers: seed.headers, rows: seed.rows });
      setMapping(guessColumnMapping(seed.headers));
      setFileName(seed.fileName ?? "contacts.csv");
      setStep(seed.step ?? "map");
    } else {
      setParsed(null);
      setMapping([]);
      setFileName(null);
      setStep("drop");
    }
  }, [open, seed]);

  const rows = useMemo(
    () => (parsed ? buildImportRows(parsed.headers, parsed.rows, mapping) : []),
    [parsed, mapping],
  );
  const plan = useMemo(
    () => planImport(rows, existingContacts, existingCompanies),
    [rows, existingContacts, existingCompanies],
  );

  const hasNameSource = mapping.some((m) => m === "name" || m === "firstName" || m === "lastName");
  const importCount = plan.summary.create + plan.summary.merge;

  function ingest(text: string, name: string) {
    const next = parseCsv(text);
    if (next.headers.length === 0) {
      setError("That file didn’t look like a CSV with a header row.");
      return;
    }
    setError(null);
    setParsed(next);
    setMapping(guessColumnMapping(next.headers));
    setFileName(name);
    setStep("map");
  }

  function handleFile(file: File | undefined | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      ingest(text, file.name);
    };
    reader.onerror = () => setError("Couldn’t read that file.");
    reader.readAsText(file);
  }

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const result = await onImport(toImportPayload(plan));
      onDone?.(result);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Import contacts</DialogTitle>
          <DialogDescription>
            {step === "drop"
              ? "Drop a CSV to add people in bulk. You’ll map columns and preview duplicates before anything is saved."
              : step === "map"
                ? `Match the columns in ${fileName ?? "your file"} to contact fields.`
                : "Review what will happen — nothing is saved until you import."}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        {step === "drop" ? (
          <>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFile(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-8 text-center transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                dragOver ? "border-primary bg-accent" : "bg-muted/40 hover:bg-accent/60",
              )}
            >
              <FileUp className="size-icon text-muted-foreground" aria-hidden />
              <span className="text-sm text-foreground">Drop a CSV here, or click to choose</span>
              <span className="text-xs text-muted-foreground">First row is treated as column headers</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                handleFile(file);
              }}
            />
          </>
        ) : null}

        {step === "map" && parsed ? (
          <ScrollArea className="max-h-80">
            <div className="space-y-1 pr-3">
              {parsed.headers.map((header, idx) => (
                <div key={`${header}-${idx}`} className="flex items-center gap-3 rounded-md px-1 py-1">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">{header || `Column ${idx + 1}`}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {parsed.rows[0]?.[idx]?.trim() || "—"}
                    </div>
                  </div>
                  <Select
                    value={mapping[idx] ?? "ignore"}
                    onValueChange={(value) =>
                      setMapping((prev) => prev.map((m, i) => (i === idx ? (value as ImportField) : m)))
                    }
                  >
                    <SelectTrigger className="w-40" aria-label={`Map column ${header || idx + 1}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {IMPORT_FIELDS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : null}

        {step === "preview" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge variant="success">{plan.summary.create} new</Badge>
              {plan.summary.merge > 0 ? <Badge variant="info">{plan.summary.merge} merge</Badge> : null}
              {plan.summary.duplicate > 0 ? (
                <Badge variant="secondary">{plan.summary.duplicate} duplicate</Badge>
              ) : null}
              {plan.summary.error > 0 ? (
                <Badge variant="destructive">{plan.summary.error} skipped</Badge>
              ) : null}
            </div>
            <ScrollArea className="max-h-72">
              <div className="space-y-0.5 pr-3">
                {plan.entries.map((entry) => {
                  const badge = ACTION_BADGE[entry.action];
                  return (
                    <div
                      key={entry.rowIndex}
                      className="flex items-center gap-2 rounded-md px-1 py-1 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {entry.name.trim() || <span className="text-muted-foreground">(no name)</span>}
                        {entry.email ? (
                          <span className="ml-2 text-xs text-muted-foreground">{entry.email}</span>
                        ) : null}
                      </span>
                      {entry.action === "error" && entry.error ? (
                        <span className="text-xs text-muted-foreground">{entry.error}</span>
                      ) : entry.reason ? (
                        <span className="text-xs text-muted-foreground">{entry.reason}</span>
                      ) : null}
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        ) : null}

        <DialogFooter>
          {step === "map" ? (
            <>
              <Button variant="ghost" onClick={() => setStep("drop")}>
                <ArrowLeft className="size-icon-sm" aria-hidden />
                Back
              </Button>
              <Button onClick={() => setStep("preview")} disabled={!hasNameSource}>
                Continue
              </Button>
            </>
          ) : step === "preview" ? (
            <>
              <Button variant="ghost" onClick={() => setStep("map")}>
                <ArrowLeft className="size-icon-sm" aria-hidden />
                Back
              </Button>
              <Button onClick={() => void handleImport()} disabled={importCount === 0 || importing}>
                <Upload className="size-icon-sm" aria-hidden />
                {importing ? "Importing…" : `Import ${importCount} ${importCount === 1 ? "contact" : "contacts"}`}
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
