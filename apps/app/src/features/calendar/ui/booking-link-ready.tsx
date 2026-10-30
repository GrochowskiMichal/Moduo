// The step after Create link: the new link's address with Copy, ready to share,
// instead of the dialog just closing. Edit link goes back to the editor.

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";

export type CreatedLink = {
  name: string;
  /** The full public URL. */
  url: string;
  /** "30 min · Google Meet". */
  summary: string;
  /** Why guests can't book yet (a video login is missing), or null when they can. */
  blocker: string | null;
};

export function BookingLinkReady({
  link,
  onEdit,
  onDone,
}: {
  link: CreatedLink;
  onEdit: () => void;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const address = link.url.replace(/^https?:\/\//, "");
  return (
    <div className="flex flex-col items-center gap-5 px-6 pt-10 pb-6 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-state-active text-foreground">
        <Check aria-hidden className="size-icon" />
      </span>
      <div className="flex flex-col gap-1">
        <DialogTitle className="font-display text-lg text-foreground">
          {link.name} is ready to share
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {link.summary}
        </DialogDescription>
      </div>
      <div className="flex w-full max-w-md items-center gap-2 rounded-md border border-border bg-background py-1 pr-1 pl-3">
        <span
          className="min-w-0 flex-1 truncate text-left text-sm text-foreground"
          title={link.url}
        >
          {address}
        </span>
        <Button
          type="button"
          size="sm"
          disabled={link.blocker !== null}
          onClick={() => {
            void navigator.clipboard.writeText(link.url).then(() => setCopied(true));
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </Button>
      </div>
      {link.blocker ? <p className="text-sm text-warning">{link.blocker}</p> : null}
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
          Edit link
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
