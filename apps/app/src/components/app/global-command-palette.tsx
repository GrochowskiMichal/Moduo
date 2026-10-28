import type { SearchAllRow, SearchHit, SearchRecent } from "@contracts/search";
import { useNavigate } from "@tanstack/react-router";
import {
  Calendar as CalendarIcon,
  CheckSquare,
  Contact as ContactIcon,
  FilePlus2,
  FileText,
  House,
  Inbox,
  MessagesSquare,
  Settings as SettingsIcon,
  Upload,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePaletteMail } from "../../features/email/hooks/use-palette-mail";
import { mergeMailRows } from "../../features/email/search-palette";
import { dispatchOpenSettings } from "../../features/settings/settings-events";
import { taskIdForHandle } from "../../features/tasks/search";
import { ENTITY_OPEN_EVENT } from "../../lib/entity-open";
import {
  buildPaletteView,
  chipForGroup,
  chipTypes,
  openEntityFromUrl,
  type PaletteChipKey,
  paletteChips,
  searchableQuery,
} from "../../lib/palette-search";
import { formatShortcut, onShortcut, SHORTCUTS } from "../../lib/shortcuts";
import { findWorkspaceStore } from "../../lib/sync/store";
import { taskHandle } from "../../lib/task-handle";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { announceOverlayOpen, onOtherOverlayOpen } from "./global-overlay-events";
import {
  GlobalSearchPalette,
  type PaletteAction,
  type PaletteNotice,
  type PaletteRecent,
} from "./global-search-palette";

const PALETTE_OPEN_EVENT = "moduo:palette:open";

// Debounce matches the @mention/`/ref` pickers (useMentionSearch) — one search
// cadence across the app.
const SEARCH_DEBOUNCE_MS = 150;
// The thin progress line shows only once a reply takes longer than this (Q22).
const SLOW_MS = 300;
// Rows per type: enough for a group of 3 and the Top result with All; a
// chip's own groups in full (the server's most).
const LIMIT_ALL = 8;
const LIMIT_CHIP = 50;
// Recent with an empty query (Q11).
const RECENT_LIMIT = 8;

export function dispatchOpenPalette() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
}

/** Why a failed search failed: the server gave up after 5 s (57014), or the
 *  rest (offline, a network or server error), said once and quietly (Q21). */
function noticeFor(error: unknown): Exclude<PaletteNotice, null> {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "57014" ? "timeout" : "offline";
}

