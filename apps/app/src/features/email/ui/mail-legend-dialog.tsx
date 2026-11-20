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

import { mailLegend, type MailLegendGroup } from "../keys";

function LegendGroup({ group }: { group: MailLegendGroup }) {
  return (
    <section aria-label={group.title} className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted-foreground">{group.title}</h3>
      <dl className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
        {group.rows.map((row) => (
          <div key={row.label} className="col-span-2 grid grid-cols-subgrid items-center">
            <dt className="text-sm text-foreground">{row.label}</dt>
            <dd className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
              {row.keys.map((k, i) => (
                <Fragment key={k}>
                  {i > 0 && row.or ? " or " : null}
                  <Kbd>{k}</Kbd>
                </Fragment>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The `?` sheet (specs/mail-v3.md §7): three columns, Move, Act and Connect. */
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
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Mail keys</DialogTitle>
          <DialogDescription>Triage without the mouse.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-x-6">
          {([0, 1, 2] as const).map((column) => (
            <div key={column} className="flex flex-col gap-4">
              {groups
                .filter((g) => g.column === column)
                .map((g) => (
                  <LegendGroup key={g.title} group={g} />
                ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
