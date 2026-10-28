// GS-3 — ⌘K's look (specs/global-search.md §Product behavior 3–7, §Edge cases):
// the input, the type chips under it (Tab and Shift+Tab move between them, focus
// stays in the input), one Top result, the groups in their fixed order with
// "Show all N", then the matching actions. Pure presentation: the container
// (`global-command-palette.tsx`) owns the search and passes the answer in, so
// the stories can draw every state.

import type { SearchAllRow } from "@contracts/search";
import { MessageCircle, Paperclip, Search } from "lucide-react";
import { type ComponentType, type KeyboardEvent, useState } from "react";

import { filesLabel } from "../../features/attachments/files";
import { Snippet } from "../../features/chat/find/snippet";
import { resolveEntityIcon } from "../../features/spine/icon-map";
import {
  type PaletteChip,
  type PaletteChipKey,
  type PaletteGroupKey,
  type PaletteView,
  showAllLabel,
  stepChip,
  titleSegments,
} from "../../lib/palette-search";
import { type SnippetSegment, snippetSegments } from "../../lib/search-snippet";
import { formatAge } from "../../lib/time-format";
import { ChipButton } from "../ui/chip";
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../ui/command";
import { Eyebrow } from "../ui/eyebrow";
import { MetaCount } from "../ui/meta-count";

export type PaletteAction = {
  id: string;
  label: string;
  icon: ComponentType;
  shortcut?: string;
  run: () => void;
};

export type PaletteActionGroup = { heading: string; actions: PaletteAction[] };

/** Chat's half until GS-6: its own two calls, drawn in their places. */
export type PaletteChat = {
  messages: Array<{ id: string; snippet: string; meta: string; onSelect: () => void }>;
  conversations: Array<{ id: string; name: string; archived: boolean; onSelect: () => void }>;
  messagesFailed: boolean;
  conversationsFailed: boolean;
  onSeeAll: () => void;
};

/** Why the server's answer is missing: offline (or any error), or it gave up. */
export type PaletteNotice = "offline" | "timeout" | null;

const NOTICE_TEXT: Record<Exclude<PaletteNotice, null>, string> = {
  offline: "Search needs a connection; showing what's on this device",
  timeout: "Search took too long, try fewer words",
};

// The kind of the Top result (it stands outside its group).
const TYPE_LABEL: Record<string, string> = {
  task: "Task",
  project: "Project",
  bucket: "Project",
  note: "Note",
  contact: "Contact",
  company: "Company",
  email: "Email",
  email_thread: "Email",
  event: "Event",
};

export type GlobalSearchPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  chips: PaletteChip[];
  chip: PaletteChipKey;
  onChipChange: (chip: PaletteChipKey) => void;
  /** The laid-out answer (`buildPaletteView`). */
  view: PaletteView;
  /** The query is searched (two characters, a word that isn't excluded). */
  searching: boolean;
  /** A reply is taking longer than 300 ms: draw the thin progress line. */
  slow: boolean;
  notice: PaletteNotice;
  /** The search finished and found nothing (no rows, no chat, no actions). */
  noResults: boolean;
  actionGroups: PaletteActionGroup[];
  chat?: PaletteChat | null;
  onOpenRow: (row: SearchAllRow) => void;
  onShowAll: (group: PaletteGroupKey) => void;
  onSearchEverything: () => void;
  /** A task's ID by task id, from the workspace's Tasks copy (MOD-144). */
  taskIds?: ReadonlyMap<string, string> | null;
  /** A task's file count (AT-3). */
  fileCounts?: ReadonlyMap<string, number> | null;
  /** "Now" for the ages (stories pin it). */
  now?: Date;
};

function Marked({ segments }: { segments: SnippetSegment[] }) {
  return segments.map((part, i) =>
    part.marked ? (
      <mark
        // eslint-disable-next-line react/no-array-index-key -- segments have no identity; the list is rebuilt whole
        key={i}
        className="rounded-sm bg-state-selected font-medium text-foreground"
      >
        {part.text}
      </mark>
    ) : (
      // eslint-disable-next-line react/no-array-index-key -- as above
      <span key={i}>{part.text}</span>
    ),
  );
}

