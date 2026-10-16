// Settings → Chat → Custom emoji (CV-20, spec §6 and §15, CH16b; round-2.html
// frame 6 · settings): the open workspace's emoji, newest first, each with who
// added it; "Add emoji" for whoever has the switch; ⋯ → Remove on your own,
// or on any for an admin. Removing is a soft delete: messages and reactions
// that used it read `:name:` from then on.

import { MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { getRuntime } from "@/lib/runtime";

import { PrefGroup } from "../../settings/sections/preferences-section";
import { useWorkspace } from "../../workspaces/workspace-context";
import { rightsFrom, useChatCapsRows } from "../shell/use-chat-rights";
import { CustomEmojiGlyph } from "./custom-emoji";
import { addedByLine, EMOJI_LIMITS, emojiKey, emojiRoomLeft } from "./model";
import { applyEmoji, useWorkspaceEmoji } from "./store";
import { AddEmojiDialog } from "./upload-dialog";

/** Whether chat is on the workspace's plan (null while asking or unknown). */
function useChatOnPlan(workspaceId: string | null): boolean | null {
  const [state, setState] = useState<{ ws: string; on: boolean } | null>(null);
  useEffect(() => {
    const chat = getRuntime()?.chat;
    if (!workspaceId || !chat) return;
    let live = true;
    chat
      .isEnabled(workspaceId)
      .then((on) => {
        if (live) setState({ ws: workspaceId, on });
      })
      .catch(() => {
        // Unknown: the button stays hidden; the op would say why anyway.
      });
    return () => {
      live = false;
    };
  }, [workspaceId]);
  return state && state.ws === workspaceId ? state.on : null;
}

const dayFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export function CustomEmojiGroup({ userId }: { userId: string | null }) {
  const { selectedWorkspaceId, selectedWorkspace, members, roles, modulePermissions } =
    useWorkspace();
  const emoji = useWorkspaceEmoji(selectedWorkspaceId);
  const caps = useChatCapsRows(selectedWorkspaceId);
  const self = members.find((m) => m.userId === userId);
  const readOnly =
    modulePermissions.chat === "view" ||
    (roles.find((r) => r.id === self?.roleId)?.readOnly ?? false);
  const role = selectedWorkspace?.role ?? null;
  const rights = rightsFrom(caps, role, readOnly);
  const isAdmin = role === "owner" || role === "admin";
  const [adding, setAdding] = useState(false);
  const onPlan = useChatOnPlan(selectedWorkspaceId);
  // Paused chat still lists them (CH4a), but adding and removing wait for the plan.
  const writable = onPlan === true;

  if (!selectedWorkspaceId) return null;
  const nameOf = (id: string) => members.find((m) => m.userId === id)?.displayName?.trim() || null;
  const room = emojiRoomLeft(emoji.list.length);

  const remove = async (id: string, name: string) => {
    const chat = getRuntime()?.chat;
    if (!chat) return;
    try {
      applyEmoji(await chat.removeCustomEmoji(id));
      toast(`Removed ${emojiKey(name)}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove it. Try again.");
    }
  };

  return (
    <PrefGroup
      label={`Custom emoji · ${selectedWorkspace?.name ?? "This workspace"}`}
      description={`Anyone in the workspace with the switch can add one: PNG, GIF or WebP, up to ${Math.round(EMOJI_LIMITS.bytes / 1024)} KB. Animated ones play when you hover them.`}
    >
      <div className="flex flex-col gap-3 py-4" data-slot="custom-emoji">
        {emoji.list.length > 0 ? (
          <ul aria-label="Custom emoji" className="flex flex-col">
            {emoji.list.map((e) => {
              const mayRemove = writable && (isAdmin || (!!userId && e.createdBy === userId));
              return (
                <li
                  key={e.id}
                  className="flex h-9 items-center gap-2.5 border-b border-hairline text-sm"
                >
                  <CustomEmojiGlyph
                    name={e.name}
                    emoji={e}
                    urlOf={emoji.urlOf}
                    size="row"
                    className="shrink-0"
                  />
                  <span className="w-36 shrink-0 truncate font-mono text-foreground">
                    {emojiKey(e.name)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {addedByLine(e, userId, nameOf, (iso) => dayFormat.format(new Date(iso)))}
                  </span>
                  {mayRemove ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton
                          icon={MoreHorizontal}
                          label={`More for ${emojiKey(e.name)}`}
                          size="sm"
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => void remove(e.id, e.name)}
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ul>
        ) : emoji.loaded ? (
          <p className="text-sm text-muted-foreground">No custom emoji yet.</p>
        ) : null}
        {rights.addEmoji && onPlan === false ? (
          <p className="text-xs text-muted-foreground">
            Adding emoji is available on the Duo and Team plans.
          </p>
        ) : null}
        {rights.addEmoji && writable ? (
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" disabled={!room} onClick={() => setAdding(true)}>
              <Plus aria-hidden className="size-icon" />
              Add emoji
            </Button>
            {!room ? (
              <span className="text-xs text-muted-foreground">
                {EMOJI_LIMITS.perWorkspace} is the most a workspace holds. Remove one first.
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <AddEmojiDialog
        open={adding}
        onOpenChange={setAdding}
        workspaceId={selectedWorkspaceId}
        taken={new Set(emoji.byName.keys())}
      />
    </PrefGroup>
  );
}
