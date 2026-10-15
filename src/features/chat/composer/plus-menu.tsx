// The composer's `+` (§4, round-4 frame 3 "plus"): the one way in for what
// isn't text. "Link something" (All · Tasks · Notes · Events · People, recent
// first) puts the same chip a pick from `@` puts; "Create, linked to this
// conversation" opens the app's capture, like `/task` `/note` `/event`.
// "Upload a file" joins with CV-9.

import { Calendar, FileText, ListTodo, User } from "lucide-react";
import { type ReactNode, useState } from "react";

import { useMentionSearch } from "@/features/spine/hooks/use-mention-search";
import { resolveEntityIcon } from "@/features/spine/icon-map";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import type { ChatPerson } from "../model";
import { CREATE_COMMANDS, type CreateCommand, peopleFor } from "./grammar";

type Tab = "all" | "task" | "note" | "event" | "people";

const TABS: ReadonlyArray<{ id: Tab; label: string; Icon?: typeof ListTodo }> = [
  { id: "all", label: "All" },
  { id: "task", label: "Tasks", Icon: ListTodo },
  { id: "note", label: "Notes", Icon: FileText },
  { id: "event", label: "Events", Icon: Calendar },
  { id: "people", label: "People", Icon: User },
];

const CREATE_ICON: Record<CreateCommand, typeof ListTodo> = {
  task: ListTodo,
  note: FileText,
  event: Calendar,
};

export type PlusPick =
  | { kind: "ref"; type: string; id: string; label: string }
  | { kind: "create"; command: CreateCommand };

function Row({
  icon,
  label,
  meta,
  onPick,
}: {
  icon: ReactNode;
  label: string;
  meta: string;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex h-(--ctrl-h) w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) outline-none hover:bg-state-hover focus-visible:bg-state-hover"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{meta}</span>
    </button>
  );
}

export function PlusMenu({
  runtime,
  workspaceId,
  selfId,
  people,
  canCreate,
  onPick,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  selfId: string | null;
  people: readonly ChatPerson[];
  /** Which create entries this person may use (their module's Edit). */
  canCreate: (command: CreateCommand) => boolean;
  onPick: (pick: PlusPick) => void;
}) {
  const [tab, setTab] = useState<Tab>("all");
  const { candidates, loading } = useMentionSearch({
    runtime,
    workspaceId,
    trigger: "ref",
    types: tab === "all" || tab === "people" ? undefined : [tab],
    includePeople: false,
    includeEntities: tab !== "people",
    enabled: tab !== "people",
    debounceMs: 0,
  });
  const things = candidates.filter((c) => c.kind === "entity").slice(0, tab === "all" ? 4 : 6);
  const persons =
    tab === "people" || tab === "all"
      ? peopleFor(
          people.filter((p) => !p.former).map((p) => ({ id: p.userId, name: p.name })),
          "",
          selfId,
          tab === "all" ? 2 : 8,
        )
      : [];
  const creates = CREATE_COMMANDS.filter((c) => canCreate(c.id));

  return (
    <div className="w-75 p-1">
      <p className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">Link something</p>
      <div className="flex gap-0.5 px-1 pb-1" role="tablist" aria-label="Link something">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground",
              tab === id && "bg-state-active text-foreground",
            )}
          >
            {Icon ? <Icon className="size-icon-xs" aria-hidden /> : null}
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-col" role="tabpanel">
        {things.map((c) => {
          if (c.kind !== "entity") return null;
          const Icon = resolveEntityIcon(c.ref.type, c.icon);
          return (
            <Row
              key={`${c.ref.type}:${c.ref.id}`}
              icon={<Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />}
              label={c.label}
              meta={c.ref.type === "bucket" ? "project" : c.ref.type.replace(/_/g, " ")}
              onPick={() => onPick({ kind: "ref", type: c.ref.type, id: c.ref.id, label: c.label })}
            />
          );
        })}
        {persons.map((p) => (
          <Row
            key={`person:${p.id}`}
            icon={<User className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />}
            label={p.name}
            meta="person"
            onPick={() => onPick({ kind: "ref", type: "person", id: p.id, label: p.name })}
          />
        ))}
        {things.length === 0 && persons.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            {loading ? "Searching…" : "Nothing yet."}
          </p>
        ) : null}
      </div>
      {creates.length > 0 ? (
        <>
          <hr className="my-1 border-border" />
          <p className="px-2 pt-1 pb-1 text-xs font-medium text-muted-foreground">
            Create, linked to this conversation
          </p>
          {creates.map((c) => {
            const Icon = CREATE_ICON[c.id];
            return (
              <Row
                key={c.id}
                icon={<Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />}
                label={c.label}
                meta={`/${c.id}`}
                onPick={() => onPick({ kind: "create", command: c.id })}
              />
            );
          })}
        </>
      ) : null}
    </div>
  );
}
