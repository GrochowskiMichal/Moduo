// The calendar left rail: mini-month navigator, then ONE Calendars section
// (CAL-6, §3a, rail redesign 2026-10-30): your Moduo calendar and the ones you
// made, each connected account under its login, and the teammates who share
// with you. A row's swatch shows or hides it; sharing, color and removal sit in
// its hover actions. ＋ adds a calendar; ⋯ holds working hours, saving what's
// shown as a view, and seeing your week as a teammate. Saved views are chips.

import { Check, Eye, Glasses, MoreHorizontal, Plus, UserPlus } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

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
import { Input } from "../../../components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "../../../components/ui/popover";
import { cn } from "../../../lib/utils";
import { ShareMenu } from "../../sharing/share-menu";
import { useWorkspace } from "../../workspaces/workspace-context";
import { groupRailAccounts, hiddenIdsForSet, providerLabel } from "../accounts";
import type { CalendarAccountModel } from "../events";
import { hueAttrs } from "../hue";
import { parseDayKey } from "../lens";
import type { CalendarPrefs } from "../prefs";
import { notSyncedLabel } from "../sync-status";
import { laneOwners, teammateHues } from "../teammates";
import { dispatchOpenCalendarAccounts } from "./calendar-accounts-events";
import { CalendarColorPicker } from "./calendar-color-picker";
import { saveShownTeammates, usePreviewBridge } from "./shared-with-you";
import { setTeammates, useTeammatesStore } from "./teammates-store";
import { type RailCalendarRow, useRailCalendars, visibleIdOf } from "./use-rail-calendars";
import { WorkingHoursSheet } from "./working-hours-sheet";

type Props = {
  workspaceId: string;
  userId: string;
  /** Booking links, rendered under the calendar list. */
  footer?: ReactNode;
  /** The grid's anchor day (local day start). */
  anchor: Date;
  onSelectDate: (day: Date) => void;
  /** Local day keys carrying blocks — rendered as subtle density dots. */
  busyDayKeys: Set<string>;
  prefs: CalendarPrefs;
  /** Working hours (CALR-13) in the ⋯ beside "Calendars"; absent, no item. */
  onPrefs?: (patch: Partial<CalendarPrefs>) => void;
  /** Connected external accounts (mirrored) — the account map. */
  accounts: CalendarAccountModel[];
  /** Account id → its hue (a label name or a custom hex). */
  accountHues: Record<string, string>;
  hiddenAccountIds: string[];
  onToggleAccountVisibility: (id: string) => void;
  /** Replace the hidden set wholesale (showing a saved view, or All). */
  onSetHidden: (hiddenIds: string[]) => void;
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

const ROW =
  "group/rail-row relative flex min-h-(--row-h-sm) items-center gap-2 rounded-md px-1 hover:bg-state-hover";
const ACTIONS =
  "flex shrink-0 items-center opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover/rail-row:opacity-100 group-focus-within/rail-row:opacity-100 has-[[data-state=open]]:opacity-100";
const SUBHEAD = "flex h-6 items-center gap-1.5 px-1 text-xs";

const CAL_LEVELS = [
  { id: "freebusy", label: "Busy only" },
  { id: "view", label: "Can view" },
  { id: "edit", label: "Can edit" },
] as const;

/** The swatch is the show/hide switch: filled with a check when shown, faint when hidden. */
function Swatch({
  hue,
  shown,
  label,
  onToggle,
}: {
  /** A label hue or custom hex; "primary" is your Moduo calendar's accent. */
  hue: string;
  shown: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={shown}
      aria-label={label}
      onClick={onToggle}
      {...(hue === "primary" ? {} : hueAttrs(hue))}
      className={cn(
        "grid size-3.5 shrink-0 place-items-center rounded-xs transition-opacity duration-(--motion-fade) ease-(--ease-out) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        hue === "primary" ? "bg-primary" : "cal-swatch",
        !shown && "opacity-30",
      )}
    >
      {shown ? <Check aria-hidden className="size-2.5 text-background" strokeWidth={4} /> : null}
    </button>
  );
}

function RowName({ name, shown, title }: { name: string; shown: boolean; title?: string }) {
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-sm",
        shown ? "text-foreground" : "text-muted-foreground",
      )}
      title={title ?? name}
    >
      {name}
    </span>
  );
}

