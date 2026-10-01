// The calendar left rail: mini-month navigator + the calendar list. The list is
// the account map (CAL-6, §3a): native Moduo first, then each connected account
// with its hue swatch + a visibility toggle. Hiding an account drops its
// mirrored events from the grid. "+ Connect calendar…" opens Integrations.

import { Eye, EyeOff, MoreHorizontal, Plus } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { LABEL_COLORS } from "../../../components/tag-colors";
import { Button } from "../../../components/ui/button";
import { Calendar } from "../../../components/ui/calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { IconButton } from "../../../components/ui/icon-button";
import { dispatchOpenSettings } from "../../settings/settings-events";
import { groupRailAccounts, providerLabel } from "../accounts";
import type { CalendarAccountModel } from "../events";
import { parseDayKey } from "../lens";
import type { CalendarPrefs } from "../prefs";

type Props = {
  /** Booking links, rendered under the calendar list. */
  footer?: ReactNode;
  /** The grid's anchor day (local day start). */
  anchor: Date;
  onSelectDate: (day: Date) => void;
  /** Local day keys carrying blocks — rendered as subtle density dots. */
  busyDayKeys: Set<string>;
  prefs: CalendarPrefs;
  /** Connected external accounts (mirrored) — the account map. */
  accounts: CalendarAccountModel[];
  /** Account id → bounded hue name. */
  accountHues: Record<string, string>;
  hiddenAccountIds: string[];
  onToggleAccountVisibility: (accountId: string) => void;
  onRecolorAccount: (accountId: string, hue: string) => void;
  onRemoveAccount: (accountId: string) => void;
  /** Repair a CalDAV account's password (password-only flow). */
  onReconnectAccount?: (account: CalendarAccountModel) => void;
};

// Subtle density dot under days that carry events/blocks (§3a).
const BUSY_DAY_CLASSES =
  "[&>button]:relative [&>button]:after:absolute [&>button]:after:bottom-0.5 " +
  "[&>button]:after:left-1/2 [&>button]:after:size-1 [&>button]:after:-translate-x-1/2 " +
  "[&>button]:after:rounded-full [&>button]:after:bg-muted-foreground/50 " +
  "[&>button]:after:content-['']";

export function CalendarRail({
  anchor,
  onSelectDate,
  busyDayKeys,
  prefs,
  accounts,
  accountHues,
  hiddenAccountIds,
  onToggleAccountVisibility,
  onRecolorAccount,
  onRemoveAccount,
  onReconnectAccount,
  footer,
}: Props) {
  const [month, setMonth] = useState<Date>(anchor);
  useEffect(() => {
    setMonth(anchor);
  }, [anchor]);

  const railGroups = useMemo(() => groupRailAccounts(accounts), [accounts]);

  const modifiers = useMemo(
    () => ({
      busy: [...busyDayKeys].map((key) => parseDayKey(key)).filter((d): d is Date => d !== null),
    }),
    [busyDayKeys],
  );
  const modifiersClassNames = useMemo(() => ({ busy: BUSY_DAY_CLASSES }), []);
  const hidden = useMemo(() => new Set(hiddenAccountIds), [hiddenAccountIds]);

  const renderAccountRow = (
    account: CalendarAccountModel,
    label: string,
    scope: "calendar" | "account" | "feed",
  ) => {
    const isHidden = hidden.has(account.id);
    const name = label || account.displayLabel || providerLabel(account.provider);
    const canReconnect = Boolean(
      onReconnectAccount && account.provider === "caldav" && account.status === "error",
    );
    return (
      <div
        key={account.id}
        className="group flex items-center gap-2 rounded-md px-1 hover:bg-accent/60"
        style={{ minHeight: "var(--row-h-sm)" }}
      >
        <span
          data-label={accountHues[account.id]}
          className="cal-swatch size-2.5 shrink-0 rounded-full data-[hidden=true]:opacity-30"
          data-hidden={isHidden}
          aria-hidden
        />
        <span
          className={
            "min-w-0 flex-1 truncate text-sm " +
            (isHidden ? "text-muted-foreground" : "text-foreground")
          }
          title={`${name} — ${providerLabel(account.provider)}`}
        >
          {name}
        </span>
        {account.status === "error" ? (
          canReconnect ? (
            <button
              type="button"
              className="shrink-0 text-2xs text-warning hover:underline"
              onClick={() => onReconnectAccount?.(account)}
            >
              Reconnect
            </button>
          ) : (
            <span className="shrink-0 text-2xs text-warning">Sync error</span>
          )
        ) : null}
        <IconButton
          icon={isHidden ? EyeOff : Eye}
          label={isHidden ? `Show ${name}` : `Hide ${name}`}
          className={isHidden ? undefined : "opacity-0 group-hover:opacity-100"}
          onClick={() => onToggleAccountVisibility(account.id)}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton
              icon={MoreHorizontal}
              label={`${name} options`}
              className="opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onToggleAccountVisibility(account.id)}>
              {isHidden ? "Show on calendar" : "Hide from calendar"}
            </DropdownMenuItem>
            {canReconnect ? (
              <DropdownMenuItem onSelect={() => onReconnectAccount?.(account)}>
                Reconnect…
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>Color</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {LABEL_COLORS.map((hue) => (
                  <DropdownMenuItem
                    key={hue}
                    onSelect={() => onRecolorAccount(account.id, hue)}
                    className="capitalize"
                  >
                    <span
                      data-label={hue}
                      className="cal-swatch size-2.5 rounded-full"
                      aria-hidden
                    />
                    {hue}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => onRemoveAccount(account.id)}>
              {scope === "feed"
                ? "Remove feed"
                : scope === "calendar"
                  ? "Remove calendar"
                  : "Remove account"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  return (
    <div className="scrollbar-thin flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
      <Calendar
        mode="single"
        selected={anchor}
        onSelect={(day) => {
          if (day) onSelectDate(day);
        }}
        month={month}
        onMonthChange={setMonth}
        weekStartsOn={prefs.weekStartsOn as 0 | 1 | 2 | 3 | 4 | 5 | 6}
        modifiers={modifiers}
        modifiersClassNames={modifiersClassNames}
        className="self-center p-0"
      />

      <div className="flex flex-col gap-1">
        <Eyebrow as="div" className="px-1">
          Calendars
        </Eyebrow>

        {/* Native Moduo — always on. */}
        <div
          className="flex items-center gap-2 rounded-md px-1"
          style={{ minHeight: "var(--row-h-sm)" }}
        >
          <span className="size-2.5 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">Moduo</span>
        </div>

        {/* Connected accounts. Google calendars are a two-way copy; CalDAV
            and ICS stay read-only mirrors. */}
        {railGroups.map((group) => {
          if (group.kind === "flat") {
            return renderAccountRow(group.row.account, group.row.label, group.row.scope);
          }
          return (
            <div key={group.key} className="mt-3 flex flex-col gap-1">
              <Eyebrow as="div" className="px-1" tone="muted">
                {group.header}
              </Eyebrow>
              {group.detail ? (
                <p className="truncate px-1 text-xs text-muted-foreground" title={group.detail}>
                  {group.detail}
                </p>
              ) : null}
              {group.rows.map((row) => renderAccountRow(row.account, row.label, row.scope))}
            </div>
          );
        })}

        <Button
          variant="ghost"
          size="sm"
          className="justify-start text-muted-foreground"
          onClick={() => dispatchOpenSettings({ section: "integrations" })}
        >
          <Plus aria-hidden />
          Connect calendar…
        </Button>
      </div>
      {footer}
    </div>
  );
}
