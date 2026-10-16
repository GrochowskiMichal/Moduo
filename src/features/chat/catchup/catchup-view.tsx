// Catch up (specs/chat-v2.md §9, §16; round 5 frame 1): a mode of the Chat
// page. The centre lists what's addressed to you, grouped by conversation
// (newest first is a Display option); the bottom bar's centre becomes the
// mode row (Reply R · Done Space · Task T · Later H · Open ⏎ · Go to
// conversation, More ▾ with "Done all in this conversation", then "N left ·
// Esc"); the selected item shows on the right as the message in context with
// a reply box. Keys on a chain or an Every-message line act on its newest
// message (the item names it). ↑↓ move, Esc leaves.

import { Inbox, Loader2, MessageCircle, MoreHorizontal } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { type BottomBarMode, useBottomBarModeOwner } from "@/components/app/bottom-bar-mode";
import { PersonAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DisplayMenu } from "@/components/ui/display-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "@/features/layout/panel-events";
import { NOTICES_OFF_LINE, useBrowserNoticesOff } from "@/lib/notices/chat-ask";
import { formatPastDay, formatTime } from "@/lib/time-format";
import { useTimeRegion } from "@/lib/time-region";
import { undoToast } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";
import { messageTree, toExcerptText } from "../markup-v2";
import type {
  ChatCatchupItem,
  ChatChannel,
  ChatMember,
  ChatMessage,
  ChatPerson,
  ChatRuntime,
  ChatUnread,
} from "../model";
import { MessageInContext } from "../panel/message-in-context";
import { conversationTitle, dmPeople } from "../shell/sidebar-model";
import type { ChatStore } from "../store/store";
import { authorName } from "../stream/rows";
import { useCatchup } from "./catchup-store";
import { LaterDialog } from "./later-dialog";
import { laterHint } from "./later-times";
import {
  buildCatchup,
  type CatchupGroup,
  type CatchupOrder,
  type CatchupRow,
  flatRows,
  nextSelection,
  quietChannelsLine,
} from "./model";

const ORDER_KEY = "moduo:chat:catchup-order";

function readOrder(): CatchupOrder {
  try {
    return globalThis.localStorage?.getItem(ORDER_KEY) === "newest" ? "newest" : "grouped";
  } catch {
    return "grouped";
  }
}

function writeOrder(order: CatchupOrder): void {
  try {
    globalThis.localStorage?.setItem(ORDER_KEY, order);
  } catch {
    // Private mode: the choice lasts this visit.
  }
}

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  return !!el.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");
}

/** A dialog or menu over the page: Catch up's keys wait. */
function overlayOpen(): boolean {
  return (
    typeof document !== "undefined" &&
    !!document.querySelector("[role='dialog'], [role='alertdialog'], [role='menu']")
  );
}

function failed(res: { ok: boolean; message?: string; offline?: boolean }, fallback: string) {
  if (res.ok) return false;
  toast(res.offline ? "Offline" : res.message || fallback);
  return true;
}

/** Enter and Space on another control (a button, a link) are that control's. */
function ownControl(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  const control = el.closest("button, a, [role='button'], [role='menuitem']");
  return !!control && !control.hasAttribute("data-catchup-item");
}

export type CatchupScreenInput = {
  /** Catch up is the page's mode now. */
  active: boolean;
  store: ChatStore | null;
  chat: ChatRuntime | null;
  channels: Readonly<Record<string, ChatChannel>>;
  mine: Readonly<Record<string, ChatMember>>;
  unread: Readonly<Record<string, ChatUnread>>;
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
  onPersonClick?: (id: string) => void;
  /** Open the conversation (landing on the message, when there is one). */
  onOpenConversation: (channelId: string, messageId: string | null) => void;
  /** Esc: leave Catch up. */
  onLeave: () => void;
  /** T: the capture as Task with the message's words (the stream's own). */
  onMakeTask: (m: ChatMessage) => void;
  /** The right side's reply box for this message (absent when you can't write there). */
  renderReply?: (message: ChatMessage) => ReactNode;
  /** R: put the caret in that box. */
  onFocusReply?: () => void;
};

export type CatchupScreen = {
  center: ReactNode;
  right: ReactNode;
  dialogs: ReactNode;
};

