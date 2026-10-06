// Home "Conversations" widget (specs/chat.md §Widget). Conversations that need
// you (DMs, mentions) first, then the most recently active. Live: it holds the
// shared chat realtime link (same one the nav badge uses) and recounts on new
// messages and read changes. Workspaces without chat get a quiet one-liner.

import { Hash, Lock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ChatChannel, ChatMember, ChatPerson, ChatUnread } from "@/features/chat/model";
import { acquireChatLink, CHAT_READ_CHANGED_EVENT } from "@/features/chat/realtime";
import { dmOtherIds } from "@/features/chat/timeline";
import { initialsOf } from "@/features/chat/ui/person-avatar";
import { shapeChatWidget } from "@/features/chat/widget";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "@/providers/workspace-provider";
import { useDensity } from "../../hooks/use-density";
import type { WidgetComponentProps } from "../../registry/types";
import { widgetRowBudget } from "../../widget-density";
import { openEntity, openModuleRoute } from "../../widget-nav";
import {
  WidgetBodyRoot,
  WidgetEmpty,
  WidgetList,
  WidgetLoading,
  WidgetMore,
  WidgetRow,
  WidgetScroll,
  WidgetSectionLabel,
} from "./widget-primitives";

type Data = {
  enabled: boolean;
  channels: ChatChannel[];
  mine: ChatMember[];
  unread: ChatUnread[];
  people: Record<string, ChatPerson>;
};

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
function ago(iso: string | null): string | undefined {
  if (!iso) return undefined;
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "now";
  if (mins < 60) return RELATIVE.format(-mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours < 24) return RELATIVE.format(-hours, "hour");
  return RELATIVE.format(-Math.round(hours / 24), "day");
}

export function ChatWidget({ size }: WidgetComponentProps) {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  const density = useDensity();
  const [data, setData] = useState<Data | null>(null);

  useEffect(() => {
    setData(null);
    if (!runtime || !selectedWorkspaceId || !userId) return;
    let cancelled = false;
    let release: (() => void) | null = null;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      const [channels, mine, unread, members] = await Promise.all([
        runtime.chat.listChannels(selectedWorkspaceId),
        runtime.chat.listMyMemberships(selectedWorkspaceId, userId),
        runtime.chat.unreadCounts(selectedWorkspaceId),
        runtime.workspace.listMembers(selectedWorkspaceId).catch(() => [] as unknown[]),
      ]);
      const people: Record<string, ChatPerson> = {};
      for (const raw of members) {
        const row = raw as {
          user_id?: string;
          profiles?: { display_name?: string; avatar_url?: string };
        };
        if (!row.user_id) continue;
        people[row.user_id] = {
          userId: row.user_id,
          name: row.profiles?.display_name?.trim() || "Member",
          avatarUrl: row.profiles?.avatar_url ?? null,
          role: null,
        };
      }
      if (!cancelled) setData({ enabled: true, channels, mine, unread, people });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load().catch(() => {}), 400);
    };

    void (async () => {
      try {
        const enabled = await runtime.chat.isEnabled(selectedWorkspaceId);
        if (cancelled) return;
        if (!enabled) {
          setData({ enabled: false, channels: [], mine: [], unread: [], people: {} });
          return;
        }
        await load();
        if (cancelled) return;
        const held = acquireChatLink(selectedWorkspaceId, userId);
        release = held.release;
        unsubscribe = held.link.subscribe((e) => {
          if (e.type === "message" && (!e.isInsert || e.message.parentId)) return;
          schedule();
        });
      } catch {
        if (!cancelled) setData({ enabled: true, channels: [], mine: [], unread: [], people: {} });
      }
    })();
    window.addEventListener(CHAT_READ_CHANGED_EVENT, schedule);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener(CHAT_READ_CHANGED_EVENT, schedule);
      unsubscribe?.();
      release?.();
    };
  }, [runtime, selectedWorkspaceId, userId]);

  const budget = widgetRowBudget(size, density);
  const view = useMemo(
    () =>
      data && userId
        ? shapeChatWidget({ ...data, selfId: userId, limit: budget })
        : { rows: [], needsYou: 0 },
    [data, userId, budget],
  );
  const total = useMemo(
    () => (data ? data.mine.filter((m) => m.notifyLevel !== "none").length : 0),
    [data],
  );

  if (!data) return <WidgetLoading />;
  if (!data.enabled) {
    return <WidgetEmpty>Chat comes with the Duo and Team plans.</WidgetEmpty>;
  }
  if (view.rows.length === 0) {
    return <WidgetEmpty>No conversations yet — say hi in #general.</WidgetEmpty>;
  }

  return (
    <WidgetBodyRoot>
      <WidgetScroll>
        <div className="flex flex-col gap-0.5 p-1.5">
          <WidgetSectionLabel count={view.needsYou || undefined}>
            {view.needsYou > 0 ? "Needs you" : "Recent"}
          </WidgetSectionLabel>
          <WidgetList className="p-0">
            {view.rows.map((row) => {
              const channel = data.channels.find((c) => c.id === row.channelId);
              const others = channel && userId ? dmOtherIds(channel, userId) : [];
              const leading =
                row.kind === "dm" ? (
                  <span className="grid size-5 shrink-0 place-items-center rounded-avatar bg-muted font-display text-2xs text-muted-foreground">
                    {others.length > 1
                      ? others.length + 1
                      : initialsOf(data.people[others[0] ?? userId ?? ""]?.name ?? "?").slice(0, 1)}
                  </span>
                ) : undefined;
              return (
                <WidgetRow
                  key={row.channelId}
                  icon={row.kind === "dm" ? undefined : row.isPrivate ? Lock : Hash}
                  leading={leading}
                  title={row.title}
                  emphasis={row.unread}
                  trailing={row.count > 0 ? String(row.count) : ago(row.lastMessageAt)}
                  onClick={() => openEntity("chat_channel", row.channelId)}
                />
              );
            })}
          </WidgetList>
          <WidgetMore count={total - view.rows.length} onClick={() => openModuleRoute("/chat")} />
        </div>
      </WidgetScroll>
    </WidgetBodyRoot>
  );
}
