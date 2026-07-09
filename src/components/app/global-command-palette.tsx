import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  FilePlus2,
  Calendar as CalendarIcon,
  CheckSquare,
  Contact as ContactIcon,
  FileText,
  GitBranch,
  House,
  Inbox,
  Settings as SettingsIcon,
  Upload,
  UserPlus,
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
import { onShortcut, SHORTCUTS, formatShortcut } from "../../lib/shortcuts";
import { dispatchOpenSettings } from "../../features/settings/settings-events";

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

  useEffect(() => onShortcut("palette", () => setOpen((prev) => !prev)), []);

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

  const settingsShortcut = SHORTCUTS.find((s) => s.id === "settings");
  const settingsLabel = settingsShortcut ? formatShortcut(settingsShortcut) : "";
  const newNoteShortcut = SHORTCUTS.find((s) => s.id === "new-note");
  const newNoteLabel = newNoteShortcut ? formatShortcut(newNoteShortcut) : "";

  const navActions: Action[] = [
    { id: "home", label: "Open Home", icon: House, run: go("/") },
    { id: "notes", label: "Open Notes", icon: FileText, run: go("/notes") },
    { id: "tasks", label: "Open Tasks", icon: CheckSquare, run: go("/tasks") },
    { id: "calendar", label: "Open Calendar", icon: CalendarIcon, run: go("/calendar") },
    { id: "mindmap", label: "Open Mindmap", icon: GitBranch, run: go("/mindmap") },
    { id: "email", label: "Open Email", icon: Inbox, run: go("/email") },
    { id: "contacts", label: "Open Contacts", icon: ContactIcon, run: go("/contacts") },
  ];

  // Notes capture works from any page (Wave-3 AC1): same `action` pattern.
  const notesActions: Action[] = [
    {
      id: "new-note",
      label: "New note",
      icon: FilePlus2,
      shortcut: newNoteLabel,
      run: () => {
        setOpen(false);
        void navigate({ to: "/notes", search: (prev) => ({ ...prev, action: "new" as const }) });
      },
    },
  ];

  // Contacts actions work from any page: navigate carrying an `action` search
  // param; the contacts page opens the dialog and clears the param (FX-1 AC2).
  const contactsActions: Action[] = [
    {
      id: "new-contact",
      label: "New contact",
      icon: UserPlus,
      run: () => {
        setOpen(false);
        // Functional updater — an object literal would REPLACE the whole
        // search and wipe an existing ?type&id selection on /contacts.
        void navigate({ to: "/contacts", search: (prev) => ({ ...prev, action: "new" as const }) });
      },
    },
    {
      id: "import-contacts",
      label: "Import contacts",
      icon: Upload,
      run: () => {
        setOpen(false);
        void navigate({ to: "/contacts", search: (prev) => ({ ...prev, action: "import" as const }) });
      },
    },
  ];

  const settingsActions: Action[] = [
    {
      id: "settings",
      label: "Settings",
      icon: SettingsIcon,
      shortcut: settingsLabel,
      run: () => {
        setOpen(false);
        dispatchOpenSettings();
      },
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
        <CommandGroup heading="Notes">
          {notesActions.map(({ id, label, icon: Icon, shortcut, run }) => (
            <CommandItem key={id} onSelect={run}>
              <Icon />
              <span>{label}</span>
              {shortcut ? <CommandShortcut>{shortcut}</CommandShortcut> : null}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Contacts">
          {contactsActions.map(({ id, label, icon: Icon, run }) => (
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
