/**
 * B3–B5 · Workspace emails (specs/transactional-email.md TX-7, T20). Copy:
 * `.design/transactional-email/email-set.html` (B3–B5).
 *
 * - B3 `workspace_invite` → the invited address, queued by the
 *   `workspace_invites` insert trigger. From "<Inviter> via Moduo", replies go
 *   to the inviter. The link only works for that address (S1).
 * - B4 `workspace_owner` → the new owner, queued by
 *   `workspace_op_transfer_ownership`.
 * - B5 `workspace_removed` → the person removed, queued by
 *   `workspace_op_remove_member` (an owner or admin removing someone; leaving
 *   a workspace yourself is a direct delete and sends nothing).
 *
 * The names in these emails are typed by the inviter (their display name, the
 * workspace's name) and B3 goes to any address they choose, from our domain.
 * So a person's name only appears when it is a plain name (the booking
 * emails' allow-list), else their address does; a workspace name that looks
 * like a link or an address becomes "a workspace"; there is no message field.
 * With the 20-a-day cap (S2) that leaves nothing worth sending as spam.
 *
 * The payloads are written by SQL in snake_case (20261015090000_tx7_workspace_emails.sql)
 * and carry every date the email prints, so a retry renders the same body
 * (docs/gotchas/email.md). Dates are written in UTC: Moduo stores no zone for
 * the recipient, and these emails only name a day.
 */

import { CANONICAL_APP_ORIGIN, workspaceInviteUrl } from "../../app-origin.ts";
import { singleLine } from "../../escape.ts";
import { button, type EmailDoc, heading, lockup, muted, paragraph } from "../blocks.ts";
import { dayLong } from "../format.ts";
import type { QueuedEmail } from "../outbox.ts";
import { TEXT_LIMITS } from "../render.ts";
import { viaModuo } from "../send.ts";
import { isPlainName } from "./booking.ts";

/** Where B4's button goes: Settings → Workspace. */
export const WORKSPACE_SETTINGS_URL = `${CANONICAL_APP_ORIGIN}/settings?section=workspace`;

/** Someone acting on a workspace: the inviter, the previous owner, the person who removed you. */
export type WorkspacePerson = {
  /** Their display name; empty when they never set one. */
  name: string;
  email: string;
};

export type WorkspaceInviteData = {
  /** The invited address: the only one the invite works for. */
  email: string;
  workspaceName: string;
  inviter: WorkspacePerson;
  /** The role's name as Settings shows it ("Member", or a custom role's name). */
  roleName: string;
  /** The system role behind it (`admin` / `member` / `viewer`), null for a custom role. */
  roleKey: string | null;
  /** ISO time the invite stops working. */
  expiresAt: string;
  /** The invite token; the email links to `/join?invite=<token>`. */
  token: string;
};

export type WorkspaceOwnerData = {
  workspaceName: string;
  /** The person who handed the workspace over. */
  previousOwner: WorkspacePerson;
  /** ISO time of the transfer. */
  at: string;
};

export type WorkspaceRemovedData = {
  workspaceName: string;
  /** The owner or admin who removed them. */
  removedBy: WorkspacePerson;
  /** ISO time of the removal. */
  at: string;
};

const ZONE = "UTC";
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/;

const name = (value: string) => singleLine(value, TEXT_LIMITS.name);

/** A link, a domain or an address, in any dot (fullwidth and ideographic included). */
const LINK_LIKE = /https?:|\/\/|www[.\uFF0E\u3002]|[\p{L}\p{N}][.\uFF0E\u3002]\p{L}{2,}|[@\uFF20]/iu;

/** The person's name when it is a plain one that doesn't borrow ours, else null. */
function plainName(person: WorkspacePerson): string | null {
  if (!isPlainName(person.name) || /moduo/i.test(person.name)) return null;
  return name(person.name).replace(/\s+/g, " ").trim();
}

/** "Anna Carter", or their address when they have no plain name. */
function who(person: WorkspacePerson): string {
  return plainName(person) ?? singleLine(person.email, 254);
}

/** A typed label (workspace, role) when it is set and doesn't read like a link, else null. */
function linkFree(value: string): string | null {
  const label = name(value);
  return label && !LINK_LIKE.test(label) ? label : null;
}

function workspaceLabel(value: string): string {
  return linkFree(value) ?? "a workspace";
}

/** "15 October" */
function dayMonth(iso: string): string {
  return dayLong(new Date(iso), ZONE).split(" ").slice(1).join(" ");
}

/** "a member", "an admin"; a custom role keeps its own name. */
function asRole(data: WorkspaceInviteData): string {
  switch (data.roleKey) {
    case "admin":
      return "an admin";
    case "member":
      return "a member";
    case "viewer":
      return "a viewer";
    default:
      return linkFree(data.roleName) ?? "a member";
  }
}

// ── payloads ────────────────────────────────────────────────────────────────

function text(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value.trim() : "";
}

function address(payload: Record<string, unknown>, key: string, kind: string): string {
  const value = text(payload, key);
  if (!EMAIL_RE.test(value)) throw new Error(`${kind}: ${key} missing`);
  return value;
}

function isoTime(payload: Record<string, unknown>, key: string, kind: string): string {
  const value = text(payload, key);
  if (!value || Number.isNaN(Date.parse(value))) throw new Error(`${kind}: ${key} missing`);
  return value;
}

function required(payload: Record<string, unknown>, key: string, kind: string): string {
  const value = text(payload, key);
  if (!value) throw new Error(`${kind}: ${key} missing`);
  return value;
}

