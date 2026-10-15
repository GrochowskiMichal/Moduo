// The emoji picker (#18): Frimousse over Emojibase's bundled data, native
// emoji, a search on top, skin tone at the bottom. Picking hands the emoji to
// the caller (the composer inserts it at the caret). The personal quick row is
// CV-7c's; the workspace's own emoji CV-20's.

import { EmojiPicker } from "frimousse";

import { resolveChatEmoji } from "./emoji-data";

export function ChatEmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
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
        className="m-1.5 h-(--ctrl-h-sm) appearance-none rounded-md bg-state-hover px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
      />
      <EmojiPicker.Viewport className="relative flex-1 outline-none">
        <EmojiPicker.Loading className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Loading…
        </EmojiPicker.Loading>
        <EmojiPicker.Empty className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          No emoji found.
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
