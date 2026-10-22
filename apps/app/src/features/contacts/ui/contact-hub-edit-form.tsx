// The card's edit mode: title, status, company, channels, dates and custom
// fields, all reading and writing the one draft (Save sends a single patch).

import { Building2, X } from "lucide-react";
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
import type { ModuoRuntime } from "@/lib/runtime.types";
import type { MentionCandidate } from "../../spine/mention";
import { selectOptionsFor } from "../field-defs";
import type { ContactFieldDef, ContactFieldType } from "../model";
import { contactStatusMeta } from "../status";
import { AddFieldInline, ChannelEditor, DatesEditor, NO_STATUS } from "./contact-hub-editors";
import type { Draft } from "./contact-hub-model";
import { ContactStatusDot } from "./contact-status-badge";
import { EntityLinkPicker } from "./entity-link-picker";

type Props = {
  draft: Draft;
  setDraft: (draft: Draft) => void;
  statusOptions: { id: string; label: string }[];
  companyName?: string | null;
  fieldDefs: ContactFieldDef[];
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  onSetCompany: (candidate: MentionCandidate) => void;
  onClearCompany?: () => void;
  onAddField?: (label: string, type: ContactFieldType, options?: string[]) => void;
  onDeleteField?: (fieldId: string) => void;
};

export function ContactEditForm({
  draft,
  setDraft,
  statusOptions,
  companyName,
  fieldDefs,
  runtime,
  workspaceId,
  onSetCompany,
  onClearCompany,
  onAddField,
  onDeleteField,
}: Props) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="c-title">Title</Label>
          <Input
            id="c-title"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            placeholder="Head of ops"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-status">Status</Label>
          <Select
            value={contactStatusMeta(draft.status).id || NO_STATUS}
            onValueChange={(v) => setDraft({ ...draft, status: v === NO_STATUS ? "" : v })}
          >
            <SelectTrigger id="c-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statusOptions.map((s) => (
                <SelectItem key={s.id || "none"} value={s.id || NO_STATUS}>
                  <span className="flex items-center gap-1.5">
                    {s.id ? <ContactStatusDot status={s.id} /> : null}
                    {s.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Company</Label>
        <div className="flex items-center gap-1">
          <EntityLinkPicker
            runtime={runtime}
            workspaceId={workspaceId}
            types={["company"]}
            canCreate
            createType="company"
            placeholder="Find or create a company…"
            emptyLabel="No companies."
            trigger={
              <Button variant="outline" size="sm" className="gap-1.5">
                <Building2 className="size-icon-sm" aria-hidden />
                {companyName ?? "Set company"}
              </Button>
            }
            onPick={onSetCompany}
          />
          {companyName && onClearCompany ? (
            <IconButton
              icon={X}
              label="Remove company"
              size="sm"
              variant="ghost"
              onClick={onClearCompany}
            />
          ) : null}
        </div>
      </div>
      <ChannelEditor
        label="Email"
        placeholder="name@example.com"
        rows={draft.emails}
        onChange={(r) => setDraft({ ...draft, emails: r })}
      />
      <ChannelEditor
        label="Phone"
        placeholder="+1 555 0100"
        rows={draft.phones}
        onChange={(r) => setDraft({ ...draft, phones: r })}
      />
      <ChannelEditor
        label="URL"
        placeholder="https://…"
        rows={draft.urls}
        onChange={(r) => setDraft({ ...draft, urls: r })}
      />
      <ChannelEditor
        label="Address"
        placeholder="123 Main St, City"
        rows={draft.addresses}
        onChange={(r) => setDraft({ ...draft, addresses: r })}
      />
      <DatesEditor rows={draft.dates} onChange={(r) => setDraft({ ...draft, dates: r })} />
      <div className="space-y-1.5">
        <Label>Custom fields</Label>
        {fieldDefs.map((f) => (
          <div key={f.id} className="flex items-center gap-1.5">
            <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{f.label}</span>
            {f.type === "select" ? (
              <Select
                value={(draft.custom[f.key] ?? "") || NO_STATUS}
                onValueChange={(v) =>
                  setDraft({
                    ...draft,
                    custom: { ...draft.custom, [f.key]: v === NO_STATUS ? "" : v },
                  })
                }
              >
                <SelectTrigger className="min-w-0 flex-1" aria-label={f.label}>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STATUS}>
                    <span className="text-muted-foreground">None</span>
                  </SelectItem>
                  {selectOptionsFor(f, draft.custom[f.key] ?? "").map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                value={draft.custom[f.key] ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, custom: { ...draft.custom, [f.key]: e.target.value } })
                }
                className="min-w-0 flex-1"
                aria-label={f.label}
              />
            )}
            {onDeleteField ? (
              <IconButton
                icon={X}
                label={`Remove ${f.label} field`}
                size="sm"
                variant="ghost"
                onClick={() => onDeleteField(f.id)}
              />
            ) : null}
          </div>
        ))}
        {onAddField ? <AddFieldInline onAdd={onAddField} /> : null}
      </div>
    </div>
  );
}