function ResultRow({
  row,
  query,
  isTop,
  taskId,
  fileCount,
  now,
  onOpen,
}: {
  row: SearchAllRow;
  query: string;
  isTop: boolean;
  taskId: string | undefined;
  fileCount: number;
  now: Date | undefined;
  onOpen: (row: SearchAllRow) => void;
}) {
  const Icon = resolveEntityIcon(row.entity_type, row.icon);
  const title = row.title.trim() || "Untitled";
  // The title is marked where it matched; a body hit's match is in its snippet.
  const titleParts =
    row.match === "title" || row.match === "handle"
      ? titleSegments(title, query)
      : [{ text: title, marked: false }];
  const age = row.updated_at ? formatAge(row.updated_at, now) : "";
  return (
    <CommandItem
      value={`entity:${row.entity_type}:${row.entity_id}`}
      onSelect={() => onOpen(row)}
      className="items-start"
    >
      <Icon />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">
            {titleParts.some((p) => p.marked) ? (
              <>
                {/* Read whole; the marked copy is for the eye (marks would
                    break the title into pieces for a screen reader). */}
                <span className="sr-only">{title}</span>
                <span aria-hidden>
                  <Marked segments={titleParts} />
                </span>
              </>
            ) : (
              title
            )}
          </span>
          {taskId ? (
            // The task's ID, as quiet as the details header's (MOD-144).
            <span
              data-slot="palette-task-id"
              className="shrink-0 font-sans text-xs whitespace-nowrap text-subtle-foreground tabular-nums"
            >
              {taskId}
            </span>
          ) : null}
          {row.archived ? (
            <Eyebrow className="shrink-0" tone="tag">
              Archived
            </Eyebrow>
          ) : null}
        </span>
        {row.context ? (
          <span className="truncate text-xs text-muted-foreground">{row.context}</span>
        ) : null}
        {row.snippet ? (
          <span data-slot="search-snippet" className="truncate text-xs text-subtle-foreground">
            <Marked segments={snippetSegments(row.snippet)} />
          </span>
        ) : null}
      </span>
      {row.entity_type === "task" ? (
        <MetaCount icon={Paperclip} count={fileCount} label={filesLabel} />
      ) : null}
      {isTop ? (
        <Eyebrow className="shrink-0" tone="tag">
          {TYPE_LABEL[row.entity_type] ?? row.entity_type}
        </Eyebrow>
      ) : null}
      {age ? (
        <span className="shrink-0 text-xs whitespace-nowrap text-subtle-foreground tabular-nums">
          {age}
        </span>
      ) : null}
    </CommandItem>
  );
}

function TypeChips({
  chips,
  chip,
  onChipChange,
}: Pick<GlobalSearchPaletteProps, "chips" | "chip" | "onChipChange">) {
  if (chips.length < 2) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Filter by type"
      className="flex flex-wrap gap-1 border-b border-border px-3 py-2"
    >
      {chips.map((c) => (
        <ChipButton
          key={c.key}
          role="radio"
          aria-checked={c.key === chip}
          active={c.key === chip}
          size="xs"
          shape="full"
          // Tab moves the chips from the input; the chips themselves are not
          // tab stops, and a click keeps focus in the input.
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChipChange(c.key)}
        >
          {c.label}
        </ChipButton>
      ))}
    </div>
  );
}

function Unavailable() {
  return (
    <div className="px-2 py-1.5 text-sm text-muted-foreground" role="alert">
      Search isn't available
    </div>
  );
}

