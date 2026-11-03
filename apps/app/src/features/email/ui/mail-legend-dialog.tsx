// The `?` legend, generated from the hotkey registry (AC42).

import { Fragment } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { isMacPlatform } from "@/lib/hotkeys/use-app-hotkeys";

import { mailLegend } from "../keys";

export function MailLegendDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const groups = mailLegend(isMacPlatform());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Mail keys</DialogTitle>
          <DialogDescription>Triage without the mouse.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {groups.map((g) => (
            <section key={g.title} aria-label={g.title} className="flex flex-col gap-1.5">
              <h3 className="text-xs font-medium text-muted-foreground">{g.title}</h3>
              <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
                {g.entries.map((e) => (
                  <Fragment key={e.id}>
                    <dt>
                      <Kbd>{e.keys.join(" / ")}</Kbd>
                    </dt>
                    <dd className="text-sm text-foreground">{e.label}</dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
