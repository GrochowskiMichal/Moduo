// Connective-tissue spine — the @mention / /ref picker (block CT-4).
//
// One reusable, registry-backed picker for every link gesture: the Lexical
// `@`/`/ref` plugin opens it at the caret, and non-editor surfaces (a "Link to…"
// button, the keyboard drag fallback) can drop it into a Popover. It searches
// the central `entities` registry via `runtime.spine.searchEntities` (tombstones
// excluded server-side) and optionally merges workspace members so a person can
// be @-mentioned. Selection emits a {@link MentionPick}; the caller resolves it
// with `resolveMentionAction`. shadcn Command (R4); tokens only (R10); neutral —
// the type glyph, not a hue, distinguishes results (R5).

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { EntityRecord, EntityRef } from "@/lib/entity-links";
import type { ModuoRuntime } from "@/lib/runtime.types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { resolveEntityIcon } from "../icon-map";
import type { MentionPick } from "../mention";

/** A workspace member shown alongside entities so a person can be mentioned. */
export type MentionMember = { userId: string; name: string };

/** Records for the registry-backed picker + a loading flag (one indexed search). */
export function useEntitySearch(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  opts: { query: string; types?: string[]; enabled?: boolean; limit?: number },
): { records: EntityRecord[]; loading: boolean } {
  const { query, types, enabled = true, limit } = opts;
  const [records, setRecords] = useState<EntityRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const typesKey = types?.join(",") ?? "";

  useEffect(() => {
    if (!runtime || !workspaceId || !enabled) {
      setRecords([]);
      return;
    }
    // Cancellation guard: a stale search must not paint over a newer query.
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const found = await runtime.spine.searchEntities({
          workspaceId,
          query,
          types: typesKey ? typesKey.split(",") : undefined,
          limit,
        });
        if (active) setRecords(found);
      } catch {
        if (active) setRecords([]);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, query, typesKey, enabled, limit]);

  return { records, loading };
}

export type MentionPickerProps = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** Scope to one type (a `/`-ref command) or leave undefined for the whole registry (`@`). */
  types?: string[];
  /** Members to offer for a person mention (`@`). Filtered by the query locally. */
  members?: MentionMember[];
  /** When set, an empty/no-exact-match query offers "Create '<query>'" of this type. */
  createType?: string | null;
  /** Seed the input (e.g. the text already typed after the trigger). */
  initialQuery?: string;
  autoFocus?: boolean;
  placeholder?: string;
  onPick: (pick: MentionPick) => void;
  className?: string;
};

export function MentionPicker({
  runtime,
  workspaceId,
  types,
  members = [],
  createType = null,
  initialQuery = "",
  autoFocus = true,
  placeholder = "Search…",
  onPick,
  className,
}: MentionPickerProps) {
  const [query, setQuery] = useState(initialQuery);
  const { records, loading } = useEntitySearch(runtime, workspaceId, { query, types });

  const trimmed = query.trim();
  const matchedMembers = trimmed
    ? members.filter((m) => m.name.toLowerCase().includes(trimmed.toLowerCase()))
    : members;
  const needle = trimmed.toLowerCase();
  const exactExists =
    records.some((r) => r.label.trim().toLowerCase() === needle) ||
    matchedMembers.some((m) => m.name.trim().toLowerCase() === needle);
  const showCreate = Boolean(createType) && trimmed.length > 0 && !exactExists;

  return (
    <Command shouldFilter={false} className={className} label="Link to an entity">
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={placeholder}
        autoFocus={autoFocus}
      />
      <CommandList>
        {!loading && records.length === 0 && matchedMembers.length === 0 && !showCreate ? (
          <CommandEmpty>No matches.</CommandEmpty>
        ) : null}

        {matchedMembers.length > 0 ? (
          <CommandGroup heading="People">
            {matchedMembers.map((m) => (
              <CommandItem
                key={`person:${m.userId}`}
                value={`person:${m.userId}`}
                onSelect={() => onPick({ kind: "person", userId: m.userId, name: m.name })}
              >
                <MemberAvatar name={m.name} />
                <span className="min-w-0 truncate">{m.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}

        {records.length > 0 ? (
          <CommandGroup heading={matchedMembers.length > 0 ? "Entities" : undefined}>
            {records.map((r) => {
              const ref: EntityRef = { type: r.type, id: r.id };
              const Icon = resolveEntityIcon(r.type, r.icon);
              return (
                <CommandItem
                  key={`entity:${r.type}:${r.id}`}
                  value={`entity:${r.type}:${r.id}`}
                  onSelect={() =>
                    onPick({ kind: "entity", ref, label: r.label, icon: r.icon })
                  }
                >
                  <Icon className="size-icon-sm" aria-hidden />
                  <span className="min-w-0 truncate">{r.label}</span>
                  <span className="ml-auto shrink-0 text-2xs uppercase tracking-wide text-muted-foreground/70">
                    {r.type}
                  </span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}

        {showCreate && createType ? (
          <>
            {records.length > 0 || matchedMembers.length > 0 ? <CommandSeparator /> : null}
            <CommandGroup>
              <CommandItem
                value="__create__"
                onSelect={() => onPick({ kind: "create", entityType: createType, label: trimmed })}
              >
                <Plus className="size-icon-sm" aria-hidden />
                <span className="min-w-0 truncate">
                  Create {createType} “{trimmed}”
                </span>
              </CommandItem>
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </Command>
  );
}

/** A quiet monogram avatar — no hue (R5); initials carry identity. */
function MemberAvatar({ name }: { name: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "?";
  return (
    <span className="flex size-icon-sm items-center justify-center rounded-full bg-accent text-2xs text-muted-foreground">
      {initials}
    </span>
  );
}
