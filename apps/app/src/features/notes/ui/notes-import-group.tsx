// Settings → Workspace → Import: the notes Markdown import, moved off the
// notes sidebar footer. Same wizard; the open Notes page reloads its tree on
// NOTES_IMPORTED_EVENT.

import { Import } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getRuntime } from "@/lib/runtime";

import { NOTES_IMPORTED_EVENT } from "../import";
import { NoteImportDialog } from "./note-import-dialog";

export function NotesImportGroup({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Bring in Markdown files or a Notion export (.zip) as notes.
      </p>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Import aria-hidden />
        Import notes
      </Button>
      <NoteImportDialog
        runtime={getRuntime()}
        workspaceId={workspaceId}
        open={open}
        onOpenChange={setOpen}
        onImported={() => window.dispatchEvent(new Event(NOTES_IMPORTED_EVENT))}
      />
    </div>
  );
}
