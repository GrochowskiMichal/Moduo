// The projects a row or a card can move its task to (TV-D11b). A workspace
// can have hundreds; handing the list to every row as a prop redrew every row
// whenever a project was added, renamed or archived (about 5 s with 224
// projects, found in TV-U6). The view provides the list here, and only an
// open "Move to project" menu reads it, so a change to the list redraws that
// menu and no row.

import { Inbox } from "lucide-react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { ContextMenuRadioItem } from "../../../components/ui/context-menu";
import { DropdownMenuRadioItem } from "../../../components/ui/dropdown-menu";

type ProjectChoice = { id: string; name: string; isSystem: boolean };

const ProjectChoicesContext = createContext<readonly ProjectChoice[]>([]);

/** The Inbox first, then the projects in the rail's order. */
export function ProjectChoicesProvider({
  projects,
  inboxId,
  children,
}: {
  projects: readonly ProjectChoice[];
  inboxId: string | null;
  children: ReactNode;
}) {
  const choices = useMemo(
    () =>
      inboxId
        ? [
            { id: inboxId, name: "Inbox", isSystem: true },
            ...projects.filter((p) => p.id !== inboxId),
          ]
        : projects,
    [projects, inboxId],
  );
  return (
    <ProjectChoicesContext.Provider value={choices}>{children}</ProjectChoicesContext.Provider>
  );
}

/** The choices as a dropdown's radio items (the row's project menu). */
export function ProjectMenuItems() {
  const choices = useContext(ProjectChoicesContext);
  return choices.map((p) => (
    <DropdownMenuRadioItem key={p.id} value={p.id}>
      {p.isSystem ? <Inbox aria-hidden /> : null}
      <span className="truncate">{p.name}</span>
    </DropdownMenuRadioItem>
  ));
}

/** The choices as a context menu's radio items (the card's "Move to project"). */
export function ProjectContextMenuItems() {
  const choices = useContext(ProjectChoicesContext);
  return choices.map((p) => (
    <ContextMenuRadioItem key={p.id} value={p.id}>
      {p.isSystem ? "Inbox" : p.name}
    </ContextMenuRadioItem>
  ));
}
