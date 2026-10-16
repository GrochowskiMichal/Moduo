// The spine's activity-rendering vocabulary: one quiet, factual sentence per
// spine intent op (links / comments / contacts link ops), mirroring the Tasks
// trail (src/features/tasks/activity.ts) — a mirror, never a wall. AC4: every
// spine mutation logs an attributed `module_activity` row; this is how that row
// reads. Newest-first in the hub trail and the notification card.

import { normalizeChatMentionReason } from "@contracts/vocabularies";
import { isRelationKind, RELATION_KIND_LABELS } from "../../lib/entity-links";
import { dayShort, time24 } from "../calendar/booking/sentence";
import { parseStored, toExcerptText } from "../chat/markup-v2";
import { referenceTextToPlain } from "./references/text";
import type { ReferenceRef } from "./references/types";

/** The minimal shape an activity/notification row needs to render an actor. */
export type SpineActorFields = {
  actorType?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
};

/** Who did it — "You", the recorded display name, or a quiet fallback. */
export function spineActorName(
  entry: SpineActorFields & { op?: string; payload?: Record<string, unknown> | null },
  currentUserId: string | null,
): string {
  // A booking row records the host as its actor (booking_op_commit/release),
  // but the guest is who booked or canceled (TX-5, T16).
  if (entry.op === "calendar.booking_create" || entry.op === "calendar.booking_cancel") {
    const guest = str(entry.payload?.guest_name) ?? str(entry.payload?.guest);
    if (guest) return guest;
  }
  if (entry.actorId && currentUserId && entry.actorId === currentUserId) return "You";
  if (entry.actorLabel) return entry.actorLabel;
  if (entry.actorType === "agent") return "An agent";
  if (entry.actorType === "api_key") return "An API client";
  return "Someone";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
/** "Fri 16 Oct, 14:00" (or "Fri 16 Oct" without the time), on this device's clock. */
function meetingTime(value: unknown, withTime: boolean): string | null {
  const iso = str(value);
  const at = iso ? new Date(iso) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return withTime ? `${dayShort(at, zone)}, ${time24(at, zone)}` : dayShort(at, zone);
}

/** Bytes as gigabytes for a sentence: one decimal under 10 GB, whole above. */
const gigabytes = (bytes: number): string => {
  const gb = bytes / 1073741824;
  return gb < 10 ? (Math.round(gb * 10) / 10).toString() : Math.round(gb).toString();
};

/** Phrase a relation kind for an activity line ("works at", "a follow-up"…). */
function kindPhrase(kind: string | null): string {
  if (kind && isRelationKind(kind)) {
    return (RELATION_KIND_LABELS[kind] ?? kind).toLowerCase();
  }
  return "references";
}

/**
 * The action sentence (lowercase start — rendered after the actor name).
 * Unknown ops fall back to the raw op name so the trail never lies by omission
 * when a newer client adds ops.
 */
export function spineActivityLine(
  entry: {
    op: string;
    payload?: Record<string, unknown> | null;
  },
  opts: {
    /**
     * Names a reference stored in a comment's excerpt (`moduo://task/<id>`)
     * for this reader: its title, "Private item" or "Deleted task" (RF-1).
     * Without it a reference reads "a linked item", never a title.
     */
    referenceName?: (ref: ReferenceRef) => string;
  } = {},
): string {
  const p = entry.payload ?? {};
  // A comment's excerpt stores references, never titles; name them per reader.
  const excerptText = (v: unknown): string | null => {
    const s = str(v);
    return s ? referenceTextToPlain(s, opts.referenceName) : null;
  };
  switch (entry.op) {
    case "links.create":
    case "contacts.link": {
      const kind = str(p.relation_kind);
      if (kind === "follow-up") return "added a follow-up";
      if (kind === "attachment") return "attached this";
      if (kind === "works-at") return "linked a workplace";
      if (kind === "mentions") return "mentioned this";
      return kind && kind !== "references" ? `linked this (${kindPhrase(kind)})` : "linked this";
    }
    case "links.set_kind": {
      const to = str(p.to);
      return to ? `changed a link to ${kindPhrase(to)}` : "changed a link";
    }
    case "links.delete":
    case "contacts.unlink":
      return "removed a link";
    case "comments.add": {
      const excerpt = excerptText(p.excerpt);
      return excerpt ? `commented: “${excerpt}”` : "left a comment";
    }
    // ── Bookings (TX-5, T16): the host's bell. The actor shown is the guest
    // (spineActorName), so these read "Tom Becker booked Intro call · Fri 16 Oct, 14:00".
    case "calendar.booking_create": {
      const title = str(p.title) ?? "a meeting";
      const when = meetingTime(p.start, true);
      return when ? `booked ${title} · ${when}` : `booked ${title}`;
    }
    case "calendar.booking_cancel": {
      const title = str(p.title) ?? "a meeting";
      const when = meetingTime(p.start, false);
      return when ? `canceled ${title} · ${when}` : `canceled ${title}`;
    }
    // TV-D13: @Team in a comment; each member hears once.
    case "comments.team_mention": {
      const names = Array.isArray(p.team_names)
        ? p.team_names.filter((n): n is string => typeof n === "string" && n.length > 0)
        : [];
      const teams = names.length > 0 ? names.join(", ") : "your team";
      const excerpt = excerptText(p.excerpt);
      return excerpt ? `mentioned ${teams} on this: “${excerpt}”` : `mentioned ${teams} on this`;
    }
    // TV-U13: a comment edited (it notifies only someone newly named), deleted
    // and brought back by its Undo.
    case "comments.edit": {
      const excerpt = excerptText(p.excerpt);
      return excerpt ? `edited a comment: “${excerpt}”` : "edited a comment";
    }
    case "comments.delete":
      return "deleted a comment";
    case "comments.restore":
      return "brought back a comment";
    // ── Tasks notifications (DF-9) ────────────────────────────────────────────
    // Generated by the tasks_notify_spine trigger, not a client op. The card's
    // target is the affected task; the actor is the assigner / the person who
    // closed the last blocker.
    case "tasks.assigned": {
      // TV-D12: one person's assignments within an hour gather on one notice.
      const n = num(p.count) ?? 1;
      return n > 1 ? `assigned you ${n} tasks` : "assigned this to you";
    }
    // TV-D12: a reminder you set (written by Moduo, hung on your Inbox; the
    // task is in the payload).
    case "tasks.reminder":
      return "reminded you about this";
    // TV-D12: someone picked you with @ in a task's description.
    case "tasks.mentioned":
      return "mentioned you in this";
    // TV-D12: something you were waiting on came in, and the entry cleared.
    case "tasks.waiting_resolved":
      return str(p.reason) === "email"
        ? "got a reply on this · no longer waiting"
        : str(p.reason) === "agent"
          ? "reported back on this · no longer waiting"
          : "commented on this · no longer waiting";
    // TV-D16: an agent you started (the actor is the agent's name) changed
    // state; the card names the task.
    case "tasks.agent_status": {
      const state = str(p.state);
      if (state === "needs_you") return "needs you on this";
      if (state === "ready") return "is ready for review: this";
      if (state === "failed") return "failed on this";
      return "reported on this";
    }
    // TV-D1: a teammate finished a task you created.
    case "tasks.completed":
      return "completed this";
    // TV-D13: a task nobody has taken was routed to (or given back to) a team
    // you're in. Several from one person within the hour are one notice.
    case "tasks.routed": {
      const team = str(p.team_name) ?? "your team";
      const n = num(p.count) ?? 1;
      if (n > 1) return `routed ${n} tasks to ${team}`;
      return p.returned === true ? `gave this back to ${team}` : `routed this to ${team}`;
    }
    // TV-D13: a team task you created is still unclaimed (written by Moduo).
    case "tasks.team_check_back": {
      const team = str(p.team_name) ?? "the team";
      return str(p.reason) === "due"
        ? `checked: nobody in ${team} has taken this, and it's due tomorrow`
        : `checked: nobody in ${team} has taken this in 3 days`;
    }
    // TV-D13: someone left the workspace; tasks from their Inbox that you
    // created came back to yours (the card opens your Inbox).
    case "tasks.handed_back": {
      const name = str(p.name) ?? "someone";
      const n = num(p.count) ?? 1;
      const back = `${n > 1 ? `${n} of your tasks are` : "your task is"} back in your Inbox`;
      // Someone who left on their own is the actor here ("Sam left …").
      return p.left === true ? `left the workspace · ${back}` : `removed ${name} · ${back}`;
    }
    // TV-U6 (REPLAN 78): a project was deleted and its open work assigned to
    // you landed in your Inbox (the card's target). One notice per person; the
    // project is named only when you could see it.
    case "tasks.project_deleted": {
      const project = str(p.title);
      const n = num(p.count) ?? 0;
      const what = n > 1 ? `${n} of your tasks are` : "your task is";
      return `deleted ${project ? `“${project}”` : "a project"} · ${what} in your Inbox`;
    }
    // ── Storage alerts (AT-1): the owner's pool passed 80% / 95%. The actor is
    // whoever uploaded the file that crossed it.
    case "attachments.storage_80":
    case "attachments.storage_95": {
      const level = num(p.level) ?? (entry.op.endsWith("95") ? 95 : 80);
      const used = num(p.used_bytes);
      const total = num(p.total_bytes);
      const amounts =
        used !== null && total ? ` (${gigabytes(used)} of ${gigabytes(total)} GB)` : "";
      return `filled storage past ${level}%${amounts}`;
    }
    case "tasks.unblocked": {
      const blocker = str(p.blocker_title);
      return blocker ? `finished “${blocker}”, unblocking this` : "unblocked this";
    }
    // ── Email due (EM-6; generated by the desktop restore loop or the DF-21f web
    // sweep). Self-targeted — the actor is "You", so the verb completes "You …".
    case "email.snooze_due": {
      const subject = str(p.subject);
      return subject ? `have a snoozed email back: “${subject}”` : "have a snoozed email back";
    }
    case "email.follow_up_due": {
      const subject = str(p.subject);
      return subject ? `have a follow-up due: “${subject}”` : "have a follow-up due";
    }
    // ── Contacts module ops (logged under module='contacts') ──────────────────
    case "contacts.create":
      return "added this contact";
    case "contacts.update":
      return "updated this contact";
    case "contacts.delete":
      return "deleted this contact";
    case "contacts.restore":
      return "restored this contact";
    case "contacts.set_status": {
      const to = str(p.to);
      return to ? `set status to ${to}` : "changed the status";
    }
    case "contacts.import":
      return p.merged === true ? "updated this contact from an import" : "imported this contact";
    case "companies.create":
      return "added this company";
    case "companies.update":
      return "updated this company";
    // Chat's bell rows (specs/chat-v2.md §11, CV-5): @you, @Team, @channel, a
    // reply in a chain you're in, an announcement. The excerpt is the stored
    // form, so its references are named for this reader.
    case "chat.mention":
    case "chat.reply":
    case "chat.announcement": {
      const name = str(p.channel_name);
      const where = name ? `in #${name}` : "in a direct message";
      const reason = normalizeChatMentionReason(p.reason);
      const verb =
        entry.op === "chat.reply"
          ? "replied"
          : entry.op === "chat.announcement"
            ? "posted"
            : reason === "team"
              ? "mentioned your team"
              : reason === "everyone"
                ? "mentioned everyone"
                : "mentioned you";
      const excerpt =
        p.format_version === 2
          ? chatExcerptText(p.excerpt, opts.referenceName)
          : excerptText(p.excerpt);
      return excerpt ? `${verb} ${where}: “${excerpt}”` : `${verb} ${where}`;
    }
    case "chat.channel_create": {
      const name = str(p.name);
      return name ? `created #${name}` : "created a channel";
    }
    case "chat.channel_archive":
      return "archived this channel";
    case "chat.channel_unarchive":
      return "unarchived this channel";
    // Chat v2 conversation ops (CV-2b): ids only, so the lines name no one.
    case "chat.channel_rename":
      return "renamed this channel";
    case "chat.channel_topic":
      return "changed the topic";
    case "chat.join":
      return "joined this channel";
    case "chat.leave":
      return "left this channel";
    case "chat.member_add": {
      const n = Array.isArray(p.user_ids) ? p.user_ids.length : 0;
      return n === 1 ? "added someone" : n > 1 ? `added ${n} people` : "added people";
    }
    case "chat.member_remove":
      return "removed someone";
    // CV-13: ids only, so the line names the kind, not the item.
    case "chat.channel_link": {
      const t = str(p.linked_type);
      if (!t) return "unlinked this channel";
      const what = t === "bucket" ? "a project" : t === "team" ? "a team" : "a client";
      return `linked this channel to ${what}`;
    }
    // Lifecycle (CV-15): ids only.
    case "chat.manager_add":
      return "made someone a manager";
    case "chat.manager_remove":
      return "removed a manager";
    case "chat.announcement_switch":
      return p.on === false ? "let everyone post again" : "made this an announcement channel";
    case "chat.channel_private":
      return "made this channel private";
    case "chat.channel_delete":
      return "deleted this channel";
    case "chat.channel_restore":
      return "restored this channel";
    // A conversation's message changes (CV-8b, Details' history): ids only.
    case "chat.pin":
      return p.pinned === false ? "unpinned a message" : "pinned a message";
    case "chat.message_edit":
      return "edited a message";
    case "chat.message_delete":
      return "deleted a message";
    case "chat.message_restore":
      return "brought back a message";
    // Reply chains (CV-12): the toast's Undo reads as one, quietly.
    case "chat.wrap_up":
      return "wrapped up a reply chain";
    case "chat.reopen":
      return p.undo === true ? "undid a wrap-up" : "reopened a reply chain";
    // Move to… (CV-16): logged on the conversation the messages left.
    case "chat.move": {
      if (p.undo === true) return "undid a move";
      const n = typeof p.count === "number" ? p.count : 1;
      return n === 1 ? "moved a message out" : `moved ${n} messages out`;
    }
    case "chat.react":
      return p.on === false ? "took back a reaction" : "reacted to a message";
    default:
      return entry.op;
  }
}

/**
 * A chat excerpt in the stored form (`payload.format_version = 2`, CV-1) as
 * one line of words: marks dropped, references named for this reader (a
 * person by name, never `moduo://person/<id>`), CV-11. An excerpt the server
 * cut inside a reference loses that half reference.
 */
function chatExcerptText(
  value: unknown,
  referenceName: ((ref: ReferenceRef) => string) | undefined,
): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const cut = value.replace(/moduo:\/?\/?[a-z_-]*\/?[A-Za-z0-9-]*$/, (rest) =>
    /^moduo:\/\/[a-z][a-z_-]*\/[0-9a-fA-F-]{36}$/.test(rest) ? rest : "…",
  );
  const text = toExcerptText(parseStored(cut), (type, id) =>
    referenceName ? referenceName({ type, id }) : "a linked item",
  );
  return text || null;
}