export function GlobalCommandPalette() {
  const navigate = useNavigate();
  const { runtime } = useAuth();
  const { selectedWorkspaceId, selectedWorkspace, modulePermissions } = useWorkspace();
  const taskKey = selectedWorkspace?.taskKey ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<PaletteChipKey>("all");
  // search_all's last answer. It stays on screen while the next query is on
  // its way, so typing never flashes the list empty.
  const [rows, setRows] = useState<SearchAllRow[]>([]);
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [notice, setNotice] = useState<PaletteNotice>(null);
  // The item open when ⌘K opened: a hit linked to it ranks up.
  const [context, setContext] = useState<{ type: string; id: string } | null>(null);
  const reqRef = useRef(0);
  // ⌘K's Recent (GS-8): read each time the palette opens.
  const [recents, setRecents] = useState<SearchRecent[]>([]);
  const chatOn = modulePermissions.chat !== "none";
  const trimmed = query.trim();
  const searchable = searchableQuery(trimmed);

  useEffect(() => onShortcut("palette", () => setOpen((prev) => !prev)), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => setOpen(true);
    window.addEventListener(PALETTE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PALETTE_OPEN_EVENT, onOpen);
  }, []);

  // Mutual exclusion with the capture bar (and any future global overlay) so two
  // floating dialogs never stack — announce on open, close on another's open.
  useEffect(() => {
    if (open) announceOverlayOpen("palette");
  }, [open]);
  useEffect(() => onOtherOverlayOpen("palette", () => setOpen(false)), []);

  // Reset each time the palette closes so it reopens fresh (Q16c); read the
  // item open now when it opens.
  useEffect(() => {
    if (open) {
      if (typeof window !== "undefined") {
        setContext(openEntityFromUrl(window.location.pathname, window.location.search));
      }
      return;
    }
    setQuery("");
    setChip("all");
    setRows([]);
    setPending(false);
    setSlow(false);
    setNotice(null);
    setRecents([]);
  }, [open]);

  // Recent, read once per opening; a failed read just leaves it out.
  useEffect(() => {
    if (!open || !runtime || !selectedWorkspaceId) return;
    let live = true;
    runtime.spine.recents({ workspaceId: selectedWorkspaceId, limit: RECENT_LIMIT }).then(
      (rows) => {
        if (live) setRecents(rows);
      },
      () => {
        if (live) setRecents([]);
      },
    );
    return () => {
      live = false;
    };
  }, [open, runtime, selectedWorkspaceId]);

  // search_all (GS-3), debounced, the last request winning. The previous
  // answer stays up until the new one arrives; a reply slower than 300 ms
  // draws the progress line; a failed one leaves one quiet line.
  const types = chipTypes(chip);
  const typesKey = types.join(",");
  const contextKey = context ? `${context.type}:${context.id}` : "";
  useEffect(() => {
    if (!open) return;
    const reqId = ++reqRef.current;
    if (!searchable || !runtime || !selectedWorkspaceId) {
      setRows([]);
      setPending(false);
      setSlow(false);
      setNotice(null);
      return;
    }
    const wanted = typesKey.split(",");
    setPending(true);
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(() => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setRows([]);
        setNotice("offline");
        setPending(false);
        return;
      }
      slowTimer = setTimeout(() => {
        if (reqId === reqRef.current) setSlow(true);
      }, SLOW_MS);
      const [ctxType, ctxId] = contextKey ? contextKey.split(":") : [];
      void (async () => {
        try {
          const answer = await runtime.spine.searchAll({
            workspaceId: selectedWorkspaceId,
            query: trimmed,
            types: wanted,
            limitPerType: chip === "all" ? LIMIT_ALL : LIMIT_CHIP,
            context: ctxType && ctxId ? { type: ctxType, id: ctxId } : null,
          });
          if (reqId !== reqRef.current) return;
          setRows(answer);
          setNotice(null);
        } catch (error) {
          if (reqId !== reqRef.current) return;
          setRows([]);
          setNotice(noticeFor(error));
        } finally {
          if (reqId === reqRef.current) {
            clearTimeout(slowTimer);
            setPending(false);
            setSlow(false);
          }
        }
      })();
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(slowTimer);
      reqRef.current++;
    };
  }, [open, searchable, trimmed, chip, typesKey, contextKey, runtime, selectedWorkspaceId]);

  // A task's ID finds it (MOD-144): "MOD-99", "mod-99" or "mod 99", read in
  // the workspace's Tasks copy (open and archived tasks) with the handle rule
  // Tasks' own search and links use, and shown as the Top result at once,
  // before the server answers and when it can't (offline).
  const tasksReachable = modulePermissions.tasks !== "none";
  const lead = useMemo<SearchAllRow | null>(() => {
    if (!open || !trimmed || !taskKey || !tasksReachable || !runtime || !selectedWorkspaceId) {
      return null;
    }
    if (chip !== "all") return null;
    const bundle = findWorkspaceStore(runtime, selectedWorkspaceId)?.getSnapshot().bundle;
    if (!bundle) return null;
    const archived = bundle.archivedTasks ?? [];
    const tasks = [...bundle.tasks, ...archived];
    const id = taskIdForHandle(trimmed, tasks, taskKey);
    const task = id ? tasks.find((t) => t.id === id) : null;
    if (!task) return null;
    return {
      entity_type: "task",
      entity_id: task.id,
      title: task.title,
      context: null,
      snippet: null,
      icon: null,
      match: "handle",
      rank: 1,
      updated_at: (task as { updatedAt?: string }).updatedAt ?? "",
      archived: archived.some((t) => t.id === task.id),
      score: 1,
      type_total: 1,
      top: true,
    };
  }, [open, trimmed, chip, taskKey, tasksReachable, runtime, selectedWorkspaceId]);

  // Email (GS-9): on desktop this device's own mail joins the Email group,
  // merged here in the client; no mail body reaches the server. On web only
  // the pulled-in threads search_all returned.
  const mail = usePaletteMail({
    runtime,
    workspaceId: selectedWorkspaceId,
    open,
    query: trimmed,
    wanted: searchable && (chip === "all" || chip === "email"),
  });
  const merged = useMemo(() => mergeMailRows(rows, mail.rows), [rows, mail.rows]);
  const view = useMemo(() => buildPaletteView(merged, { chip, lead }), [merged, chip, lead]);
  // Every task row says its ID, quieter, as the details header does
  // (MOD-144), read from the same copy (a task it doesn't hold shows none).
  const shownTaskIds = useMemo(() => {
    const ids = new Set<string>();
    if (view.top?.entity_type === "task") ids.add(view.top.entity_id);
    for (const g of view.groups)
      for (const r of g.rows) if (r.entity_type === "task") ids.add(r.entity_id);
    for (const r of recents) if (r.entity_type === "task") ids.add(r.entity_id);
    return ids;
  }, [view, recents]);
  const taskIds = useMemo(() => {
    if (!taskKey || !runtime || !selectedWorkspaceId || shownTaskIds.size === 0) return null;
    const bundle = findWorkspaceStore(runtime, selectedWorkspaceId)?.getSnapshot().bundle;
    if (!bundle) return null;
    const out = new Map<string, string>();
    for (const task of [...bundle.tasks, ...(bundle.archivedTasks ?? [])]) {
      if (!shownTaskIds.has(task.id)) continue;
      const handle = taskHandle(taskKey, task.number);
      if (handle) out.set(task.id, handle);
    }
    return out.size > 0 ? out : null;
  }, [taskKey, runtime, selectedWorkspaceId, shownTaskIds]);
  // A task result's 📎 mark (AT-3), read from the same copy (files you can see).
  const fileCounts = useMemo(() => {
    if (!runtime || !selectedWorkspaceId || shownTaskIds.size === 0) return null;
    const counts = findWorkspaceStore(runtime, selectedWorkspaceId)?.getSnapshot().attachmentCounts;
    return counts && counts.size > 0 ? counts : null;
  }, [runtime, selectedWorkspaceId, shownTaskIds]);

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
  const seeAllInChat = useCallback(
    (q: string) => {
      setOpen(false);
      void navigate({ to: "/chat", search: { view: "search", q } as Record<string, string> });
    },
    [navigate],
  );
  // A message opens in its conversation, at that message, and beside its chain
  // when it is a reply (Q16b), read through Chat's own rules; one that can't be
  // read any more lands in Chat's search for the query.
  const openMessage = useCallback(
    async (id: string, q: string) => {
      let at: { channelId: string; id: string; parentId: string | null } | null = null;
      try {
        at = runtime ? (await runtime.chat.message(id)).data : null;
      } catch {
        at = null;
      }
      if (!at) {
        seeAllInChat(q);
        return;
      }
      window.dispatchEvent(
        new CustomEvent(ENTITY_OPEN_EVENT, {
          detail: {
            type: "chat_channel",
            id: at.channelId,
            messageId: at.id,
            ...(at.parentId ? { chainId: at.parentId } : {}),
          },
        }),
      );
    },
    [runtime, seeAllInChat],
  );
  const openRow = useCallback(
    (row: SearchHit) => {
      setOpen(false);
      if (typeof window === "undefined") return;
      if (row.entity_type === "chat_message") {
        void openMessage(row.entity_id, trimmed);
        return;
      }
      window.dispatchEvent(
        new CustomEvent(ENTITY_OPEN_EVENT, {
          detail: { type: row.entity_type, id: row.entity_id },
        }),
      );
    },
    [openMessage, trimmed],
  );

  const chips = useMemo(() => paletteChips(modulePermissions), [modulePermissions]);

  // Remove one, or clear: the list changes at once, and comes back as it was
  // when the write fails (offline), since the server kept it.
  const recent: PaletteRecent | null =
    runtime && selectedWorkspaceId
      ? {
          rows: recents,
          onRemove: (row) => {
            const before = recents;
            setRecents(
              before.filter(
                (r) => r.entity_type !== row.entity_type || r.entity_id !== row.entity_id,
              ),
            );
            runtime.spine
              .forgetRecent({
                workspaceId: selectedWorkspaceId,
                type: row.entity_type,
                id: row.entity_id,
              })
              .catch(() => setRecents(before));
          },
          onClear: () => {
            const before = recents;
            setRecents([]);
            runtime.spine
              .clearRecents({ workspaceId: selectedWorkspaceId })
              .catch(() => setRecents(before));
          },
        }
      : null;

  const settingsShortcut = SHORTCUTS.find((s) => s.id === "settings");
  const settingsLabel = settingsShortcut ? formatShortcut(settingsShortcut) : "";
  const newNoteShortcut = SHORTCUTS.find((s) => s.id === "new-note");
  const newNoteLabel = newNoteShortcut ? formatShortcut(newNoteShortcut) : "";

  // Only surface modules the user can actually reach — mirror app-chrome's
  // `modulesNavItems` permission filter exactly so the palette and the top-bar
  // nav can never disagree (notes/tasks gated on their own lane; calendar rides
  // the tasks lane per specs/calendar.md; home/email/contacts are ungated at
  // alpha, matching the nav). Without this the palette would deep-link into a
  // module the workspace has no access to.
  const canReachModule = (id: string): boolean => {
    if (id === "notes") return modulePermissions.notes !== "none";
    if (id === "tasks") return modulePermissions.tasks !== "none";
    if (id === "calendar") return modulePermissions.calendar !== "none";
    if (id === "contacts") return modulePermissions.contacts !== "none";
    if (id === "chat") return modulePermissions.chat !== "none";
    return true;
  };

  const navActions: PaletteAction[] = [
    { id: "home", label: "Open Home", icon: House, run: go("/") },
    { id: "notes", label: "Open Notes", icon: FileText, run: go("/notes") },
    { id: "tasks", label: "Open Tasks", icon: CheckSquare, run: go("/tasks") },
    { id: "calendar", label: "Open Calendar", icon: CalendarIcon, run: go("/calendar") },
    // Mindmap is hidden from the alpha (DF-4) — omitted from the palette too so
    // nav/palette stay in sync. The /mindmap route stays reachable directly.
    { id: "email", label: "Open Email", icon: Inbox, run: go("/email") },
    { id: "contacts", label: "Open Contacts", icon: ContactIcon, run: go("/contacts") },
    { id: "chat", label: "Open Chat", icon: MessagesSquare, run: go("/chat") },
  ].filter((action) => canReachModule(action.id));

  // Notes capture works from any page (Wave-3 AC1): same `action` pattern.
  const notesActions: PaletteAction[] = [
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
  const contactsActions: PaletteAction[] = [
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
        void navigate({
          to: "/contacts",
          search: (prev) => ({ ...prev, action: "import" as const }),
        });
      },
    },
  ];

  const settingsActions: PaletteAction[] = [
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
  // results are server-filtered and would otherwise be dropped). Empty query
  // shows every action.
  const q = trimmed.toLowerCase();
  const filterActions = (actions: PaletteAction[]) =>
    q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions;
  const actionGroups = [
    { heading: "Navigate", actions: filterActions(navActions) },
    { heading: "Notes", actions: filterActions(notesActions) },
    { heading: "Contacts", actions: filterActions(contactsActions) },
    { heading: "Workspace", actions: filterActions(settingsActions) },
  ];
  const actionCount = actionGroups.reduce((n, g) => n + g.actions.length, 0);

  // Chat's own search (filters, paging) for the same words.
  const onSeeAllInChat = chatOn ? () => seeAllInChat(trimmed) : null;

  const noResults =
    searchable &&
    !pending &&
    notice === null &&
    view.top === null &&
    view.groups.length === 0 &&
    actionCount === 0 &&
    !mail.searching;

  return (
    <GlobalSearchPalette
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      chips={chips}
      chip={chip}
      onChipChange={setChip}
      view={view}
      searching={searchable}
      slow={slow}
      notice={notice}
      noResults={noResults}
      actionGroups={actionGroups}
      recent={recent}
      onSeeAllInChat={onSeeAllInChat}
      onOpenRow={openRow}
      onShowAll={(group) => setChip(chipForGroup(group))}
      onSearchEverything={() => setChip("all")}
      taskIds={taskIds}
      fileCounts={fileCounts}
    />
  );
}