export function useCatchupScreen(input: CatchupScreenInput): CatchupScreen {
  const {
    active,
    store,
    chat,
    channels,
    mine,
    unread,
    selfId,
    personOf,
    onPersonClick,
    onOpenConversation,
    onLeave,
    onMakeTask,
    renderReply,
    onFocusReply,
  } = input;
  const { catchup, snapshot } = useCatchup(active ? store : null);
  // The screen's callbacks are new on every render: read them through a ref so
  // the keys and the bottom bar's mode stay put (its owner wants a stable object).
  const actions = useRef({ onOpenConversation, onLeave, onMakeTask, onFocusReply });
  actions.current = { onOpenConversation, onLeave, onMakeTask, onFocusReply };
  const [order, setOrder] = useState<CatchupOrder>(readOrder);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [later, setLater] = useState<CatchupRow | null>(null);
  const noticesOff = useBrowserNoticesOff();
  const region = useTimeRegion();

  const authorOf = useCallback(
    (item: ChatCatchupItem) => {
      const m = item.messageId ? snapshot.messages[item.messageId] : undefined;
      if (!m) return null;
      return authorName(m, m.authorId ? personOf(m.authorId) : undefined);
    },
    [snapshot.messages, personOf],
  );
  const groups = useMemo(
    () =>
      buildCatchup({
        items: snapshot.items,
        channels,
        unread,
        selfId,
        personOf,
        authorOf,
        order,
      }),
    [snapshot.items, channels, unread, selfId, personOf, authorOf, order],
  );
  const rows = useMemo(() => flatRows(groups), [groups]);
  const selected = rows.find((r) => r.item.id === selectedId) ?? rows[0] ?? null;
  const selectedMessage = selected?.item.messageId
    ? snapshot.messages[selected.item.messageId]
    : undefined;

  // Keep a selection while there are rows.
  useEffect(() => {
    if (!active) return;
    if (selected && selected.item.id !== selectedId) setSelectedId(selected.item.id);
  }, [active, selected, selectedId]);

  const latest = useRef({ rows, selected, channels });
  latest.current = { rows, selected, channels };

  const select = useCallback((id: string | null) => {
    setSelectedId(id);
    if (!id) return;
    // Bring the row into view (only the list scrolls).
    queueMicrotask(() =>
      document
        .querySelector(`[data-catchup-item="${CSS.escape(id)}"]`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  }, []);

  const showRight = useCallback(() => {
    const state = readFeaturePanelState("chat");
    if (!state.right) dispatchLayoutPanelsSet({ feature: "chat", left: state.left, right: true });
  }, []);

  const done = useCallback(
    (row: CatchupRow) => {
      if (!catchup) return;
      const ids = [row.item.id];
      select(nextSelection(latest.current.rows, ids, row.item.id));
      void catchup.done(ids).then((res) => {
        if (failed(res, "Couldn't clear it.")) return;
        undoToast("Done", {
          onUndo: () => void catchup.reopen(ids).then((r) => failed(r, "Couldn't bring it back.")),
        });
      });
    },
    [catchup, select],
  );

  const doneAll = useCallback(
    (channelId: string) => {
      if (!catchup) return;
      const ids = latest.current.rows
        .filter((r) => r.item.channelId === channelId)
        .map((r) => r.item.id);
      if (ids.length === 0) return;
      const current = latest.current.selected?.item.id ?? null;
      select(nextSelection(latest.current.rows, ids, current));
      void catchup.done(ids).then((res) => {
        if (failed(res, "Couldn't clear them.")) return;
        undoToast(ids.length === 1 ? "Done" : `Done: ${ids.length} items`, {
          onUndo: () =>
            void catchup.reopen(ids).then((r) => failed(r, "Couldn't bring them back.")),
        });
      });
    },
    [catchup, select],
  );

  const remindLater = useCallback(
    (row: CatchupRow, at: string) => {
      if (!catchup) return;
      setLater(null);
      select(nextSelection(latest.current.rows, [row.item.id], row.item.id));
      // By item: a chain whose newest reply was deleted shows on an older
      // reply its item doesn't name, so a message id would write a reminder.
      void catchup.remind({ itemIds: [row.item.id] }, at, [row.item.id]).then((res) => {
        if (failed(res, "Couldn't put it off.")) return;
        toast(`Back ${laterHint(new Date(at), new Date(), region.timeZone, region.hour12)}`);
      });
    },
    [catchup, select, region.timeZone, region.hour12],
  );

  const run = useCallback(
    (action: "reply" | "done" | "task" | "later" | "open" | "go" | "done-all") => {
      const row = latest.current.selected;
      if (!row) return;
      const m = row.item.messageId ? snapshot.messages[row.item.messageId] : undefined;
      switch (action) {
        case "reply":
          if (!m) return;
          showRight();
          actions.current.onFocusReply?.();
          return;
        case "done":
          done(row);
          return;
        case "task":
          if (m) actions.current.onMakeTask(m);
          return;
        case "later":
          if (!row.quiet) setLater(row);
          return;
        case "open":
          showRight();
          return;
        case "go":
          if (!canOpen(latest.current.channels, row.item)) return;
          actions.current.onOpenConversation(row.item.channelId, row.item.messageId);
          return;
        case "done-all":
          doneAll(row.item.channelId);
          return;
      }
    },
    [snapshot.messages, showRight, done, doneAll],
  );

  // ── keys (§16): R · Space · T · H · ⏎ · ↑↓ · Esc ──────────────────────────
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditable(event.target) || overlayOpen()) return;
      const { rows, selected } = latest.current;
      const move = (by: number) => {
        if (rows.length === 0) return;
        const i = rows.findIndex((r) => r.item.id === selected?.item.id);
        const next = rows[Math.min(rows.length - 1, Math.max(0, (i < 0 ? 0 : i) + by))];
        if (next) select(next.item.id);
      };
      const key = event.key;
      const action = (():
        | "down"
        | "up"
        | "leave"
        | "done"
        | "open"
        | "reply"
        | "task"
        | "later"
        | null => {
        if (key === "ArrowDown") return "down";
        if (key === "ArrowUp") return "up";
        if (key === "Escape") return "leave";
        if (!selected || event.shiftKey) return null;
        if (key === " " || key === "Enter") {
          if (ownControl(event.target)) return null;
          return key === " " ? "done" : "open";
        }
        const k = key.toLowerCase();
        if (k === "r") return "reply";
        if (k === "t") return "task";
        if (k === "h") return "later";
        return null;
      })();
      if (!action) return;
      event.preventDefault();
      if (action === "down") move(1);
      else if (action === "up") move(-1);
      else if (action === "leave") actions.current.onLeave();
      else run(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, run, select]);

  // ── the bottom bar's mode row ─────────────────────────────────────────────
  const count = rows.length;
  const selectedOpens = !selected || canOpen(channels, selected.item);
  const mode = useMemo<BottomBarMode | null>(
    () =>
      active && count > 0
        ? {
            id: "chat:catchup",
            label: "Catch up",
            actions: [
              { id: "reply", label: "Reply", keyHint: "R", run: () => run("reply") },
              { id: "done", label: "Done", keyHint: "Space", run: () => run("done") },
              { id: "task", label: "Task", keyHint: "T", run: () => run("task") },
              { id: "later", label: "Later", keyHint: "H", run: () => run("later") },
              { id: "open", label: "Open", keyHint: "⏎", run: () => run("open") },
              ...(selectedOpens
                ? [{ id: "go", label: "Go to conversation", run: () => run("go") }]
                : []),
              {
                id: "done-all",
                label: "Done all in this conversation",
                run: () => run("done-all"),
              },
            ],
            note: `${count} left · Esc`,
          }
        : null,
    [active, count, run, selectedOpens],
  );
  useBottomBarModeOwner(mode);

  if (!active) return { center: null, right: null, dialogs: null };

  // ── centre ────────────────────────────────────────────────────────────────
  const excerptOf = (m: ChatMessage | undefined) =>
    m
      ? toExcerptText(messageTree(m.id, m.updatedAt, m.body), (type, id) =>
          type === "person"
            ? `@${personOf(id)?.name ?? "former member"}`
            : type === "team"
              ? "@team"
              : "a linked item",
        )
      : "";

  const rowView = (row: CatchupRow, group: CatchupGroup | null) => {
    const m = row.item.messageId ? snapshot.messages[row.item.messageId] : undefined;
    const sel = row.item.id === selected?.item.id;
    const person = m?.authorId ? personOf(m.authorId) : undefined;
    const time = row.item.returnedAt ?? m?.createdAt ?? row.item.createdAt;
    const sameDay = formatPastDay(time) === formatPastDay(new Date());
    return (
      <li key={row.item.id}>
        <button
          type="button"
          data-catchup-item={row.item.id}
          data-reason={row.item.reason}
          aria-current={sel ? "true" : undefined}
          onClick={() => select(row.item.id)}
          onDoubleClick={() =>
            canOpen(channels, row.item) &&
            onOpenConversation(row.item.channelId, row.item.messageId)
          }
          className={cn(
            "flex w-full min-w-0 items-start gap-2.5 rounded-md px-3 py-2 text-left outline-none",
            "transition-colors duration-(--motion-fade) ease-(--ease-out)",
            "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
            sel && "bg-state-active hover:bg-state-active",
          )}
        >
          {row.quiet || row.item.reason === "every_message" ? (
            <span className="mt-0.5 flex size-icon shrink-0 items-center justify-center text-muted-foreground">
              <MessageCircle aria-hidden className="size-icon" />
            </span>
          ) : (
            <PersonAvatar
              name={row.who ?? "Someone"}
              id={m?.authorId ?? m?.authorLabel ?? undefined}
              src={person?.avatarUrl}
              size="icon"
              className="mt-0.5"
            />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-baseline gap-1.5 text-sm">
              {row.who ? (
                <span className="truncate font-medium text-foreground">{row.who}</span>
              ) : null}
              <span
                className={cn(
                  "truncate",
                  row.who ? "text-muted-foreground" : "font-medium text-foreground",
                )}
              >
                {row.why}
              </span>
              {order === "newest" && !group ? (
                <span className="truncate text-subtle-foreground">
                  · {channelTitleFor(channels, row.item, selfId, personOf)}
                </span>
              ) : null}
            </span>
            {m && row.item.reason !== "every_message" ? (
              <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                {excerptOf(m)}
              </span>
            ) : null}
          </span>
          <time className="shrink-0 pt-0.5 text-xs text-subtle-foreground tabular-nums">
            {sameDay ? formatTime(time) : formatPastDay(time)}
          </time>
        </button>
      </li>
    );
  };

  const groupHead = (g: CatchupGroup) => {
    const c = channels[g.channelId];
    const other = c?.kind === "dm" ? dmPeople(c, selfId)[0] : undefined;
    const p = other ? personOf(other) : undefined;
    return (
      <div className="group/head flex min-w-0 items-center gap-2 px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">
        {c?.kind === "dm" ? (
          <PersonAvatar name={g.title} id={other} src={p?.avatarUrl} size="icon" />
        ) : (
          <MessageCircle aria-hidden className="size-icon-sm shrink-0" />
        )}
        <span className="truncate">{g.title}</span>
        <span className="tabular-nums text-subtle-foreground">{g.rows.length}</span>
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={MoreHorizontal}
              label={`${g.title} options`}
              tooltip={null}
              size="sm"
              className="ml-auto opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuItem onSelect={() => doneAll(g.channelId)}>
              Done all in this conversation
            </DropdownMenuItem>
            {channels[g.channelId] || g.rows.some((r) => r.item.reason !== "removed") ? (
              <DropdownMenuItem onSelect={() => onOpenConversation(g.channelId, null)}>
                Go to conversation
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  let body: ReactNode;
  if (snapshot.status === "idle" || snapshot.status === "loading") {
    body = (
      <div className="grid h-full place-items-center text-muted-foreground">
        <Loader2 className="size-icon animate-spin" aria-label="Loading Catch up" />
      </div>
    );
  } else if (snapshot.status === "error") {
    body = (
      <EmptyState
        icon={Inbox}
        title="Catch up couldn't load"
        description={snapshot.error ?? "Check your connection and try again."}
        action={
          <Button size="sm" onClick={() => void catchup?.load()}>
            Try again
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={Inbox}
        title="You're caught up."
        description={quietChannelsLine(unread, mine)}
      />
    );
  } else {
    body = (
      <ul
        aria-label="Catch up"
        data-slot="catchup-list"
        className="pane-scroll flex min-h-0 flex-1 flex-col overflow-auto px-2 pb-4"
      >
        {groups.map((g) =>
          order === "newest" ? (
            g.rows.map((r) => rowView(r, null))
          ) : (
            <li key={g.channelId} data-catchup-group={g.channelId}>
              {groupHead(g)}
              <ul>{g.rows.map((r) => rowView(r, g))}</ul>
            </li>
          ),
        )}
      </ul>
    );
  }

  const center = (
    <div className="flex h-full min-h-0 flex-col" data-slot="catchup">
      <header className="flex shrink-0 items-center gap-1 pt-3 pr-3 pb-2 pl-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Inbox aria-hidden className="size-icon shrink-0 text-muted-foreground" />
          <h1 className="truncate font-display text-lg font-semibold text-foreground">Catch up</h1>
          {rows.length > 0 ? (
            <span className="text-sm text-subtle-foreground tabular-nums">{rows.length}</span>
          ) : null}
        </div>
        <DisplayMenu
          controls={[
            {
              type: "segmented",
              id: "order",
              label: "Order",
              options: [
                { value: "grouped", label: "By conversation" },
                { value: "newest", label: "Newest first" },
              ],
            },
          ]}
          value={{ order }}
          defaultValue={{ order: "grouped" }}
          onValueChange={(v) => {
            const next = v.order === "newest" ? "newest" : "grouped";
            setOrder(next);
            writeOrder(next);
          }}
          align="end"
        />
      </header>
      {noticesOff ? (
        <p
          data-slot="catchup-notices-off"
          className="shrink-0 px-5 pb-2 text-xs text-muted-foreground"
        >
          {NOTICES_OFF_LINE}
        </p>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  );

  // ── right: the selected item in context ───────────────────────────────────
  const right = selected ? (
    <CatchupContext
      key={selected.item.id}
      title={channelTitleFor(channels, selected.item, selfId, personOf)}
      line={selected.quiet || !selected.item.messageId ? selected.why : null}
      chat={chat}
      messageId={selected.item.messageId}
      selfId={selfId}
      personOf={personOf}
      onPersonClick={onPersonClick}
      onOpen={
        canOpen(channels, selected.item)
          ? () => onOpenConversation(selected.item.channelId, selected.item.messageId)
          : undefined
      }
      reply={selectedMessage && renderReply ? renderReply(selectedMessage) : null}
    />
  ) : null;

  const dialogs = (
    <LaterDialog
      open={!!later}
      title="Later"
      description="It comes back to the top of Catch up at that time, with one notice."
      onPick={(at) => later && remindLater(later, at)}
      onClose={() => setLater(null)}
    />
  );

  return { center, right, dialogs };
}

/**
 * Whether a row's conversation can be opened: "X removed you from Q" names one
 * you may no longer read (a private one isn't among your conversations).
 */
function canOpen(channels: Readonly<Record<string, ChatChannel>>, item: ChatCatchupItem): boolean {
  return item.reason !== "removed" || !!channels[item.channelId];
}

function channelTitleFor(
  channels: Readonly<Record<string, ChatChannel>>,
  item: ChatCatchupItem,
  selfId: string,
  personOf: (id: string) => ChatPerson | undefined,
): string {
  const c = channels[item.channelId];
  if (c) return conversationTitle(c, selfId, personOf);
  return item.channelName?.trim() || "A conversation";
}

/** The right side in Catch up (frame 1): "In Acme" · Open conversation, the message in context, the reply box. */
function CatchupContext({
  title,
  line,
  chat,
  messageId,
  selfId,
  personOf,
  onPersonClick,
  onOpen,
  reply,
}: {
  title: string;
  /** A quiet line or a conversation reminder: its sentence instead of a message. */
  line: string | null;
  chat: ChatRuntime | null;
  messageId: string | null;
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
  onPersonClick?: (id: string) => void;
  /** Absent: the conversation can't be opened (no button). */
  onOpen?: () => void;
  reply: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-slot="catchup-context">
      <div className="flex min-h-(--ctrl-h) shrink-0 items-center gap-1">
        <h2 className="min-w-0 flex-1 truncate font-display text-base font-medium text-foreground">
          In {title}
        </h2>
        {onOpen ? (
          <Button size="sm" variant="secondary" onClick={onOpen}>
            Open conversation
          </Button>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        {messageId ? (
          <MessageInContext
            chat={chat}
            messageId={messageId}
            selfId={selfId}
            personOf={personOf}
            onPersonClick={onPersonClick}
          />
        ) : (
          <p className="px-2 text-sm text-muted-foreground">{line}</p>
        )}
      </div>
      {reply ? (
        <div className="shrink-0" data-slot="catchup-reply">
          {reply}
        </div>
      ) : null}
    </div>
  );
}
