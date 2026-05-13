import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CalendarDays,
  FileText,
  GitBranch,
  Inbox,
  LayoutGrid,
  ListTodo,
  PenTool,
  Settings as SettingsIcon,
} from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "../ui/command";

type Action = {
  id: string;
  label: string;
  hint?: string;
  icon: typeof FileText;
  shortcut?: string;
  run: () => void;
};

const PALETTE_OPEN_EVENT = "moduo:palette:open";

export function dispatchOpenPalette() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(PALETTE_OPEN_EVENT));
}

export function GlobalCommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => setOpen(true);
    window.addEventListener(PALETTE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(PALETTE_OPEN_EVENT, onOpen);
  }, []);

  const go = useCallback(
    (to: string) => () => {
      setOpen(false);
      void navigate({ to });
    },
    [navigate],
  );

  const navActions: Action[] = [
    { id: "notes", label: "Open Notes", icon: FileText, run: go("/notes") },
    { id: "grid", label: "Open Grid", icon: LayoutGrid, run: go("/grid") },
    { id: "ground", label: "Open Ground", icon: ListTodo, run: go("/ground") },
    { id: "mindmap", label: "Open Mindmap", icon: GitBranch, run: go("/mindmap") },
    { id: "email", label: "Open Email", icon: Inbox, run: go("/email") },
    { id: "brainstorm", label: "Open Brainstorm", icon: PenTool, run: go("/brainstorm") },
    { id: "calendar", label: "Open Calendar", icon: CalendarDays, run: go("/calendar") },
  ];

  const settingsActions: Action[] = [
    {
      id: "settings",
      label: "Settings",
      icon: SettingsIcon,
      shortcut: "⌘,",
      run: go("/settings"),
    },
  ];

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="max-w-xl">
      <CommandInput placeholder="Search workspaces, pages, or actions…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          {navActions.map(({ id, label, icon: Icon, run }) => (
            <CommandItem key={id} onSelect={run}>
              <Icon />
              <span>{label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Workspace">
          {settingsActions.map(({ id, label, icon: Icon, shortcut, run }) => (
            <CommandItem key={id} onSelect={run}>
              <Icon />
              <span>{label}</span>
              {shortcut ? <CommandShortcut>{shortcut}</CommandShortcut> : null}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
