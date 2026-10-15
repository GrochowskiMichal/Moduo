// Hears this person's notice deliveries live (TV-D12), in any workspace: the
// channel is filtered by person, not workspace (REPLAN 80).
//
// A reminder arrives as an OS notification on the desktop app (which keeps
// running in the menu bar when its window closes), as a toast while Moduo is in
// front, and refreshes the bell either way. The web app's OS-level notices come
// from the push service worker instead (browser notifications, opt-in).
//
// A chat notice (CV-6b) rings on one device only: the client that has Chat of
// that workspace in front of you shows it in place and acknowledges it; else
// your most recently active client (asked of the server as the notice
// arrives) rings an OS notification on the desktop and acknowledges it, once
// per conversation a minute; a browser tab never rings itself, its push does
// after 8 s when nobody acknowledged. This component also keeps the client's
// heartbeat, the counts outside Chat (switcher, dock, tab title) and the web
// app's one-time ask.

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import type { ChatBadge } from "../../features/chat/hooks/use-chat-badge";
import { isAppInBackground } from "../../features/focus/phase-alert";
import { ENTITY_OPEN_EVENT } from "../../lib/entity-open";
import { showAppBadge } from "../../lib/notices/app-badge";
import { refreshChatCounts, resetChatCounts, useChatCounts } from "../../lib/notices/chat-counts";
import {
  ackNotices,
  CLIENT_IDLE_MS,
  CLIENT_SEEN_MS,
  type ClientSurface,
  stampClient,
} from "../../lib/notices/clients";
import {
  deliveriesToShow,
  isChatNotice,
  type NoticeDelivery,
  noticeCopy,
  noticeDeliveryFromRow,
} from "../../lib/notices/deliveries";
import {
  chatNoticeSwitch,
  chatNoticeTarget,
  decideChatNotice,
  isChatInFront,
  RING_CLICK_MS,
} from "../../lib/notices/ring";
import { playChatSound, soundsForNotice } from "../../lib/notices/sound";
import { currentPreferences } from "../../lib/preferences";
import { isTauriRuntime } from "../../lib/runtime";
import { supabaseClient } from "../../lib/runtime.web";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { ChatNoticeAsk } from "./chat-notice-ask";

/** The counts of other workspaces are re-read this long after your Catch up rows settle. */
const COUNTS_SETTLE_MS = 1500;

async function notifyDesktop(title: string, body: string): Promise<void> {
  try {
    const notification = await import("@tauri-apps/plugin-notification");
    let granted = await notification.isPermissionGranted();
    if (!granted) granted = (await notification.requestPermission()) === "granted";
    if (granted) notification.sendNotification({ title, body });
  } catch (error) {
    console.warn("[notices] desktop notification failed", error);
  }
}

function openTask(delivery: NoticeDelivery): void {
  if (!delivery.taskId) return;
  window.dispatchEvent(
    new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: "task", id: delivery.taskId } }),
  );
}

type Rung = { workspaceId: string | null; target: { c: string; m?: string }; at: number };