/** Chat's Messages and Conversations (its own calls until GS-6), then "See all in Chat". */
function ChatGroups({ chat }: { chat: PaletteChat }) {
  const ConversationIcon = resolveEntityIcon("chat_channel");
  return (
    <>
      {chat.messages.length > 0 || chat.messagesFailed ? (
        <CommandGroup heading="Messages">
          {chat.messagesFailed ? (
            <Unavailable />
          ) : (
            chat.messages.map((m) => (
              <CommandItem
                key={`chat_message:${m.id}`}
                value={`chat_message:${m.id}`}
                onSelect={m.onSelect}
              >
                <MessageCircle />
                <span className="flex min-w-0 flex-1 flex-col">
                  <Snippet text={m.snippet} className="block truncate" />
                  <span className="truncate text-xs text-muted-foreground">{m.meta}</span>
                </span>
              </CommandItem>
            ))
          )}
        </CommandGroup>
      ) : null}
      {chat.conversationsFailed && !chat.messagesFailed ? (
        <CommandGroup heading="Conversations">
          <Unavailable />
        </CommandGroup>
      ) : null}
      {chat.conversations.length > 0 ? (
        <CommandGroup heading="Conversations">
          {chat.conversations.map((c) => (
            <CommandItem
              key={`chat_channel:${c.id}`}
              value={`entity:chat_channel:${c.id}`}
              data-chat-conversation={c.id}
              onSelect={c.onSelect}
            >
              <ConversationIcon />
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              {c.archived ? (
                <span className="shrink-0 text-xs text-muted-foreground">Archived</span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      <CommandGroup>
        <CommandItem value="action:see-all-in-chat" onSelect={chat.onSeeAll}>
          <Search />
          <span>See all in Chat</span>
        </CommandItem>
      </CommandGroup>
    </>
  );
}

function NoResults({
  query,
  narrowed,
  onSearchEverything,
}: {
  query: string;
  narrowed: boolean;
  onSearchEverything: () => void;
}) {
  return (
    <>
      {/* Not cmdk's Empty: it hides itself while any item (an action,
          "Search everything") is listed. */}
      <div role="status" className="py-6 text-center text-sm text-muted-foreground">
        No matches for '{query}'
      </div>
      {narrowed ? (
        <CommandGroup>
          <CommandItem value="action:search-everything" onSelect={onSearchEverything}>
            <Search />
            <span>Search everything</span>
          </CommandItem>
        </CommandGroup>
      ) : null}
    </>
  );
}

/** Actions whose label matches, below the results (Q4). */
function ActionGroups({ groups }: { groups: PaletteActionGroup[] }) {
  return groups.map((group) =>
    group.actions.length > 0 ? (
      <CommandGroup key={group.heading} heading={group.heading}>
        {group.actions.map(({ id, label, icon: Icon, shortcut, run }) => (
          <CommandItem key={id} value={`action:${id}`} onSelect={run}>
            <Icon />
            <span>{label}</span>
            {shortcut ? <CommandShortcut>{shortcut}</CommandShortcut> : null}
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null,
  );
}

/** A thin line, only once a reply takes longer than 300 ms (Q22). */
function ProgressLine({ slow }: { slow: boolean }) {
  return (
    <div className="h-px">
      {slow ? (
        <div
          data-slot="palette-progress"
          role="progressbar"
          aria-label="Searching"
          className="track-pulse h-px w-full bg-muted-foreground"
        />
      ) : null}
    </div>
  );
}

export function GlobalSearchPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  chips,
  chip,
  onChipChange,
  view,
  searching,
  slow,
  notice,
  noResults,
  actionGroups,
  chat,
  onOpenRow,
  onShowAll,
  onSearchEverything,
  taskIds,
  fileCounts,
  now,
}: GlobalSearchPaletteProps) {
  const trimmed = query.trim();
  const results = searching ? view : { top: null, groups: [] };

  // cmdk keeps its highlight on whatever was first when the list last changed
  // ("See all in Chat", an action) while the server's answer is on its way:
  // when a new answer arrives, Enter opens its first row (the Top result, or
  // with a chip the first of its groups).
  const first = results.top ?? results.groups[0]?.rows[0] ?? null;
  const topValue = first ? `entity:${first.entity_type}:${first.entity_id}` : null;
  const [selected, setSelected] = useState("");
  const [seenTop, setSeenTop] = useState<string | null>(null);
  if (topValue !== seenTop) {
    setSeenTop(topValue);
    if (topValue) setSelected(topValue);
  }

  // Tab and Shift+Tab move between the chips; focus never leaves the input.
  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Tab" || e.altKey || e.metaKey || e.ctrlKey || chips.length < 2) return;
    e.preventDefault();
    onChipChange(stepChip(chips, chip, e.shiftKey ? -1 : 1));
  };

  const row = (r: SearchAllRow, isTop = false) => (
    <ResultRow
      key={`${r.entity_type}:${r.entity_id}`}
      row={r}
      query={trimmed}
      isTop={isTop}
      taskId={r.entity_type === "task" ? taskIds?.get(r.entity_id) : undefined}
      fileCount={fileCounts?.get(r.entity_id) ?? 0}
      now={now}
      onOpen={onOpenRow}
    />
  );
  const groups = (list: PaletteView["groups"]) =>
    list.map((group) => (
      <CommandGroup key={group.key} heading={group.heading}>
        {group.rows.map((r) => row(r))}
        {group.more ? (
          <CommandItem
            value={`show-all:${group.key}`}
            onSelect={() => onShowAll(group.key)}
            className="text-muted-foreground"
          >
            <Search />
            <span>{showAllLabel(group.total)}</span>
          </CommandItem>
        ) : null}
      </CommandGroup>
    ));

  // Messages and Conversations sit between Events and Email in the fixed order.
  const before = results.groups.filter((g) => g.key !== "email");
  const email = results.groups.filter((g) => g.key === "email");
  const showChat = chat && searching && (chip === "all" || chip === "chat");

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      className="max-w-xl"
      commandProps={{ shouldFilter: false, value: selected, onValueChange: setSelected }}
    >
      <CommandInput
        value={query}
        onValueChange={onQueryChange}
        onKeyDown={onInputKeyDown}
        placeholder="Search messages, tasks, notes, contacts… or jump to a page"
      />
      <TypeChips chips={chips} chip={chip} onChipChange={onChipChange} />
      <ProgressLine slow={slow} />
      <CommandList>
        {searching && notice ? (
          <div
            role="status"
            data-slot="palette-notice"
            className="px-3 py-2 text-xs text-muted-foreground"
          >
            {NOTICE_TEXT[notice]}
          </div>
        ) : null}
        {results.top ? (
          <CommandGroup heading="Top result">{row(results.top, true)}</CommandGroup>
        ) : null}
        {groups(before)}
        {showChat ? <ChatGroups chat={chat} /> : null}
        {groups(email)}
        {noResults ? (
          <NoResults
            query={trimmed}
            narrowed={chip !== "all"}
            onSearchEverything={onSearchEverything}
          />
        ) : null}
        <ActionGroups groups={actionGroups} />
      </CommandList>
    </CommandDialog>
  );
}
