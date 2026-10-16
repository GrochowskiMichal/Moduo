// The project overview's editable parts (TV-U16): its state (Active · On
// hold · Done), dates, lead, client and description. Each saves one field
// through the project op (`projects_op_update`); a refusal puts it back.

import type { ProjectState } from "@contracts/vocabularies";
import { CheckCircle2, Circle, Contact, PauseCircle, Pencil, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../components/ui/command";
import { DateField } from "../../../components/ui/date-field";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { PropertyValue } from "../../../components/ui/property-row";
import { Textarea } from "../../../components/ui/textarea";
import type { EntityRecord } from "../../../lib/entity-links";
import { getRuntime } from "../../../lib/runtime";
import { Reference } from "../../spine/references/ui/reference";
import { assigneeListName, SELF_KEYWORDS } from "../assignee-options";
import { useAssignees } from "../assignees";
import { AssigneeAvatar } from "./assignee-avatar";

export const PROJECT_STATE_LABEL: Record<ProjectState, string> = {
  active: "Active",
  on_hold: "On hold",
  done: "Done",
};

const STATE_ICON: Record<ProjectState, typeof Circle> = {
  active: Circle,
  on_hold: PauseCircle,
  done: CheckCircle2,
};

/** The project's state; Done asks first when work is still open (the page). */
export function ProjectStateValue({
  state,
  canEdit,
  onChange,
}: {
  state: ProjectState;
  canEdit: boolean;
  onChange: (next: ProjectState) => void;
}) {
  const Icon = STATE_ICON[state];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={!canEdit}>
        <PropertyValue icon={<Icon />} aria-label={`Status: ${PROJECT_STATE_LABEL[state]}`}>
          {PROJECT_STATE_LABEL[state]}
        </PropertyValue>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuRadioGroup
          value={state}
          onValueChange={(v) => {
            if (v !== state) onChange(v as ProjectState);
          }}
        >
          {(Object.keys(PROJECT_STATE_LABEL) as ProjectState[]).map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {PROJECT_STATE_LABEL[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** A YYYY-MM-DD day as a local Date (noon, so no zone moves it a day). */
export function dayToDate(day: string | null | undefined): Date | null {
  if (!day) return null;
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A picked Date as its local YYYY-MM-DD. */
export function dateToDay(date: Date | null): string | null {
  if (!date) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** One of the project's dates (start or target), picked on the calendar. */
export function ProjectDateValue({
  day,
  label,
  placeholder,
  canEdit,
  defaultOpen,
  onChange,
}: {
  day: string | null | undefined;
  label: string;
  placeholder: string;
  canEdit: boolean;
  defaultOpen?: boolean;
  onChange: (day: string | null) => void;
}) {
  return (
    <DateField
      variant="property"
      value={dayToDate(day)}
      onChange={(d) => onChange(dateToDay(d))}
      placeholder={placeholder}
      aria-label={label}
      disabled={!canEdit}
      defaultOpen={defaultOpen}
    />
  );
}

/** The project's lead: a member of the workspace, or nobody. */
export function ProjectLeadValue({
  leadId,
  canEdit,
  defaultOpen,
  onChange,
}: {
  leadId: string | null;
  canEdit: boolean;
  defaultOpen?: boolean;
  onChange: (userId: string | null) => void;
}) {
  const { assignees, byId } = useAssignees();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const lead = byId(leadId);
  // The value reads "You", the list "Name (you)" (MOD-137).
  const label = lead ? lead.name : leadId ? "Former member" : "Nobody";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={!canEdit}>
        <PropertyValue
          empty={!leadId}
          icon={lead ? <AssigneeAvatar assignee={lead} size="icon" /> : <UserRound />}
          aria-label={`Lead: ${label}`}
        >
          {label}
        </PropertyValue>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <Command>
          <CommandInput placeholder="Lead…" />
          <CommandList>
            <CommandEmpty>Nobody by that name.</CommandEmpty>
            <CommandGroup>
              {leadId ? (
                <CommandItem
                  value="__none__ no lead"
                  onSelect={() => {
                    setOpen(false);
                    onChange(null);
                  }}
                >
                  <X aria-hidden />
                  No lead
                </CommandItem>
              ) : null}
              {assignees.map((a) => (
                <CommandItem
                  key={a.userId}
                  value={`${a.fullName || a.name} ${a.isMe ? SELF_KEYWORDS.join(" ") : ""} ${a.userId}`}
                  onSelect={() => {
                    setOpen(false);
                    if (a.userId !== leadId) onChange(a.userId);
                  }}
                >
                  <AssigneeAvatar assignee={a} size="icon" />
                  {assigneeListName(a)}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Contacts by name, from the registry (only the ones the reader can see). */
function useContactSearch(workspaceId: string, query: string, open: boolean): EntityRecord[] {
  const [results, setResults] = useState<EntityRecord[]>([]);
  useEffect(() => {
    if (!open) return;
    const runtime = getRuntime();
    if (!runtime) return;
    let live = true;
    const timer = setTimeout(() => {
      runtime.spine
        .searchEntities({ workspaceId, query: query.trim(), types: ["contact"], limit: 8 })
        .then(
          (r) => {
            if (live) setResults(r.filter((e) => !e.deletedAt));
          },
          () => {
            if (live) setResults([]);
          },
        );
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [workspaceId, query, open]);
  return results;
}

/**
 * The project's client: a contact, shown as a reference (it opens their hub,
 * where the client's work and time roll up), changed from the pencil.
 */
export function ProjectClientValue({
  workspaceId,
  clientId,
  canEdit,
  defaultOpen,
  onChange,
}: {
  workspaceId: string;
  clientId: string | null;
  canEdit: boolean;
  defaultOpen?: boolean;
  onChange: (contactId: string | null) => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [query, setQuery] = useState("");
  const results = useContactSearch(workspaceId, query, open);
  const picker = (
    <PopoverContent align="start" className="w-64 p-0">
      <Command shouldFilter={false}>
        <CommandInput value={query} onValueChange={setQuery} placeholder="Client…" />
        <CommandList>
          <CommandEmpty>No contact by that name.</CommandEmpty>
          <CommandGroup>
            {clientId ? (
              <CommandItem
                value="__none__"
                onSelect={() => {
                  setOpen(false);
                  onChange(null);
                }}
              >
                <X aria-hidden />
                No client
              </CommandItem>
            ) : null}
            {results.map((c) => (
              <CommandItem
                key={c.id}
                value={c.id}
                onSelect={() => {
                  setOpen(false);
                  if (c.id !== clientId) onChange(c.id);
                }}
              >
                <Contact aria-hidden />
                {c.label || "Unnamed contact"}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  );
  if (!clientId) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={!canEdit}>
          <PropertyValue empty icon={<Contact />} aria-label="Client: none">
            Pick a client
          </PropertyValue>
        </PopoverTrigger>
        {picker}
      </Popover>
    );
  }
  return (
    // One line: the chip gives way (its name truncates) before the pencil wraps.
    <span className="flex min-w-0 items-center gap-1">
      <Reference type="contact" id={clientId} display="chip" className="min-w-0 shrink" />
      {canEdit ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <IconButton icon={Pencil} label="Change client" className="shrink-0" />
          </PopoverTrigger>
          {picker}
        </Popover>
      ) : null}
    </span>
  );
}

/** Up to the server's 20,000 characters (`buckets_description_length`). */
export const PROJECT_DESCRIPTION_MAX = 20_000;

/**
 * What the project is for, in its own words: plain text, shown as written.
 * Edit opens it in place; ⌘⏎ or leaving the field saves, Esc drops the change.
 */
export function ProjectDescription({
  text,
  canEdit,
  onSave,
}: {
  text: string;
  canEdit: boolean;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const dropped = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);
  const finish = () => {
    setEditing(false);
    if (dropped.current) {
      dropped.current = false;
      setDraft(text);
      return;
    }
    const next = draft.replace(/\s+$/, "");
    if (next !== text) onSave(next);
  };

  if (editing) {
    return (
      <Textarea
        autoFocus
        aria-label="Project description"
        value={draft}
        maxLength={PROJECT_DESCRIPTION_MAX}
        onChange={(e) => setDraft(e.target.value)}
        // Opened to add to it: the caret starts at the end.
        onFocus={(e) => {
          const end = e.currentTarget.value.length;
          e.currentTarget.setSelectionRange(end, end);
        }}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            dropped.current = true;
            e.currentTarget.blur();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        placeholder="What this project is for, who it's for, and what done looks like."
        className="field-sizing-content max-h-96 min-h-24 font-sans text-base"
      />
    );
  }
  if (!text) {
    return canEdit ? (
      <Button
        variant="ghost"
        size="sm"
        className="-ml-1.5 self-start text-muted-foreground"
        onClick={() => setEditing(true)}
      >
        <Pencil aria-hidden />
        Add a description
      </Button>
    ) : null;
  }
  return (
    <div className="group/desc flex items-start gap-1">
      <p className="min-w-0 flex-1 font-sans text-base break-words whitespace-pre-wrap text-foreground">
        {text}
      </p>
      {canEdit ? (
        <IconButton
          icon={Pencil}
          label="Edit description"
          className="shrink-0"
          onClick={() => setEditing(true)}
        />
      ) : null}
    </div>
  );
}