export function NoticeDeliveries({
  chat,
}: {
  chat?: Pick<ChatBadge, "enabled" | "conversationKind">;
}) {
  const { userId } = useAuth();
  const { refreshNotifications, selectedWorkspaceId, selectWorkspace, workspaces } = useWorkspace();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = useRouterState({ select: (state) => state.location.search }) as {
    c?: unknown;
    m?: unknown;
  };
  const navigate = useNavigate();
  const surface: ClientSurface = isTauriRuntime() ? "desktop" : "web";

  // Latest values for the long-lived listeners below.
  const live = useRef({ selectedWorkspaceId, pathname, chat, selectWorkspace, navigate });
  useEffect(() => {
    live.current = { selectedWorkspaceId, pathname, chat, selectWorkspace, navigate };
  });
  const refresh = useRef(refreshNotifications);
  useEffect(() => {
    refresh.current = refreshNotifications;
  }, [refreshNotifications]);
  const shown = useRef(new Set<string>());
  const rungByTag = useRef(new Map<string, number>());
  const lastRing = useRef<Rung | null>(null);
  const lastInput = useRef(Date.now());

  // ── Attention: focused, visible and not idle ────────────────────────────
  useEffect(() => {
    let last = 0;
    const touch = () => {
      const now = Date.now();
      if (now - last < 1000) return;
      last = now;
      lastInput.current = now;
    };
    const events = ["keydown", "pointerdown", "pointermove", "wheel"] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
    };
  }, []);
  const hasAttention = useCallback(
    () =>
      typeof document !== "undefined" &&
      document.hasFocus() &&
      document.visibilityState === "visible" &&
      Date.now() - lastInput.current < CLIENT_IDLE_MS,
    [],
  );

  // Open the message a notice is about: its workspace first (a running Focus keeps running).
  const land = useCallback((workspaceId: string | null, target: { c: string; m?: string }) => {
    const { selectedWorkspaceId: open, selectWorkspace: select, navigate: go } = live.current;
    if (workspaceId && workspaceId !== open) select(workspaceId);
    void go({ to: "/chat", search: target });
  }, []);

  // ── Heartbeat: this client is open (and has your attention) ─────────────
  useEffect(() => {
    if (!userId) return;
    const stamp = () => void stampClient(surface, hasAttention());
    stamp();
    const timer = setInterval(stamp, CLIENT_SEEN_MS);
    const onFocus = () => {
      lastInput.current = Date.now();
      stamp();
      // The desktop's OS notification has no click of its own: Moduo coming
      // to the front right after it rang is that click.
      const rung = lastRing.current;
      lastRing.current = null;
      if (rung && Date.now() - rung.at < RING_CLICK_MS) land(rung.workspaceId, rung.target);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") stamp();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [userId, surface, hasAttention, land]);

  // ── The deliveries ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!userId) return;
    let pending: NoticeDelivery[] = [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      const batch = deliveriesToShow(pending, shown.current);
      pending = [];
      for (const delivery of batch) {
        shown.current.add(delivery.id);
        const copy = noticeCopy(delivery);
        if (isAppInBackground()) {
          // Web: the push service worker shows it (browser notifications, opt-in).
          if (isTauriRuntime()) void notifyDesktop(copy.title, copy.body);
        } else {
          // Open only a task of the workspace on screen; another workspace's
          // reminder is in that workspace's bell.
          const here =
            !delivery.workspaceId || delivery.workspaceId === live.current.selectedWorkspaceId;
          toast(copy.title, {
            description: copy.body,
            action:
              delivery.taskId && here
                ? { label: "Open", onClick: () => openTask(delivery) }
                : undefined,
          });
        }
      }
      void refresh.current();
    };

    const handleChat = async (delivery: NoticeDelivery) => {
      if (shown.current.has(delivery.id)) return;
      shown.current.add(delivery.id);
      const { selectedWorkspaceId: open, pathname: path, chat: here } = live.current;
      const inFront = isChatInFront({
        focused: document.hasFocus(),
        visible: document.visibilityState === "visible",
        pathname: path,
        selectedWorkspaceId: open,
        workspaceId: delivery.workspaceId,
      });
      const kind =
        delivery.channelId && delivery.workspaceId === open
          ? (here?.conversationKind(delivery.channelId) ?? null)
          : null;
      const switchKey = chatNoticeSwitch(delivery, kind);
      const switchedOff = switchKey ? !currentPreferences().notifications[switchKey] : false;
      // Ask the server now, not at the last heartbeat: whoever you touched last rings.
      const latest =
        inFront || delivery.heldForFocus ? null : await stampClient(surface, hasAttention());
      const now = Date.now();
      const tag = delivery.tag ?? delivery.id;
      const action = decideChatNotice({
        held: delivery.heldForFocus,
        inFront,
        latest,
        surface,
        switchedOff,
        lastRungAt: rungByTag.current.get(tag) ?? null,
        now,
      });
      if (action === "leave") return;
      if (action === "ring") {
        rungByTag.current.set(tag, now);
        const target = chatNoticeTarget(delivery.url);
        lastRing.current = target ? { workspaceId: delivery.workspaceId, target, at: now } : null;
        const copy = noticeCopy(delivery);
        void notifyDesktop(copy.title, copy.body);
      }
      if ((action === "ring" || action === "show-in-place") && !switchedOff) {
        if (soundsForNotice(delivery, kind)) playChatSound();
      }
      await ackNotices([delivery.id]);
    };

    const channel = supabaseClient
      .channel(`notice-deliveries:${userId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notice_deliveries",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const delivery = noticeDeliveryFromRow((payload as { new?: unknown }).new);
          if (!delivery) return;
          if (isChatNotice(delivery)) {
            void handleChat(delivery);
            return;
          }
          pending.push(delivery);
          // A sender run can deliver several at once: show them together.
          if (!timer) timer = setTimeout(flush, 400);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabaseClient.removeChannel(channel);
    };
  }, [userId, surface, hasAttention]);

  // ── Counts outside Chat: the switcher per workspace, the app badge the sum ─
  const workspaceIds = workspaces.map((w) => w.id).join(",");
  useEffect(() => {
    if (!userId) {
      resetChatCounts();
      return;
    }
    const ids = workspaceIds ? workspaceIds.split(",") : [];
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reread = () => void refreshChatCounts(ids, selectedWorkspaceId);
    reread();
    const channel = supabaseClient
      .channel(`chat-counts:${userId}:${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chat_catchup", filter: `user_id=eq.${userId}` },
        (payload) => {
          // The open workspace counts live from its store.
          const row = ((payload as { new?: unknown }).new ?? (payload as { old?: unknown }).old) as
            | { workspace_id?: unknown }
            | undefined;
          if (row?.workspace_id && row.workspace_id === selectedWorkspaceId) return;
          if (timer) clearTimeout(timer);
          timer = setTimeout(reread, COUNTS_SETTLE_MS);
        },
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabaseClient.removeChannel(channel);
    };
  }, [userId, workspaceIds, selectedWorkspaceId]);

  const { total } = useChatCounts();
  useEffect(() => {
    showAppBadge(userId ? total : 0);
  }, [userId, total]);

  // ── A browser notice's link into another workspace ──────────────────────
  // The push opens `/chat?c=…&m=…`; when the conversation isn't this
  // workspace's, find whose it is (yours to read) and switch there.
  const tried = useRef(new Set<string>());
  const chatReady = chat?.enabled === true;
  const wantC = typeof search.c === "string" ? search.c : null;
  const wantM = typeof search.m === "string" ? search.m : undefined;
  useEffect(() => {
    if (pathname !== "/chat" || !wantC || !chatReady) return;
    if (live.current.chat?.conversationKind(wantC) !== null || tried.current.has(wantC)) return;
    tried.current.add(wantC);
    const known = new Set(workspaceIds.split(","));
    void (async () => {
      const { data } = await supabaseClient
        .from("chat_channels")
        .select("workspace_id")
        .eq("id", wantC)
        .maybeSingle();
      const ws = (data as { workspace_id?: string } | null)?.workspace_id;
      if (ws && ws !== live.current.selectedWorkspaceId && known.has(ws)) {
        land(ws, wantM ? { c: wantC, m: wantM } : { c: wantC });
      }
    })();
  }, [pathname, wantC, wantM, chatReady, workspaceIds, land]);

  return surface === "web" ? <ChatNoticeAsk /> : null;
}
