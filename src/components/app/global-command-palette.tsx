import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  FilePlus2,
  Calendar as CalendarIcon,
  CheckSquare,
  Contact as ContactIcon,
  FileText,
  House,
  Inbox,
  Settings as SettingsIcon,
  Upload,
  UserPlus,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../ui/command";
import { onShortcut, SHORTCUTS, formatShortcut } from "../../lib/shortcuts";
import { dispatchOpenSettings } from "../../features/settings/settings-events";
import { ENTITY_OPEN_EVENT } from "../../lib/entity-open";
import { groupPaletteResults, PALETTE_ENTITY_TYPES } from "../../lib/palette-search";
import { resolveEntityIcon } from "../../features/spine/icon-map";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import type { EntityRecord } from "../../lib/entity-links";

type Action = {
  id: string;
  label: string;
  hint?: string;
  icon: typeof FileText;
  shortcut?: string;
  run: () => void;
};

const PALETTE_OPEN_EVENT = "moduo:palette:open";

// Debounce matches the @mention/`/ref` pickers (useMentionSearch) — one search
// cadence across the app.
const SEARCH_DEBOUNCE_MS = 150;

// Humanized per-result type badge (distinguishes contact vs company inside the
// Contacts group, task vs project inside Tasks, …).
const TYPE_LABEL: Record<string, string> = {
  task: "Task",
  project: "Project",
  note: "Note",
  contact: "Contact",
  company: "Company",
  email: "Email",
  email_thread: "Email",
  event: "Event",
};

export function dispatchOpenPalette() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
}

