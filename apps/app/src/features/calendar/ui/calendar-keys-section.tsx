// Calendar's keys in the keys sheet (CALR-4): grouped by where they work,
// read from the registry through keys-sheet.ts.

import { Fragment } from "react";

import { Kbd } from "../../../components/ui/kbd";
import { isMacPlatform } from "../../../lib/hotkeys";
import { type CalendarKeyGroup, calendarKeyRows } from "../keys-sheet";

export function CalendarKeysSection() {
  const groups = new Map<CalendarKeyGroup, ReturnType<typeof calendarKeyRows>>();
  for (const row of calendarKeyRows(isMacPlatform())) {
    groups.set(row.group, [...(groups.get(row.group) ?? []), row]);
  }
  return (
    <section aria-label="Calendar" className="flex flex-col gap-2" data-shortcuts-calendar="">
      <h3 className="font-display text-sm text-foreground">Calendar</h3>
      {[...groups.entries()].map(([group, rows]) => (
        <div key={group} className="flex flex-col gap-1.5">
          <h4 className="text-xs text-muted-foreground">{group}</h4>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1.5">
            {rows.map((row) => (
              <Fragment key={row.desc}>
                <dt className="flex flex-wrap items-center gap-1">
                  {row.keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </dt>
                <dd className="text-sm text-muted-foreground">{row.desc}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Single keys work when no field has focus.</p>
    </section>
  );
}
