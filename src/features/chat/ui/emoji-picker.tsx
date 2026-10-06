// Reaction / insert picker: recent row, search by shortcode, grouped grid.
// Arrow keys move a roving focus across the grid; Enter picks; Esc closes
// (handled by the hosting Popover).

import { Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  EMOJI_GROUPS,
  type EmojiEntry,
  readRecentEmoji,
  rememberEmoji,
  searchEmoji,
} from "../emoji";

const COLS = 8;

export function EmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [query, setQuery] = useState("");
  const [recent] = useState(readRecentEmoji);
  const gridRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    if (query.trim()) return [{ id: "results", label: "Results", items: searchEmoji(query, 64) }];
    const out: { id: string; label: string; items: EmojiEntry[] }[] = [];
    if (recent.length)
      out.push({ id: "recent", label: "Recent", items: recent.map((e) => ({ e, n: [] })) });
    return [...out, ...EMOJI_GROUPS];
  }, [query, recent]);

  const pick = (emoji: string) => {
    rememberEmoji(emoji);
    onPick(emoji);
  };

  const onGridKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-emoji]") ?? [],
    );
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const delta =
      event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowLeft"
          ? -1
          : event.key === "ArrowDown"
            ? COLS
            : event.key === "ArrowUp"
              ? -COLS
              : 0;
    if (!delta) return;
    event.preventDefault();
    buttons[Math.min(Math.max(i + delta, 0), buttons.length - 1)]?.focus();
  };

  return (
    <div className="flex w-72 flex-col gap-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2 size-icon-sm -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const first = sections[0]?.items[0];
              if (first) {
                e.preventDefault();
                pick(first.e);
              }
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              gridRef.current?.querySelector<HTMLButtonElement>("button[data-emoji]")?.focus();
            }
          }}
          placeholder="Search emoji"
          aria-label="Search emoji"
          className="pl-7"
        />
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: roving-focus container for the grid's buttons */}
      <div
        ref={gridRef}
        onKeyDown={onGridKey}
        className="scrollbar-thin flex max-h-64 flex-col gap-2 overflow-y-auto pr-1"
      >
        {sections.map((section) =>
          section.items.length === 0 ? null : (
            <div key={section.id} className="flex flex-col gap-1">
              <span className="px-1 text-2xs text-muted-foreground">{section.label}</span>
              <div className="grid grid-cols-8 gap-0.5">
                {section.items.map((item) => (
                  <button
                    key={`${section.id}:${item.e}`}
                    type="button"
                    data-emoji
                    title={item.n[0] ? `:${item.n[0]}:` : item.e}
                    aria-label={item.n[0] ?? item.e}
                    onClick={() => pick(item.e)}
                    className={cn(
                      "grid aspect-square place-items-center rounded-md text-lg transition-colors",
                      "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    {item.e}
                  </button>
                ))}
              </div>
            </div>
          ),
        )}
        {sections.every((s) => s.items.length === 0) ? (
          <p className="px-1 py-4 text-center text-xs text-muted-foreground">
            No emoji match “{query}”.
          </p>
        ) : null}
      </div>
    </div>
  );
}
