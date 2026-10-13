// The seam Chat fills in Home's Team widget (TV-H1, Chat's CH70): one "Team"
// widget, where each person's row carries Chat's "now" line (Active ·
// Focusing · Away · a saved status such as "On vacation until Oct 20") above
// Tasks' load. Tasks draws the row and leaves this slot; Chat registers the
// component that draws the line. Until one is registered, the row shows the
// load only.
//
// A component rather than data, so Chat keeps its own reads and live updates
// (presence, saved statuses, the "focusing now" read of CH42/CH47) and the
// widget never learns more about a person than the line itself says. It
// renders nothing for someone with nothing to say.

import type { ComponentType } from "react";

export type TeamNowLineProps = {
  workspaceId: string;
  userId: string;
  /** The widget's size: S is one tight line, M and L have room. */
  size: "S" | "M" | "L" | "XL";
};

let line: ComponentType<TeamNowLineProps> | null = null;

/** Chat's block registers its "now" line here (null takes it back). */
export function registerTeamNowLine(component: ComponentType<TeamNowLineProps> | null): void {
  line = component;
}

/** The registered "now" line, if any. */
export function teamNowLine(): ComponentType<TeamNowLineProps> | null {
  return line;
}
