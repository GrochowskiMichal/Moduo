/**
 * /notes — a thin switch between the classic page and the refreshed New Notes
 * shell (specs/notes-refresh.md NR-2, AC1). The choice is a synced user
 * preference; both UIs read and write the same notes.
 */

import { useNotesExperience } from "../../features/notes/experience";
import { NotesShell } from "../../features/notes/shell/notes-shell";
import { NotesClassicPage } from "./notes-classic-page";

export function NotesPage() {
  const [experience] = useNotesExperience();
  return experience === "next" ? <NotesShell /> : <NotesClassicPage />;
}
