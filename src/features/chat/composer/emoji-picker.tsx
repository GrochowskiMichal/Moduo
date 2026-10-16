// The emoji picker (#18): Frimousse over Emojibase's bundled data, native
// emoji, a search on top, skin tone at the bottom. Picking hands the emoji to
// the caller (the composer inserts it at the caret). The personal quick row is
// CV-7c's. The workspace's own emoji come first (CV-20; round-2.html frame
// 6 · picker): a section named after the workspace with "Add emoji…" for
// whoever may add one, filtered by the same search; picking one hands `:name:`.

import { EmojiPicker } from "frimousse";
import { useContext, useState } from "react";

import { dispatchOpenSettings } from "../../settings/settings-events";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import { useCustomEmoji } from "../emoji/context";
import { CustomEmojiGlyph } from "../emoji/custom-emoji";
import { emojiKey, matchCustomEmoji } from "../emoji/model";
import { resolveChatEmoji } from "./emoji-data";

export function ChatEmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState("");
  const custom = useCustomEmoji();
  // "Add emoji…" opens Settings → Chat's Custom emoji (the add lives there).
  const onAddEmoji = custom.canAdd ? () => dispatchOpenSettings({ section: "chat" }) : undefined;
  const workspaceName = useContext(WorkspaceContext)?.selectedWorkspace?.name ?? "This workspace";
  const shown = query.trim() ? matchCustomEmoji(custom.list, query.trim(), 64) : custom.list;
  const section = custom.list.length > 0 || onAddEmoji;
  return (
    <EmojiPicker.Root
      className="isolate flex h-80 w-80 flex-col"
      columns={9}
      resolveEmojiData={resolveChatEmoji}
      onEmojiSelect={(e) => onPick(e.emoji)}
    >
      <EmojiPicker.Search
        autoFocus
        aria-label="Search emoji"
        placeholder="Search emoji"
        onChange={(e) => setQuery(e.target.value)}
        className="m-1.5 h-(--ctrl-h-sm) appearance-none rounded-md bg-state-hover px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      {section && (shown.length > 0 || !query.trim()) ? (
        <section aria-label={`${workspaceName} emoji`} className="border-b border-border pb-1.5">
          <div className="flex h-6 items-center justify-between px-3 text-xs text-muted-foreground">
            <span className="truncate font-medium">{workspaceName}</span>
            {onAddEmoji ? (
              <button
                type="button"
                onClick={onAddEmoji}
                className="rounded-sm px-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
              >
                Add emoji…
              </button>
            ) : null}
          </div>
          {shown.length > 0 ? (
            <div className="grid max-h-24 grid-cols-9 overflow-y-auto px-1.5">
              {shown.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  aria-label={emojiKey(e.name)}
                  title={emojiKey(e.name)}
                  onClick={() => onPick(emojiKey(e.name))}
                  className="grid size-8 place-items-center rounded-md outline-none hover:bg-state-active focus-visible:bg-state-active"
                >
                  <CustomEmojiGlyph name={e.name} emoji={e} urlOf={custom.urlOf} size="picker" />
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
      <EmojiPicker.Viewport className="relative flex-1 outline-none">
        <EmojiPicker.Loading className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Loading…
        </EmojiPicker.Loading>
        <EmojiPicker.Empty className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          {shown.length > 0 ? null : "No emoji found."}
        </EmojiPicker.Empty>
        <EmojiPicker.List
          className="select-none pb-1.5"
          components={{
            CategoryHeader: ({ category, ...props }) => (
              <div
                className="bg-popover px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                {...props}
              >
                {category.label}
              </div>
            ),
            Row: ({ children, ...props }) => (
              <div className="scroll-my-1.5 px-1.5" {...props}>
                {children}
              </div>
            ),
            Emoji: ({ emoji, ...props }) => (
              <button
                type="button"
                className="grid size-8 place-items-center rounded-md text-lg data-active:bg-state-active"
                {...props}
              >
                {emoji.emoji}
              </button>
            ),
          }}
        />
      </EmojiPicker.Viewport>
      <div className="flex h-9 items-center gap-2 border-t border-border px-2">
        <EmojiPicker.ActiveEmoji>
          {({ emoji }) =>
            emoji ? (
              <>
                <span className="text-lg leading-none">{emoji.emoji}</span>
                <span className="truncate text-xs text-muted-foreground">{emoji.label}</span>
              </>
            ) : (
              <span className="text-xs text-muted-foreground">Pick an emoji…</span>
            )
          }
        </EmojiPicker.ActiveEmoji>
        <EmojiPicker.SkinToneSelector className="ml-auto grid size-(--ctrl-h-sm) place-items-center rounded-md text-base hover:bg-state-hover" />
      </div>
    </EmojiPicker.Root>
  );
}
