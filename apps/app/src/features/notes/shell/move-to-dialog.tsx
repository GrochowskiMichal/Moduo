/**
 * `Move to…` (specs/notes-refresh.md NR-2 §Sidebar): pick the Inbox, the top
 * of Pages, or any page to nest under. The note itself and everything under
 * it are not offered (no cycles), nor are archived or trashed notes.
 */

import { FileText, FolderOpen, Inbox } from "lucide-react";
import { type CSSProperties, useMemo } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { Note } from "../model";
import type { SidebarSections } from "../sections";
import { displayTitle } from "../title";
import type { NoteTreeNode } from "../tree";
import type { DropTarget } from "./drop-intent";

type Destination = { key: string; label: string; depth: number; target: DropTarget };

function destinations(sections: SidebarSections, movingId: string): Destination[] {
  const out: Destination[] = [];
  const walk = (nodes: NoteTreeNode[], section: "inbox" | "pages", depth: number) => {
    for (const { note, children } of nodes) {
      if (note.id === movingId) continue; // skips its whole subtree too
      out.push({
        key: note.id,
        label: displayTitle(note.title),
        depth,
        target: { kind: "row", section, id: note.id, zone: "into" },
      });
      walk(children, section, depth + 1);
    }
  };
  walk(sections.pages, "pages", 0);
  walk(sections.inbox, "inbox", 0);
  return out;
}

export function MoveToDialog({
  note,
  sections,
  onOpenChange,
  onPick,
}: {
  note: Note | null;
  sections: SidebarSections;
  onOpenChange: (open: boolean) => void;
  onPick: (target: DropTarget) => void;
}) {
  const pages = useMemo(() => (note ? destinations(sections, note.id) : []), [note, sections]);
  const pick = (target: DropTarget) => {
    onPick(target);
    onOpenChange(false);
  };
  return (
    <CommandDialog
      open={note !== null}
      onOpenChange={onOpenChange}
      title="Move to"
      description="Choose where this note goes."
    >
      <CommandInput placeholder={`Move “${displayTitle(note?.title ?? "")}” to…`} />
      <CommandList>
        <CommandEmpty>No page matches.</CommandEmpty>
        <CommandGroup heading="Sections">
          <CommandItem
            value="section:inbox Inbox"
            onSelect={() => pick({ kind: "section", section: "inbox" })}
          >
            <Inbox aria-hidden />
            Inbox
          </CommandItem>
          <CommandItem
            value="section:pages Pages"
            onSelect={() => pick({ kind: "section", section: "pages" })}
          >
            <FolderOpen aria-hidden />
            Pages (top level)
          </CommandItem>
        </CommandGroup>
        {pages.length > 0 ? (
          <CommandGroup heading="Nest under">
            {pages.map((d) => (
              <CommandItem
                key={d.key}
                value={`note:${d.key} ${d.label}`}
                onSelect={() => pick(d.target)}
              >
                <FileText aria-hidden />
                <span
                  className="truncate ps-[calc(var(--tree-depth)*var(--tree-indent))]"
                  style={{ "--tree-depth": d.depth } as CSSProperties}
                >
                  {d.label}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
