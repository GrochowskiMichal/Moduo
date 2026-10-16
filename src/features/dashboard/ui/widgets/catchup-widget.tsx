// Home "Catch up" widget (chat v2 CV-22, CH35; prototype round 5 frame 8):
// what's waiting for you in this workspace, newest first, in the Catch up
// list's words; a row or the count opens Catch up. It reads the workspace's
// chat store (the one the nav badge holds) and Catch up's open items
// (`chat_catchup_open`, your own items only), so it keeps working while chat is
// paused (reading stays on). It replaces v1's "Conversations" widget and keeps
// its type id `chat`, so saved dashboards keep their widget.

import { useMemo } from "react";
import { PersonAvatar } from "@/components/ui/avatar";
import { useCatchup } from "@/features/chat/catchup/catchup-store";
import { shapeCatchupWidget } from "@/features/chat/catchup/widget";
import { useChatSnapshot, useChatStore } from "@/features/chat/store/react";
import { formatPastDay, formatTime } from "@/lib/time-format";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "@/providers/workspace-provider";
import { useDensity } from "../../hooks/use-density";
import type { WidgetComponentProps } from "../../registry/types";
import { widgetRowBudget } from "../../widget-density";
import { openModuleRoute } from "../../widget-nav";
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

const openCatchup = () => openModuleRoute("/chat", { view: "catchup" });

function when(at: string): string {
  return formatPastDay(at) === formatPastDay(new Date()) ? formatTime(at) : formatPastDay(at);
}

export function CatchupWidget({ size }: WidgetComponentProps) {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  const density = useDensity();
  const store = useChatStore(runtime, userId, selectedWorkspaceId);
  const chat = useChatSnapshot(store);
  const { snapshot } = useCatchup(store);
  // S is a short list; saved v1 instances at L read as M.
  const budget = widgetRowBudget(size === "S" ? "S" : "M", density);

  const view = useMemo(
    () =>
      userId
        ? shapeCatchupWidget({
            items: snapshot.items,
            messages: snapshot.messages,
            channels: chat.channels,
            unread: chat.unread,
            people: chat.people,
            selfId: userId,
            limit: budget,
          })
        : { rows: [], count: 0, more: 0 },
    [snapshot.items, snapshot.messages, chat.channels, chat.unread, chat.people, userId, budget],
  );

  if (
    snapshot.status === "idle" ||
    (snapshot.status === "loading" && snapshot.items.length === 0)
  ) {
    return <WidgetLoading />;
  }
  if (snapshot.status === "error" && snapshot.items.length === 0) {
    return <WidgetEmpty>Catch up couldn't load. Open Chat to try again.</WidgetEmpty>;
  }
  if (view.rows.length === 0) {
    return <WidgetEmpty>You're caught up.</WidgetEmpty>;
  }

  return (
    <WidgetBodyRoot>
      <WidgetScroll>
        <div className="flex flex-col gap-0.5 p-1.5" data-catchup-widget="">
          <WidgetSectionLabel count={view.count || undefined}>Waiting for you</WidgetSectionLabel>
          <WidgetList className="p-0">
            {view.rows.map((row) => (
              <WidgetRow
                key={row.id}
                leading={
                  row.whoId ? (
                    <PersonAvatar
                      name={row.who ?? ""}
                      id={row.whoId}
                      src={chat.people[row.whoId]?.avatarUrl ?? null}
                      size="icon"
                    />
                  ) : undefined
                }
                title={
                  row.who ? (
                    <>
                      <span className="font-medium">{row.who}</span> {row.line}
                    </>
                  ) : (
                    row.line
                  )
                }
                trailing={when(row.at)}
                onClick={openCatchup}
              />
            ))}
          </WidgetList>
          <WidgetMore count={view.more} onClick={openCatchup} />
        </div>
      </WidgetScroll>
    </WidgetBodyRoot>
  );
}
