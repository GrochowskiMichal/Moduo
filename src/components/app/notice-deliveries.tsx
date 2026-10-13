// Hears this person's notice deliveries live (TV-D12): a reminder arrives as
// an OS notification on the desktop app (which keeps running in the menu bar
// when its window closes), as a toast while Moduo is in front, and refreshes
// the bell either way. In any workspace: the channel is filtered by person,
// not workspace (REPLAN 80). The web app's OS-level notices come from the push
// service worker instead (browser notifications, opt-in).

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { isAppInBackground } from "../../features/focus/phase-alert";
import { ENTITY_OPEN_EVENT } from "../../lib/entity-open";
import {
  deliveriesToShow,
  type NoticeDelivery,
  noticeCopy,
  noticeDeliveryFromRow,
} from "../../lib/notices/deliveries";
import { isTauriRuntime } from "../../lib/runtime";
import { supabaseClient } from "../../lib/runtime.web";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

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

export function NoticeDeliveries() {
  const { userId } = useAuth();
  const { refreshNotifications, selectedWorkspaceId } = useWorkspace();
  const workspaceRef = useRef(selectedWorkspaceId);
  useEffect(() => {
    workspaceRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId]);
  const refresh = useRef(refreshNotifications);
  useEffect(() => {
    refresh.current = refreshNotifications;
  }, [refreshNotifications]);
  const shown = useRef(new Set<string>());

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
          const here = !delivery.workspaceId || delivery.workspaceId === workspaceRef.current;
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
  }, [userId]);

  return null;
}
