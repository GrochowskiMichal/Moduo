import { useNavigate } from "@tanstack/react-router";
import {
  Calendar as CalendarIcon,
  CheckSquare,
  Contact as ContactIcon,
  FilePlus2,
  FileText,
  House,
  Inbox,
  MessageCircle,
  MessagesSquare,
  Paperclip,
  Search,
  Settings as SettingsIcon,
  Upload,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { filesLabel } from "../../features/attachments/files";
import { hasSearchableWords } from "../../features/chat/find/model";
import { Snippet } from "../../features/chat/find/snippet";
import type { ChatConversationFound, ChatSearchHit } from "../../features/chat/model";
import { dispatchOpenSettings } from "../../features/settings/settings-events";
import { resolveEntityIcon } from "../../features/spine/icon-map";
import { taskIdForHandle } from "../../features/tasks/search";
import type { EntityRecord } from "../../lib/entity-links";
import { ENTITY_OPEN_EVENT } from "../../lib/entity-open";
import { groupPaletteResults, PALETTE_ENTITY_TYPES, withHandleHit } from "../../lib/palette-search";
import { formatShortcut, onShortcut, SHORTCUTS } from "../../lib/shortcuts";
import { findWorkspaceStore } from "../../lib/sync/store";
import { taskHandle } from "../../lib/task-handle";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../ui/command";
import { Eyebrow } from "../ui/eyebrow";
import { MetaCount } from "../ui/meta-count";
import { announceOverlayOpen, onOtherOverlayOpen } from "./global-overlay-events";

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

const NOTHING_FAILED = { messages: false, conversations: false };

/** ⌘K's name for a found conversation: a channel's own, a direct message's people
 *  (everyone it was opened with besides you), a note-to-self your name or "You". */
export function foundConversationName(
  c: ChatConversationFound,
  selfId: string | null,
  nameOf: (id: string) => string | undefined,
): string {
  if (c.kind === "channel") return c.name ?? "Channel";
  if (c.people.length === 0) return (selfId ? nameOf(selfId) : undefined) ?? "You";
  return c.people.map((id) => nameOf(id) ?? "Former member").join(", ");
}

export function dispatchOpenPalette() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
}

