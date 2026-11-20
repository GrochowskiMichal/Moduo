/**
 * `Change icon…` (specs/notes-refresh.md §Note header: an optional emoji
 * icon): every native emoji with a search, plus Remove icon. Opened from the
 * row menu and the top bar's `⋯`. The emoji data is Chat's bundled Emojibase
 * set (loaded on first use, never from a CDN); workspace custom emoji aren't
 * offered, since a note's icon is a plain emoji everywhere it shows.
 */

import { EmojiPicker } from "frimousse";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { resolveChatEmoji } from "../../chat/composer/emoji-data";
import type { Note } from "../model";
import { displayTitle } from "../title";
import { returnFocusToRow } from "./sidebar-tree";

export function IconPickerDialog({
  note,
  onOpenChange,
  onPick,
}: {
  note: Note | null;
  onOpenChange: (open: boolean) => void;
  /** An emoji, or null to remove the icon. */
  onPick: (note: Note, icon: string | null) => void;
}) {
  const pick = (icon: string | null) => {
    if (note) onPick(note, icon);
    onOpenChange(false);
  };
  // The note is gone from the props by the time the dialog finishes closing.
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (note) last.current = note.id;
  }, [note]);
  return (
    <Dialog open={note !== null} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-auto gap-3 p-3"
        onCloseAutoFocus={(e) => returnFocusToRow(last.current, e)}
      >
        <DialogHeader>
          <DialogTitle>Icon</DialogTitle>
          <DialogDescription className="truncate">
            {note ? `For “${displayTitle(note.title)}”` : ""}
          </DialogDescription>
        </DialogHeader>
        <EmojiPicker.Root
          className="isolate flex h-80 w-80 flex-col"
          columns={9}
          resolveEmojiData={resolveChatEmoji}
          onEmojiSelect={(e) => pick(e.emoji)}
        >
          <EmojiPicker.Search
            autoFocus
            aria-label="Search emoji"
            placeholder="Search emoji"
            className="mb-1.5 h-(--ctrl-h-sm) appearance-none rounded-md bg-state-hover px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
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
                    className="bg-popover px-1.5 pt-2 pb-1 text-xs font-medium text-muted-foreground"
                    {...props}
                  >
                    {category.label}
                  </div>
                ),
                Row: ({ children, ...props }) => (
                  <div className="scroll-my-1.5" {...props}>
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
        </EmojiPicker.Root>
        {note?.icon ? (
          <Button
            variant="ghost"
            size="sm"
            className="justify-self-start"
            onClick={() => pick(null)}
          >
            Remove icon
          </Button>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
