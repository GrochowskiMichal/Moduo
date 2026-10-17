// A channel's link (chat-v2 §8, CH56, CH57; CV-13): at most one project
// (`bucket`), client (company or contact) or team. The server decides who may
// link (people in the conversation who can post, with edit rights on the item)
// and is the truth (chat_channels.linked_type/id); these are the app's pure
// helpers around it and the one read capture needs.

import { useEffect, useState } from "react";

import type { CaptureRequest } from "@/lib/capture-registry";
import type { MentionCandidate } from "../spine/mention";
import type { ChatChannel, ChatLink, ChatRuntime } from "./model";

/** The entity types the link picker searches (teams come from their own list). */
export const LINK_SEARCH_TYPES = ["company", "contact"] as const;

/** A picked candidate as a link, or null when it isn't something a channel links to. */
export function linkFromCandidate(c: MentionCandidate): ChatLink | null {
  if (c.kind === "team") return { type: "team", id: c.teamId };
  if (c.kind !== "entity") return null;
  const t = c.ref.type === "project" ? "bucket" : c.ref.type;
  if (t === "bucket" || t === "company" || t === "contact") return { type: t, id: c.ref.id };
  return null;
}

/** "project", "client" or "team": what the link is, in words. */
export function linkNoun(link: ChatLink): "project" | "client" | "team" {
  return link.type === "bucket" ? "project" : link.type === "team" ? "team" : "client";
}

/** The type RF-1's `Reference` draws for a link (a team has no reference kind). */
export function linkReferenceType(link: ChatLink): string | null {
  return link.type === "team" ? null : link.type;
}

/** Capture's destination for a message in this channel: its linked project when
 *  you may add to it (`filesHere`), else none (the Inbox). */
export function captureDestination(
  channel: Pick<ChatChannel, "link"> | null | undefined,
  filesHere: boolean,
): CaptureRequest["destination"] {
  const link = channel?.link;
  return link && link.type === "bucket" && filesHere ? { projectId: link.id } : undefined;
}

/** The people a team link offers to add: the team's, less those already in. */
export function teamOffer(
  teamUserIds: readonly string[],
  memberIds: ReadonlySet<string>,
): string[] {
  return [...new Set(teamUserIds)].filter((id) => !memberIds.has(id));
}

/** "Add the team's 4 people?" */
export function teamOfferQuestion(count: number): string {
  return count === 1 ? "Add the team's 1 person?" : `Add the team's ${count} people?`;
}

/** Whether capture from this channel files into its linked project for you. */
export function useLinkFilesHere(
  chat: Pick<ChatRuntime, "linkFilesHere"> | null,
  channel: Pick<ChatChannel, "id" | "link"> | null,
): boolean {
  const [state, setState] = useState<{ key: string; on: boolean } | null>(null);
  const link = channel?.link ?? null;
  const channelId = channel?.id ?? null;
  const key = channelId && link?.type === "bucket" ? `${channelId}:${link.id}` : null;
  useEffect(() => {
    if (!chat || !key || !channelId) return;
    let live = true;
    void chat
      .linkFilesHere(channelId)
      .then((on) => {
        if (live) setState({ key, on });
      })
      .catch(() => {
        if (live) setState({ key, on: false });
      });
    return () => {
      live = false;
    };
  }, [chat, key, channelId]);
  return !!key && state?.key === key && state.on;
}