/** The payload a queued B3 row carries, checked. Throws on a shape the template can't render. */
export function parseWorkspaceInvitePayload(payload: Record<string, unknown>): WorkspaceInviteData {
  const kind = "workspace_invite";
  const roleKey = text(payload, "role_key");
  return {
    email: address(payload, "email", kind),
    workspaceName: required(payload, "workspace_name", kind),
    inviter: { name: text(payload, "inviter_name"), email: address(payload, "inviter_email", kind) },
    roleName: text(payload, "role_name"),
    roleKey: roleKey || null,
    expiresAt: isoTime(payload, "expires_at", kind),
    token: required(payload, "token", kind),
  };
}

export function parseWorkspaceOwnerPayload(payload: Record<string, unknown>): WorkspaceOwnerData {
  const kind = "workspace_owner";
  return {
    workspaceName: required(payload, "workspace_name", kind),
    previousOwner: { name: text(payload, "by_name"), email: address(payload, "by_email", kind) },
    at: isoTime(payload, "at", kind),
  };
}

export function parseWorkspaceRemovedPayload(payload: Record<string, unknown>): WorkspaceRemovedData {
  const kind = "workspace_removed";
  return {
    workspaceName: required(payload, "workspace_name", kind),
    removedBy: { name: text(payload, "by_name"), email: address(payload, "by_email", kind) },
    at: isoTime(payload, "at", kind),
  };
}

// ── templates ───────────────────────────────────────────────────────────────

/** B3 · Workspace invite. */
export function workspaceInviteEmail(data: WorkspaceInviteData): EmailDoc {
  const workspace = workspaceLabel(data.workspaceName);
  const inviter = who(data.inviter);
  const inviterLine = plainName(data.inviter) ? `${inviter} (${singleLine(data.inviter.email, 254)})` : inviter;
  const role = linkFree(data.roleName) ?? "Member";
  const until = dayMonth(data.expiresAt);
  return {
    subject: `${inviter} invited you to ${workspace}`,
    preheader: `Join as ${asRole(data)}. The invite works until ${until}.`,
    blocks: [
      { type: "workspace", name: workspace },
      heading(`Join ${workspace} on Moduo`),
      paragraph(`${inviterLine} invited you to their workspace in Moduo.`),
      {
        type: "rows",
        rows: [
          { label: "Role", value: role },
          { label: "Works until", value: dayLong(new Date(data.expiresAt), ZONE) },
        ],
      },
      button("Accept invite", workspaceInviteUrl(CANONICAL_APP_ORIGIN, data.token)),
      muted(
        `New to Moduo? Accepting sets up your account. Sign in with ${singleLine(data.email, 254)}, the address this invite was sent to.`,
      ),
      muted("Not expecting this? Ignore it and nothing happens."),
    ],
    footer: { reason: `You got this email because ${inviter} invited this address to a Moduo workspace.` },
  };
}

/** B4 · You're the owner now. */
export function workspaceOwnerEmail(data: WorkspaceOwnerData): EmailDoc {
  const workspace = workspaceLabel(data.workspaceName);
  const by = who(data.previousOwner);
  return {
    subject: `You're now the owner of ${workspace}`,
    preheader: `${by} handed the workspace over to you.`,
    blocks: [
      { type: "workspace", name: workspace },
      heading(`You own ${workspace} now`),
      paragraph(
        `${by} made you the owner of ${workspace} on ${dayMonth(data.at)}. You can now manage its members, roles and settings, and only you can delete it.`,
      ),
      // Seats follow the owner's plan (workspace_seat_cap), so they moved with it.
      paragraph("Its seats now come from your plan."),
      button("Open workspace settings", WORKSPACE_SETTINGS_URL),
    ],
    footer: { reason: "You got this email because ownership of a Moduo workspace moved to you." },
  };
}

/** B5 · Removed from a workspace. */
export function workspaceRemovedEmail(data: WorkspaceRemovedData): EmailDoc {
  const workspace = workspaceLabel(data.workspaceName);
  const by = who(data.removedBy);
  const ask = plainName(data.removedBy)?.split(" ")[0] ?? by;
  return {
    subject: `You no longer have access to ${workspace}`,
    preheader: "Your own workspaces and account aren't affected.",
    blocks: [
      lockup(),
      heading(`You've been removed from ${workspace}`),
      paragraph(
        `${by} removed you from ${workspace} on ${dayMonth(data.at)}. Your own workspaces and your account aren't affected.`,
      ),
      muted(`If you think this is a mistake, ask ${ask}.`),
    ],
    footer: { reason: `You got this email because you were a member of ${workspace} on Moduo.` },
  };
}

/** The workspace kinds the outbox worker sends. */
export const WORKSPACE_QUEUED: Record<
  "workspace_invite" | "workspace_owner" | "workspace_removed",
  (payload: Record<string, unknown>) => QueuedEmail
> = {
  workspace_invite: (payload) => {
    const data = parseWorkspaceInvitePayload(payload);
    // Sent on the inviter's behalf only under a plain name; anything else (an
    // address, a link, "Moduo Security") sends as Moduo.
    const inviter = plainName(data.inviter);
    return {
      doc: workspaceInviteEmail(data),
      fromName: inviter ? viaModuo(inviter) : "Moduo",
      replyTo: data.inviter.email,
    };
  },
  workspace_owner: (payload) => ({ doc: workspaceOwnerEmail(parseWorkspaceOwnerPayload(payload)) }),
  workspace_removed: (payload) => ({ doc: workspaceRemovedEmail(parseWorkspaceRemovedPayload(payload)) }),
};