export function CalendarRail({
  workspaceId,
  userId,
  anchor,
  onSelectDate,
  busyDayKeys,
  prefs,
  onPrefs,
  accounts,
  accountHues,
  hiddenAccountIds,
  onToggleAccountVisibility,
  onSetHidden,
  onRecolorAccount,
  onRemoveAccount,
  onReconnectAccount,
  footer,
}: Props) {
  const [month, setMonth] = useState<Date>(anchor);
  useEffect(() => {
    setMonth(anchor);
  }, [anchor]);

  const { members } = useWorkspace();
  const people = members
    .filter((m) => m.isActive && !m.removedAt)
    .map((m) => ({ userId: m.userId, name: m.displayName || "Teammate" }));
  const others = people.filter((p) => p.userId !== userId);
  const { rows, views, createCalendar, saveView } = useRailCalendars(workspaceId);
  const mine = rows.filter((r) => r.owner_id === userId);
  const moduoRow = mine.find((r) => r.kind === "moduo");
  const customRows = mine.filter((r) => r.kind === "custom");
  const rowOfAccount = (accountId: string) => mine.find((r) => r.account_id === accountId);

  // Sharing: one share menu open at a time, anchored to its row. Preview as's
  // "Change what … sees" opens it from the banner.
  const [shareId, setShareId] = useState<string | null>(null);
  usePreviewBridge(rows, userId, setShareId);
  const canShare = others.length > 0;

  const railGroups = useMemo(() => groupRailAccounts(accounts), [accounts]);
  const modifiers = useMemo(
    () => ({
      busy: [...busyDayKeys].map((key) => parseDayKey(key)).filter((d): d is Date => d !== null),
    }),
    [busyDayKeys],
  );
  const modifiersClassNames = useMemo(() => ({ busy: BUSY_DAY_CLASSES }), []);
  const hidden = useMemo(() => new Set(hiddenAccountIds), [hiddenAccountIds]);

  // Every id the rail shows or hides by, for views; the view whose hidden set is the current one.
  const knownIds = [...new Set([...accounts.map((a) => a.id), ...mine.map(visibleIdOf)])];
  const sameHidden = (ids: string[]) =>
    ids.length === hidden.size && ids.every((id) => hidden.has(id));
  const activeView =
    hidden.size === 0
      ? "all"
      : (views.find((v) => sameHidden(hiddenIdsForSet(v.visibleIds, knownIds)))?.id ?? null);

  // Inline name fields for a new calendar and a new view.
  const [naming, setNaming] = useState<"calendar" | "view" | null>(null);
  // A menu item that opens something taking focus does it once the menu has closed.
  const pending = useRef<(() => void) | null>(null);
  const runPending = (e: Event) => {
    const run = pending.current;
    if (!run) return;
    pending.current = null;
    e.preventDefault();
    run();
  };
  const [hoursOpen, setHoursOpen] = useState(false);

  // Teammates who share with you, and the hue their lane takes.
  const teammates = useTeammatesStore((s) => s.teammates);
  const shownTeammates = useTeammatesStore((s) => s.shown);
  const laneHues = teammateHues(
    laneOwners(
      shownTeammates.filter((id) => teammates.some((t) => t.userId === id)),
      [],
    ),
    Object.values(accountHues),
  );

  const shareMenuFor = (row: RailCalendarRow, name: string) =>
    shareId === row.id ? (
      <ShareMenu
        resourceType="calendar"
        resourceId={row.id}
        members={people}
        selfUserId={userId}
        levels={CAL_LEVELS}
        defaultLevel="freebusy"
        label={`Share ${name}`}
        anchor="parent"
        defaultOpen
        onOpenChange={(open) => {
          if (!open) setShareId(null);
        }}
      />
    ) : null;

  const nativeRow = (row: RailCalendarRow, name: string, hue: string) => {
    const id = visibleIdOf(row);
    const shown = !hidden.has(id);
    return (
      <div key={row.id} className={ROW}>
        <Swatch
          hue={hue}
          shown={shown}
          label={`Show ${name} on the calendar`}
          onToggle={() => onToggleAccountVisibility(id)}
        />
        <RowName name={name} shown={shown} />
        <div className={ACTIONS}>
          {canShare ? (
            <IconButton
              icon={UserPlus}
              label={`Share ${name}`}
              onClick={() => setShareId(row.id)}
            />
          ) : null}
        </div>
        {shareMenuFor(row, name)}
      </div>
    );
  };

  const accountRow = (
    account: CalendarAccountModel,
    label: string,
    scope: "calendar" | "account" | "feed",
  ) => (
    <AccountRow
      key={account.id}
      account={account}
      name={label || account.displayLabel || providerLabel(account.provider)}
      scope={scope}
      hue={accountHues[account.id] ?? "gray"}
      shown={!hidden.has(account.id)}
      onToggle={() => onToggleAccountVisibility(account.id)}
      onRecolor={(hue) => onRecolorAccount(account.id, hue)}
      onRemove={() => onRemoveAccount(account.id)}
      onReconnect={
        onReconnectAccount && account.provider === "caldav" && account.status === "error"
          ? () => onReconnectAccount(account)
          : undefined
      }
      share={(() => {
        const row = rowOfAccount(account.id);
        if (!row || !canShare) return undefined;
        return {
          open: () => setShareId(row.id),
          menu: shareMenuFor(row, label || account.displayLabel),
        };
      })()}
    />
  );

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

      <section aria-label="Calendars" className="flex flex-col gap-0.5">
        <div className="flex items-center gap-0.5 pl-1">
          <Eyebrow as="h2" className="flex-1">
            Calendars
          </Eyebrow>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={Plus} label="Add a calendar" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={runPending}>
              <DropdownMenuItem onSelect={() => (pending.current = () => setNaming("calendar"))}>
                New calendar…
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() =>
                  (pending.current = () => dispatchOpenCalendarAccounts({ connect: true }))
                }
              >
                Connect a calendar…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton icon={MoreHorizontal} label="Calendar options" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onCloseAutoFocus={runPending}>
              {onPrefs ? (
                <DropdownMenuItem onSelect={() => (pending.current = () => setHoursOpen(true))}>
                  Working hours…
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => (pending.current = () => setNaming("view"))}>
                Save what's shown as a view…
              </DropdownMenuItem>
              {others.length > 0 ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>See your week as</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {others.map((p) => (
                        <DropdownMenuItem
                          key={p.userId}
                          onSelect={() => setTeammates({ previewAs: p.userId })}
                        >
                          {p.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {views.length > 0 ? (
          <fieldset className="m-0 flex flex-wrap gap-1 border-0 px-1 pt-0.5 pb-1.5">
            <legend className="sr-only">Views</legend>
            {[{ id: "all", name: "All", visibleIds: null as string[] | null }, ...views].map(
              (view) => (
                <button
                  key={view.id}
                  type="button"
                  aria-pressed={activeView === view.id}
                  onClick={() =>
                    onSetHidden(view.visibleIds ? hiddenIdsForSet(view.visibleIds, knownIds) : [])
                  }
                  className={cn(
                    "h-(--ctrl-h-xs) rounded-sm border px-2 text-xs transition-colors duration-(--motion-fade) ease-(--ease-out) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    activeView === view.id
                      ? "border-transparent bg-state-active text-foreground"
                      : "border-border text-muted-foreground hover:bg-state-hover hover:text-foreground",
                  )}
                >
                  {view.name}
                </button>
              ),
            )}
          </fieldset>
        ) : null}
        {naming === "view" ? (
          <NameField
            label="Name this view"
            onDone={() => setNaming(null)}
            onSave={(name) =>
              saveView(
                name,
                mine.filter((r) => !hidden.has(visibleIdOf(r))).map((r) => r.id),
              )
            }
          />
        ) : null}

        {/* Yours: Moduo first, then the calendars you made. */}
        {moduoRow ? (
          nativeRow(moduoRow, "Moduo", "primary")
        ) : (
          <div className={ROW}>
            <span aria-hidden className="size-3.5 shrink-0 rounded-xs bg-primary" />
            <RowName name="Moduo" shown />
          </div>
        )}
        {customRows.map((row) => nativeRow(row, row.name, row.color || "gray"))}
        {naming === "calendar" ? (
          <NameField
            label="Name the new calendar"
            onDone={() => setNaming(null)}
            onSave={createCalendar}
          />
        ) : null}

        {/* Connected accounts. Google calendars are a two-way copy; CalDAV
            and ICS stay read-only mirrors. */}
        {railGroups.map((group) => {
          if (group.kind === "flat") {
            return accountRow(group.row.account, group.row.label, group.row.scope);
          }
          const reauth = group.rows.some((row) => row.account.status === "reauth");
          return (
            <div key={group.key} className="mt-2 flex flex-col gap-0.5">
              <div className={SUBHEAD}>
                <span className="shrink-0 font-medium text-muted-foreground">{group.header}</span>
                {group.detail ? (
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left text-muted-foreground hover:text-foreground hover:underline"
                    title={`${group.detail} · Calendar accounts`}
                    onClick={() => dispatchOpenCalendarAccounts({ login: group.key })}
                  >
                    {group.detail}
                  </button>
                ) : (
                  <span className="flex-1" />
                )}
                {reauth ? (
                  <button
                    type="button"
                    className="shrink-0 text-warning hover:underline"
                    onClick={() => dispatchOpenCalendarAccounts({ reconnect: group.detail })}
                  >
                    Reconnect
                  </button>
                ) : null}
              </div>
              {group.rows.map((row) => accountRow(row.account, row.label, row.scope))}
            </div>
          );
        })}

        {teammates.length > 0 ? (
          <div className="mt-2 flex flex-col gap-0.5">
            <div className={SUBHEAD}>
              <span className="font-medium text-muted-foreground">Teammates</span>
            </div>
            {teammates.map((t) => {
              const shown = shownTeammates.includes(t.userId);
              return (
                <div key={t.userId} className={ROW}>
                  <Swatch
                    hue={laneHues[t.userId] ?? "gray"}
                    shown={shown}
                    label={`Show ${t.name} beside your week`}
                    onToggle={() =>
                      saveShownTeammates(
                        userId,
                        workspaceId,
                        shown
                          ? shownTeammates.filter((id) => id !== t.userId)
                          : [...shownTeammates, t.userId],
                      )
                    }
                  />
                  <RowName name={t.name} shown={shown} />
                  <span
                    className="shrink-0 text-xs text-muted-foreground"
                    title={t.level === "view" ? "Shares all details" : "Shares busy times only"}
                  >
                    {t.level === "view" ? <Eye aria-hidden className="size-3.5" /> : "Busy"}
                  </span>
                  <div className={ACTIONS}>
                    <IconButton
                      icon={Glasses}
                      label={`See your week as ${t.name}`}
                      onClick={() => setTeammates({ previewAs: t.userId })}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
      {footer}
      {onPrefs ? (
        <WorkingHoursSheet
          open={hoursOpen}
          onOpenChange={setHoursOpen}
          prefs={prefs}
          onChange={onPrefs}
        />
      ) : null}
    </div>
  );
}

/** A connected calendar: swatch, name, sync trouble, and ⋯ (show, color, share, remove). */
function AccountRow({
  account,
  name,
  scope,
  hue,
  shown,
  onToggle,
  onRecolor,
  onRemove,
  onReconnect,
  share,
}: {
  account: CalendarAccountModel;
  name: string;
  scope: "calendar" | "account" | "feed";
  hue: string;
  shown: boolean;
  onToggle: () => void;
  onRecolor: (hue: string) => void;
  onRemove: () => void;
  onReconnect?: () => void;
  share?: { open: () => void; menu: ReactNode };
}) {
  const [colorOpen, setColorOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  return (
    <Popover open={colorOpen} onOpenChange={setColorOpen}>
      <PopoverAnchor asChild>
        <div className={ROW}>
          <Swatch
            hue={hue}
            shown={shown}
            label={`Show ${name} on the calendar`}
            onToggle={onToggle}
          />
          <RowName
            name={name}
            shown={shown}
            title={`${name} — ${providerLabel(account.provider)}`}
          />
          {account.status === "error" ? (
            onReconnect ? (
              <button
                type="button"
                className="shrink-0 text-2xs text-warning hover:underline"
                onClick={onReconnect}
              >
                Reconnect
              </button>
            ) : (
              <span className="shrink-0 text-2xs text-warning">{notSyncedLabel(account)}</span>
            )
          ) : null}
          <div className={ACTIONS}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton icon={MoreHorizontal} label={`${name} options`} />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(e) => {
                  const run = pending.current;
                  if (!run) return;
                  pending.current = null;
                  e.preventDefault();
                  run();
                }}
              >
                <DropdownMenuItem onSelect={onToggle}>
                  {shown ? "Hide from calendar" : "Show on calendar"}
                </DropdownMenuItem>
                {onReconnect ? (
                  <DropdownMenuItem onSelect={onReconnect}>Reconnect…</DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => (pending.current = () => setColorOpen(true))}>
                  <span aria-hidden {...hueAttrs(hue)} className="cal-swatch size-3 rounded-xs" />
                  Color…
                </DropdownMenuItem>
                {share ? (
                  <DropdownMenuItem onSelect={() => (pending.current = share.open)}>
                    Share…
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                  {scope === "feed"
                    ? "Remove feed"
                    : scope === "calendar"
                      ? "Remove calendar"
                      : "Remove account"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {share?.menu}
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" className="w-auto p-3">
        <p className="mb-2 truncate text-xs font-medium text-muted-foreground">{name} color</p>
        <CalendarColorPicker value={hue} name={name} onPick={onRecolor} />
      </PopoverContent>
    </Popover>
  );
}

/** A one-line name field that appears from a menu item: Enter saves, Esc or an empty blur cancels. */
function NameField({
  label,
  onSave,
  onDone,
}: {
  label: string;
  onSave: (name: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // A frame later: the menu that asked for the field is still closing (and
  // holding the rest of the page out of focus) when it mounts.
  useEffect(() => {
    const id = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <form
      className="flex items-center gap-1 px-1"
      onSubmit={(e) => {
        e.preventDefault();
        const name = ref.current?.value.trim();
        if (!name) return;
        void onSave(name).then((ok) => {
          if (ok) onDone();
        });
      }}
    >
      <Input
        ref={ref}
        size="sm"
        aria-label={label}
        placeholder={label}
        className="min-w-0 flex-1"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onDone();
          }
        }}
        onBlur={(e) => {
          if (!e.currentTarget.value.trim()) onDone();
        }}
      />
    </form>
  );
}
