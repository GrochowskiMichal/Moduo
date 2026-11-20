// The read-mode details card: iOS-style grouped rows (emails, phones, links,
// addresses, dates, custom fields), click-to-act and click-to-copy. Only
// non-empty groups render; the card hides when the record has no details yet.

import { Cake, CalendarDays, Copy, Globe, Hash, Mail, MapPin, Phone } from "lucide-react";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { IconButton } from "@/components/ui/icon-button";
import { formatFullDate } from "@/lib/time-format";
import { cn } from "@/lib/utils";

import { birthdayCountdown } from "../dates";
import type { Contact, ContactChannel, ContactFieldDef } from "../model";

/** Copy to clipboard with the notes-module fallback for non-secure contexts. */
function copyText(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast("Copied", { description: text }),
      () => toast.error("Couldn’t copy"),
    );
    return;
  }
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    document.execCommand("copy");
    el.remove();
    toast("Copied", { description: text });
  } catch {
    toast.error("Couldn’t copy");
  }
}

type DetailRow = { label: string; value: ReactNode; wrap?: boolean; copy?: string };
type DetailGroup = { key: string; icon: typeof Mail; rows: DetailRow[] };

/** Multi-value channel → labelled rows; email/phone/url values act on click. */
function channelRows(
  rows: ContactChannel[],
  kind: "email" | "phone" | "url" | "address",
): DetailRow[] {
  const href = (v: string) =>
    kind === "email"
      ? `mailto:${v}`
      : kind === "phone"
        ? `tel:${v}`
        : kind === "url"
          ? v
          : undefined;
  return rows.map((r) => {
    const h = href(r.value);
    // Display URLs without the protocol noise; the href keeps it.
    const display =
      kind === "url" ? r.value.replace(/^https?:\/\//, "").replace(/\/$/, "") : r.value;
    return {
      label: r.label || kind,
      // Copy the raw value (email/phone/url); addresses have no one-tap channel.
      copy: kind === "address" ? undefined : r.value,
      value: h ? (
        <a
          href={h}
          target={kind === "url" ? "_blank" : undefined}
          rel={kind === "url" ? "noreferrer" : undefined}
          className="rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {display}
        </a>
      ) : (
        display
      ),
    };
  });
}

/** "1988-04-17" → "Apr 17, 1988" / "17 Apr 1988", Time & region's date order
 *  (TV-D14; falls back to the raw value). */
function formatDateValue(value: string): string {
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : formatFullDate(d);
}

/** One field group inside the card: a type icon on the first row, then rows.
 * Copyable rows (email/phone/url) reveal a copy button on hover/focus (R6). */
function DetailsGroup({ icon: Icon, rows }: { icon: typeof Mail; rows: DetailRow[] }) {
  return (
    <div className="px-3 py-2">
      {rows.map((r, i) => (
        <div
          key={i}
          className={cn(
            "group/row flex gap-3 py-1 text-sm",
            r.wrap ? "items-start" : "items-center",
          )}
        >
          <Icon
            className={cn(
              "size-icon-sm shrink-0 text-muted-foreground/70",
              r.wrap && "mt-0.5",
              i > 0 && "invisible",
            )}
            aria-hidden
          />
          <span className="w-16 shrink-0 truncate text-xs text-muted-foreground">{r.label}</span>
          <span
            className={cn("min-w-0 flex-1 text-foreground", r.wrap ? "break-words" : "truncate")}
          >
            {r.value}
          </span>
          {r.copy ? (
            // opacity-0 (not hidden) reserves the column so the value never shifts.
            <IconButton
              icon={Copy}
              label={`Copy ${r.label}`}
              size="sm"
              variant="ghost"
              className="-my-1 shrink-0 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100"
              onClick={() => copyText(r.copy!)}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** The groups to show for a contact (the non-empty ones, in card order). */
export function detailGroupsFor(
  contact: Contact,
  fieldDefs: ContactFieldDef[],
  now: Date,
): DetailGroup[] {
  const hasBirthday = contact.dates.some((d) => d.label.toLowerCase() === "birthday");
  const customRows: DetailRow[] = fieldDefs.flatMap((f) => {
    const v = contact.custom[f.key];
    const text = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    if (!text) return [];
    const value: ReactNode =
      f.type === "url" ? (
        <a
          key={f.key}
          href={text}
          target="_blank"
          rel="noreferrer"
          className="rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {text}
        </a>
      ) : (
        text
      );
    return [{ label: f.label, value }];
  });
  return [
    { key: "emails", icon: Mail, rows: channelRows(contact.emails, "email") },
    { key: "phones", icon: Phone, rows: channelRows(contact.phones, "phone") },
    { key: "urls", icon: Globe, rows: channelRows(contact.urls, "url") },
    { key: "addresses", icon: MapPin, rows: channelRows(contact.addresses, "address") },
    {
      key: "dates",
      icon: hasBirthday ? Cake : CalendarDays,
      rows: contact.dates.map((d) => {
        // A quiet "in 3 weeks" caption when the date recurs within 60 days (FX-4 AC7).
        const countdown = birthdayCountdown(d.value, now);
        return {
          label: d.label || "date",
          value: (
            <span className="inline-flex items-baseline gap-2">
              {formatDateValue(d.value)}
              {countdown ? (
                <span className="text-xs text-muted-foreground">{countdown}</span>
              ) : null}
            </span>
          ),
        };
      }),
    },
    { key: "custom", icon: Hash, rows: customRows },
  ].filter((g) => g.rows.length > 0);
}

/** The grouped card; nothing when no group has rows. */
export function ContactDetailsCard({ groups }: { groups: DetailGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-card">
      {groups.map((g) => (
        <DetailsGroup key={g.key} icon={g.icon} rows={g.rows} />
      ))}
    </div>
  );
}
