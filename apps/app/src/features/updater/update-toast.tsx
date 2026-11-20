// The desktop update toast (REL-4, AC9): "Moduo 1.2.0 is ready", the release's
// two highlights under the title, then Update & restart and See what's new.

import { toast } from "sonner";

import { openWhatsNew } from "../whats-new/whats-new-store";
import { manifestHighlights, releaseFromManifest } from "./manifest-notes";

export const UPDATE_TOAST_ID = "moduo-update";

export type UpdateNotes = { version: string; body: string | null; date: string | null };

export function UpdateHighlights({ highlights }: { highlights: string[] }) {
  if (!highlights.length) return null;
  return (
    <ul className="mt-0.5 flex list-disc flex-col gap-0.5 pl-4 text-xs text-muted-foreground">
      {highlights.map((text) => (
        <li key={text}>{text}</li>
      ))}
    </ul>
  );
}

/** Shows the toast; it stays until acted on. */
export function showUpdateToast(update: UpdateNotes, onUpdate: () => void): void {
  const highlights = manifestHighlights(update.body);
  const upcoming = releaseFromManifest(update);
  toast(`Moduo ${update.version} is ready`, {
    id: UPDATE_TOAST_ID,
    duration: Number.POSITIVE_INFINITY,
    description: highlights.length ? <UpdateHighlights highlights={highlights} /> : undefined,
    action: { label: "Update & restart", onClick: onUpdate },
    cancel: {
      label: "See what's new",
      onClick: () => (upcoming ? openWhatsNew({ upcoming }) : openWhatsNew()),
    },
  });
}