export function GlobalCommandPalette() {
  const navigate = useNavigate();
  const { runtime } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const reqRef = useRef(0);
  const trimmed = query.trim();

  useEffect(() => onShortcut("palette", () => setOpen((prev) => !prev)), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => setOpen(true);
    window.addEventListener(PALETTE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PALETTE_OPEN_EVENT, onOpen);
  }, []);

  // Reset the query + results each time the palette closes so it reopens fresh.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSearching(false);
    }
  }, [open]);

  // Debounced registry search — last-write-wins via a request counter so a slow
  // response can't overwrite a newer query's results. Only navigable kinds are
  // fetched (PALETTE_ENTITY_TYPES); results deep-link through the entity-open
  // event, riding DF-1's route map (tasks/notes/contacts select; email/calendar
  // degrade to their module page until DF-2 wires URL selection there).
  useEffect(() => {
    if (!open) return;
    if (!trimmed || !runtime || !selectedWorkspaceId) {
      setResults([]);
      setSearching(false);
      return;
    }
    const reqId = ++reqRef.current;
    setSearching(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const records = await runtime.spine.searchEntities({
            workspaceId: selectedWorkspaceId,
            query: trimmed,
            types: PALETTE_ENTITY_TYPES,
            limit: 20,
          });
          if (reqId === reqRef.current) setResults(records);
        } catch {
          if (reqId === reqRef.current) setResults([]);
        } finally {
          if (reqId === reqRef.current) setSearching(false);
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, trimmed, runtime, selectedWorkspaceId]);

  const resultGroups = useMemo(() => groupPaletteResults(results), [results]);

  const go = useCallback(
    (to: string) => () => {
      setOpen(false);
      void navigate({ to });
    },
    [navigate],
  );

  // Deep-link a result the same way widget rows / note chips / notifications do:
  // dispatch the spine's entity-open event; the app-chrome host listener resolves
  // the route, marks the external-open intent, and toasts if a type has no page
  // yet. Keeps one deep-link grammar app-wide.
  const openEntityResult = useCallback((record: EntityRecord) => {
    setOpen(false);
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: record.type, id: record.id } }),
    );
  }, []);

  const settingsShortcut = SHORTCUTS.find((s) => s.id === "settings");
  const settingsLabel = settingsShortcut ? formatShortcut(settingsShortcut) : "";
  const newNoteShortcut = SHORTCUTS.find((s) => s.id === "new-note");
  const newNoteLabel = newNoteShortcut ? formatShortcut(newNoteShortcut) : "";

  const navActions: Action[] = [
    { id: "home", label: "Open Home", icon: House, run: go("/") },
    { id: "notes", label: "Open Notes", icon: FileText, run: go("/notes") },
    { id: "tasks", label: "Open Tasks", icon: CheckSquare, run: go("/tasks") },
    { id: "calendar", label: "Open Calendar", icon: CalendarIcon, run: go("/calendar") },
    // Mindmap is hidden from the alpha (DF-4) — omitted from the palette too so
    // nav/palette stay in sync. The /mindmap route stays reachable directly.
    { id: "email", label: "Open Email", icon: Inbox, run: go("/email") },
    { id: "contacts", label: "Open Contacts", icon: ContactIcon, run: go("/contacts") },
  ];

  // Notes capture works from any page (Wave-3 AC1): same `action` pattern.
  const notesActions: Action[] = [
    {
      id: "new-note",
      label: "New note",
      icon: FilePlus2,
      shortcut: newNoteLabel,
      run: () => {
        setOpen(false);
        void navigate({ to: "/notes", search: (prev) => ({ ...prev, action: "new" as const }) });
      },
    },
  ];

  // Contacts actions work from any page: navigate carrying an `action` search
  // param; the contacts page opens the dialog and clears the param (FX-1 AC2).
  const contactsActions: Action[] = [
    {
      id: "new-contact",
      label: "New contact",
      icon: UserPlus,
      run: () => {
        setOpen(false);
        // Functional updater — an object literal would REPLACE the whole
        // search and wipe an existing ?type&id selection on /contacts.
        void navigate({ to: "/contacts", search: (prev) => ({ ...prev, action: "new" as const }) });
      },
    },
    {
      id: "import-contacts",
      label: "Import contacts",
      icon: Upload,
      run: () => {
        setOpen(false);
        void navigate({ to: "/contacts", search: (prev) => ({ ...prev, action: "import" as const }) });
      },
    },
  ];

  const settingsActions: Action[] = [
    {
      id: "settings",
      label: "Settings",
      icon: SettingsIcon,
      shortcut: settingsLabel,
      run: () => {
        setOpen(false);
        dispatchOpenSettings();
      },
    },
  ];

  // Static actions filter locally by label substring (cmdk's own filter is off —
  // entity results are server-filtered and would otherwise be dropped). Empty
  // query shows every action.
  const q = trimmed.toLowerCase();
  const filterActions = (actions: Action[]) =>
    q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions;
  const visibleNav = filterActions(navActions);
  const visibleNotes = filterActions(notesActions);
  const visibleContacts = filterActions(contactsActions);
  const visibleSettings = filterActions(settingsActions);
  const actionCount =
    visibleNav.length + visibleNotes.length + visibleContacts.length + visibleSettings.length;

  const showNoResults =
    trimmed.length > 0 && !searching && resultGroups.length === 0 && actionCount === 0;

  const renderAction = ({ id, label, icon: Icon, shortcut, run }: Action) => (
    <CommandItem key={id} value={`action:${id}`} onSelect={run}>
      <Icon />
      <span>{label}</span>
      {shortcut ? <CommandShortcut>{shortcut}</CommandShortcut> : null}
    </CommandItem>
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      className="max-w-xl"
      commandProps={{ shouldFilter: false }}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search tasks, notes, contacts… or jump to a page"
      />
      <CommandList>
        {visibleNav.length > 0 ? (
          <CommandGroup heading="Navigate">{visibleNav.map(renderAction)}</CommandGroup>
        ) : null}
        {visibleNotes.length > 0 ? (
          <CommandGroup heading="Notes">{visibleNotes.map(renderAction)}</CommandGroup>
        ) : null}
        {visibleContacts.length > 0 ? (
          <CommandGroup heading="Contacts">{visibleContacts.map(renderAction)}</CommandGroup>
        ) : null}
        {visibleSettings.length > 0 ? (
          <CommandGroup heading="Workspace">{visibleSettings.map(renderAction)}</CommandGroup>
        ) : null}

        {/* Keep prior results on screen while a newer query debounces (like the
            @mention picker) — only blank to "Searching…" when there's nothing
            yet to show, so fast typing doesn't flicker the primary ⌘K surface. */}
        {resultGroups.length > 0
          ? resultGroups.map((group) => (
              <CommandGroup key={group.key} heading={group.heading}>
                {group.items.map((record) => {
                  const Icon = resolveEntityIcon(record.type, record.icon);
                  return (
                    <CommandItem
                      key={`${record.type}:${record.id}`}
                      value={`entity:${record.type}:${record.id}`}
                      onSelect={() => openEntityResult(record)}
                    >
                      <Icon />
                      <span className="min-w-0 flex-1 truncate">
                        {record.label || "Untitled"}
                      </span>
                      <span className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground/70">
                        {TYPE_LABEL[record.type] ?? record.type}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            ))
          : trimmed && searching
            ? (
                <div className="py-6 text-center text-sm text-muted-foreground" role="status">
                  Searching…
                </div>
              )
            : null}

        {showNoResults ? <CommandEmpty>No results.</CommandEmpty> : null}
      </CommandList>
    </CommandDialog>
  );
}
