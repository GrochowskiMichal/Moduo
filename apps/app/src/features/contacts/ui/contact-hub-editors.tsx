// The card's inline editors: labelled multi-value channels (email, phone, URL,
// address), labelled dates, and the "add a custom field" control.

import { Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { parseFieldOptions } from "../field-defs";
import type { ContactChannel, ContactDateEntry, ContactFieldType } from "../model";

// Radix Select forbids an empty-string item value, so "No status" rides a sentinel.
export const NO_STATUS = "__none__";

export function ChannelEditor({
  label,
  rows,
  placeholder,
  onChange,
}: {
  label: string;
  rows: ContactChannel[];
  placeholder: string;
  onChange: (rows: ContactChannel[]) => void;
}) {
  const set = (i: number, patch: Partial<ContactChannel>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={r.label}
            onChange={(e) => set(i, { label: e.target.value })}
            placeholder="label"
            className="w-24 shrink-0"
            aria-label={`${label} label`}
          />
          <Input
            value={r.value}
            onChange={(e) => set(i, { value: e.target.value })}
            placeholder={placeholder}
            className="min-w-0 flex-1"
            aria-label={label}
          />
          <IconButton
            icon={X}
            label="Remove"
            size="sm"
            variant="ghost"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => onChange([...rows, { label: "", value: "", primary: rows.length === 0 }])}
      >
        <Plus className="size-icon-sm" aria-hidden />
        Add {label.toLowerCase()}
      </Button>
    </div>
  );
}

export function DatesEditor({
  rows,
  onChange,
}: {
  rows: ContactDateEntry[];
  onChange: (rows: ContactDateEntry[]) => void;
}) {
  const set = (i: number, patch: Partial<ContactDateEntry>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-1.5">
      <Label>Dates</Label>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <Input
            value={r.label}
            onChange={(e) => set(i, { label: e.target.value })}
            placeholder="birthday"
            className="w-24 shrink-0"
            aria-label="Date label"
          />
          <Input
            type="date"
            value={r.value}
            onChange={(e) => set(i, { value: e.target.value })}
            className="min-w-0 flex-1"
            aria-label="Date"
          />
          <IconButton
            icon={X}
            label="Remove"
            size="sm"
            variant="ghost"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
          />
        </div>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => onChange([...rows, { label: "birthday", value: "" }])}
      >
        <Plus className="size-icon-sm" aria-hidden />
        Add date
      </Button>
    </div>
  );
}

// "date" is deliberately absent — labelled dates already live in the Dates
// section; offering a date custom field would create a second dates concept.
// "select" is single-select only (multi_select stays deferred; FX-8).
const FIELD_TYPES: ContactFieldType[] = ["text", "number", "url", "select"];

/** Inline "add a custom field" control (defines a workspace field def). A
 * `select` field asks for its options inline (comma-separated) before it can be
 * added (FX-8). */
export function AddFieldInline({
  onAdd,
}: {
  onAdd: (label: string, type: ContactFieldType, options?: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ContactFieldType>("text");
  const [optionsInput, setOptionsInput] = useState("");

  const parsedOptions = parseFieldOptions(optionsInput);
  const canAdd = label.trim().length > 0 && (type !== "select" || parsedOptions.length > 0);
  const reset = () => {
    setLabel("");
    setType("text");
    setOptionsInput("");
    setOpen(false);
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-icon-sm" aria-hidden />
        Add field
      </Button>
    );
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Field name"
          className="min-w-0 flex-1"
          aria-label="New field name"
          autoFocus
        />
        <Select value={type} onValueChange={(v) => setType(v as ContactFieldType)}>
          <SelectTrigger className="w-24" aria-label="Field type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FIELD_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!canAdd}
          onClick={() => {
            onAdd(label.trim(), type, type === "select" ? parsedOptions : undefined);
            reset();
          }}
        >
          Add
        </Button>
        <IconButton icon={X} label="Cancel" size="sm" variant="ghost" onClick={reset} />
      </div>
      {type === "select" ? (
        <Input
          value={optionsInput}
          onChange={(e) => setOptionsInput(e.target.value)}
          placeholder="Options, comma-separated"
          aria-label="Select options"
          className="w-full"
        />
      ) : null}
    </div>
  );
}