export function GlobalCommandPalette() {
  const navigate = useNavigate();
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId, selectedWorkspace, modulePermissions, members } = useWorkspace();
  const taskKey = selectedWorkspace?.taskKey ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityRecord[]>([]);
  const [searching, setSearching] = useState(false);
  const reqRef = useRef(0);
  // Chat (CV-19): Messages from the server search, Conversations by name
  // (Polish without diacritics), the top five each, then "See all in Chat".
  const [chatHits, setChatHits] = useState<ChatSearchHit[]>([]);
  const [chatConversations, setChatConversations] = useState<ChatConversationFound[]>([]);
  // Which half failed: a failed read says "Search isn't available", never "No results.".
  const [chatFailed, setChatFailed] = useState(NOTHING_FAILED);
  // While chat's answers are on their way, "No results." waits.
  const [chatSearching, setChatSearching] = useState(false);
  const chatReqRef = useRef(0);
  const chatOn = modulePermissions.chat !== "none";
  const trimmed = query.trim();

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

  // Reset the query + results each time the palette closes so it reopens fresh.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSearching(false);
      setChatHits([]);
      setChatConversations([]);
      setChatFailed(NOTHING_FAILED);
      setChatSearching(false);
    }
  }, [open]);

  // Chat's half of the search: its own request counter, so a slow chat answer
  // never overwrites a newer query's and the other modules never wait for it.
  // A failed message search says so ("Search isn't available"), never "no results".
  useEffect(() => {
    if (!open) return;
    const reqId = ++chatReqRef.current;
    if (!trimmed || !runtime || !selectedWorkspaceId || !chatOn) {
      setChatHits([]);
      setChatConversations([]);
      setChatFailed(NOTHING_FAILED);
      setChatSearching(false);
      return;
    }
    setChatSearching(true);
    const timer = setTimeout(() => {
      // Negated words only ("-standup") name nothing to find: no Messages.
      const messages = hasSearchableWords(trimmed)
        ? runtime.chat.search({ workspaceId: selectedWorkspaceId, query: trimmed, limit: 5 })
        : Promise.resolve({ data: [] as ChatSearchHit[], error: null });
      const conversations = runtime.chat.findConversations({
        workspaceId: selectedWorkspaceId,
        query: trimmed,
        limit: 5,
      });
      void Promise.all([messages, conversations]).then(([hits, convs]) => {
        if (reqId !== chatReqRef.current) return;
        setChatFailed({ messages: hits.error !== null, conversations: convs.error !== null });
        setChatHits(hits.error ? [] : hits.data);
        setChatConversations(convs.error ? [] : convs.data.slice(0, 5));
        setChatSearching(false);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [open, trimmed, runtime, selectedWorkspaceId, chatOn]);

  const memberNames = useMemo(
    () => new Map(members.map((m) => [m.userId, m.displayName?.trim() || "Member"])),
    [members],
  );
  const memberName = useCallback(
    (hit: ChatSearchHit) =>
      hit.authorLabel ?? (hit.authorId ? memberNames.get(hit.authorId) : null) ?? "Former member",
    [memberNames],
  );
  // A direct message reads as its people, a note-to-self as you (as the sidebar).
  const conversationName = useCallback(
    (c: ChatConversationFound) => foundConversationName(c, userId, (id) => memberNames.get(id)),
    [memberNames, userId],
  );

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

  // A task's ID finds it (MOD-144): "MOD-99", "mod-99" or "mod 99", read in
  // the workspace's Tasks copy (open and archived tasks) with the handle rule
  // Tasks' own search and links use, and listed first, at once, before the
  // registry answers. The registry finds "MOD-99" by its handle too, but
  // never "mod 99".
  const tasksReachable = modulePermissions.tasks !== "none";
  const handleHit = useMemo<EntityRecord | null>(() => {
    if (!open || !trimmed || !taskKey || !tasksReachable || !runtime || !selectedWorkspaceId) {
      return null;
    }
    const bundle = findWorkspaceStore(runtime, selectedWorkspaceId)?.getSnapshot().bundle;
    if (!bundle) return null;
    const tasks = [...bundle.tasks, ...(bundle.archivedTasks ?? [])];
    const id = taskIdForHandle(trimmed, tasks, taskKey);
    const task = id ? tasks.find((t) => t.id === id) : null;
    if (!task) return null;
    return {
      workspaceId: selectedWorkspaceId,
      type: "task",
      id: task.id,
      label: task.title,
      icon: null,
      deletedAt: null,
    };
  }, [open, trimmed, taskKey, tasksReachable, runtime, selectedWorkspaceId]);
  const shown = useMemo(() => withHandleHit(results, handleHit), [results, handleHit]);
  const resultGroups = useMemo(() => groupPaletteResults(shown), [shown]);
  // Every task result says its ID, quieter, as the details header does
  // (MOD-144), read from the same copy (a task it doesn't hold shows none).
  const handles = useMemo(() => {
    if (!taskKey || !runtime || !selectedWorkspaceId || shown.length === 0) return null;
    const bundle = findWorkspaceStore(runtime, selectedWorkspaceId)?.getSnapshot().bundle;
    if (!bundle) return null;
    const wanted = new Set(shown.filter((r) => r.type === "task").map((r) => r.id));
    const out = new Map<string, string>();
    for (const task of [...bundle.tasks, ...(bundle.archivedTasks ?? [])]) {
      if (!wanted.has(task.id)) continue;
      const handle = taskHandle(taskKey, task.number);
      if (handle) out.set(task.id, handle);
    }
    return out.size > 0 ? out : null;
  }, [taskKey, runtime, selectedWorkspaceId, shown]);
  // Archived projects stay findable, labelled (REPLAN 78, TV-U16): the
  // workspace's Tasks copy knows which projects and tasks are archived.
  const archivedIds = useMemo(() => {
    if (!runtime || !selectedWorkspaceId || shown.length === 0) return null;
    const bundle = findWorkspaceStore(runtime, selectedWorkspaceId)?.getSnapshot().bundle;
    if (!bundle?.archivedBuckets?.length) return null;
    return new Set([
      ...bundle.archivedBuckets.map((b) => b.id),
      ...(bundle.archivedTasks ?? []).map((t) => t.id),
    ]);
  }, [runtime, selectedWorkspaceId, shown]);
  // A task result's 📎 mark (AT-3), read from the same copy (files you can see).
  const fileCounts = useMemo(() => {
    if (!runtime || !selectedWorkspaceId || shown.length === 0) return null;
    const counts = findWorkspaceStore(runtime, selectedWorkspaceId)?.getSnapshot().attachmentCounts;
    return counts && counts.size > 0 ? counts : null;
  }, [runtime, selectedWorkspaceId, shown]);

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

  // A message lands in its conversation, on it (and its chain when it is a reply).
  const openChatHit = useCallback(
    (hit: ChatSearchHit) => {
      setOpen(false);
      void navigate({
        to: "/chat",
        search: {
          c: hit.channelId,
          m: hit.messageId,
          ...(hit.parentId ? { t: hit.parentId } : {}),
        } as Record<string, string>,
      });
    },
    [navigate],
  );
  const openConversation = useCallback(
    (c: ChatConversationFound) => {
      setOpen(false);
      void navigate({ to: "/chat", search: { c: c.channelId } as Record<string, string> });
    },
    [navigate],
  );
  const seeAllInChat = useCallback(() => {
    setOpen(false);
    void navigate({
      to: "/chat",
      search: { view: "search", q: trimmed } as Record<string, string>,
    });
  }, [navigate, trimmed]);

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

  const navActions: Action[] = [
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
        void navigate({
          to: "/contacts",
          search: (prev) => ({ ...prev, action: "import" as const }),
        });
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

  const showChat = chatOn && trimmed.length > 0;
  const anyChatFailed = chatFailed.messages || chatFailed.conversations;
  const chatFound = chatHits.length + chatConversations.length;
  const showNoResults =
    trimmed.length > 0 &&
    !searching &&
    resultGroups.length === 0 &&
    actionCount === 0 &&
    chatFound === 0 &&
    !chatSearching &&
    !anyChatFailed;

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
        placeholder="Search messages, tasks, notes, contacts… or jump to a page"
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

        {showChat && (chatHits.length > 0 || chatFailed.messages) ? (
          <CommandGroup heading="Messages">
            {chatFailed.messages ? (
              <div className="px-2 py-1.5 text-sm text-muted-foreground" role="alert">
                Search isn't available
              </div>
            ) : (
              chatHits.map((hit) => (
                <CommandItem
                  key={`chat_message:${hit.messageId}`}
                  value={`chat_message:${hit.messageId}`}
                  onSelect={() => openChatHit(hit)}
                >
                  <MessageCircle />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Snippet text={hit.snippet} className="block truncate" />
                    <span className="truncate text-xs text-muted-foreground">
                      {memberName(hit)} · {hit.channelName ?? "Direct message"}
                    </span>
                  </span>
                </CommandItem>
              ))
            )}
          </CommandGroup>
        ) : null}
        {showChat && chatFailed.conversations && !chatFailed.messages ? (
          <CommandGroup heading="Conversations">
            <div className="px-2 py-1.5 text-sm text-muted-foreground" role="alert">
              Search isn't available
            </div>
          </CommandGroup>
        ) : null}
        {showChat && chatConversations.length > 0 ? (
          <CommandGroup heading="Conversations">
            {chatConversations.map((c) => {
              const Icon = resolveEntityIcon("chat_channel");
              return (
                <CommandItem
                  key={`chat_channel:${c.channelId}`}
                  value={`entity:chat_channel:${c.channelId}`}
                  data-chat-conversation={c.channelId}
                  onSelect={() => openConversation(c)}
                >
                  <Icon />
                  <span className="min-w-0 flex-1 truncate">{conversationName(c)}</span>
                  {c.archived ? (
                    <span className="shrink-0 text-xs text-muted-foreground">Archived</span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandGroup>
        ) : null}
        {showChat ? (
          <CommandGroup>
            <CommandItem value="action:see-all-in-chat" onSelect={seeAllInChat}>
              <Search />
              <span>See all in Chat</span>
            </CommandItem>
          </CommandGroup>
        ) : null}

        {/* Keep prior results on screen while a newer query debounces (like the
            @mention picker) — only blank to "Searching…" when there's nothing
            yet to show, so fast typing doesn't flicker the primary ⌘K surface. */}
        {resultGroups.length > 0 ? (
          resultGroups.map((group) => (
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
                    <span className="min-w-0 flex-1 truncate">{record.label || "Untitled"}</span>
                    {record.type === "task" && handles?.has(record.id) ? (
                      // The task's ID, as quiet as the details header's (MOD-144).
                      <span
                        data-slot="palette-task-id"
                        className="shrink-0 font-sans text-xs whitespace-nowrap text-subtle-foreground tabular-nums"
                      >
                        {handles.get(record.id)}
                      </span>
                    ) : null}
                    {record.type === "task" ? (
                      <MetaCount
                        icon={Paperclip}
                        count={fileCounts?.get(record.id) ?? 0}
                        label={filesLabel}
                      />
                    ) : null}
                    <Eyebrow className="shrink-0" tone="tag">
                      {TYPE_LABEL[record.type] ?? record.type}
                    </Eyebrow>
                    {archivedIds?.has(record.id) ? (
                      <Eyebrow className="shrink-0" tone="tag">
                        Archived
                      </Eyebrow>
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))
        ) : trimmed && searching ? (
          <div className="py-6 text-center text-sm text-muted-foreground" role="status">
            Searching…
          </div>
        ) : null}

        {showNoResults ? <CommandEmpty>No results.</CommandEmpty> : null}
      </CommandList>
    </CommandDialog>
  );
}
