// Details' "Linked to" (chat-v2 §8, §12; prototype round 5 frame 4; CV-13):
// the linked project or client as RF-1's live card (its tombstone when it is
// archived or deleted), a team as its name; "Link to…" (a project, client or
// team) and Unlink for people who can post here. Linking a team offers once
// "Add the team's 4 people?", never kept in sync (CH57). The server decides:
// a refusal comes back as its own words.

import { Link2, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import { useMentionSearch } from "../../spine/hooks/use-mention-search";
import type { MentionCandidate, MentionTeamCandidate } from "../../spine/mention";
import { Reference } from "../../spine/references/ui/reference";
import { MentionPicker } from "../../spine/ui/mention-picker";
import type { Team, TeamMember } from "../../tasks/model";
import {
  LINK_SEARCH_TYPES,
  linkFromCandidate,
  linkReferenceType,
  teamOffer,
  teamOfferQuestion,
} from "../linking";
import type { ChatChannel, ChatLink } from "../model";

type Teams = { teams: Team[]; members: TeamMember[] };

/**
 * The workspace's teams and their people, read while shown; read again when
 * `refresh` changes (the linked team, so a team made since is found).
 */
function useTeams(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  enabled: boolean,
  refresh: string | null = null,
) {
  const [teams, setTeams] = useState<Teams | null>(null);
  useEffect(() => {
    if (!enabled || !runtime?.tasks.listTeams || !workspaceId) return;
    let live = true;
    void runtime.tasks
      .listTeams(workspaceId)
      .then((t) => {
        if (live) setTeams(t);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [runtime, workspaceId, enabled, refresh]);
  return teams;
}

/** The "Link to…" picker: projects and clients from the search, teams from their list. */
export function ChatLinkPicker({
  runtime,
  workspaceId,
  trigger,
  onPick,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  trigger: React.ReactNode;
  onPick: (link: ChatLink, label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const search = useMentionSearch({
    runtime,
    workspaceId,
    trigger: "ref",
    types: [...LINK_SEARCH_TYPES],
    includeProjects: true,
    includePeople: false,
    enabled: open,
  });
  const teams = useTeams(runtime, workspaceId, open);
  const candidates = useMemo<MentionCandidate[]>(() => {
    const q = search.query.trim().toLowerCase();
    const found = search.candidates.filter((c) => linkFromCandidate(c) !== null);
    const teamRows: MentionTeamCandidate[] = (teams?.teams ?? [])
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .slice(0, 4)
      .map((t) => ({ kind: "team", teamId: t.id, label: t.name, letters: t.mark, color: t.color }));
    return [...found, ...teamRows];
  }, [search.candidates, search.query, teams]);

  return (
    <MentionPicker
      open={open}
      onOpenChange={setOpen}
      trigger={trigger}
      candidates={candidates}
      query={search.query}
      onQueryChange={search.setQuery}
      loading={search.loading}
      placeholder="Link to a project, client or team…"
      emptyLabel="Nothing found"
      onSelect={(c) => {
        const link = linkFromCandidate(c);
        if (!link) return;
        setOpen(false);
        onPick(link, "label" in c ? c.label : "");
      }}
    />
  );
}

export type ChannelLinkSectionProps = {
  channel: ChatChannel;
  runtime: ModuoRuntime | null;
  /** In the conversation, able to post, not archived: may link and unlink. */
  canLink: boolean;
  /** May add people (the team offer): public channels for posters, private for managers. */
  canAddPeople: boolean;
  /** Everyone in the conversation now. */
  memberIds: ReadonlySet<string>;
  onLink: (link: ChatLink | null) => Promise<unknown>;
  onAddPeople: (userIds: string[]) => Promise<unknown>;
};

export function ChannelLinkSection({
  channel,
  runtime,
  canLink,
  canAddPeople,
  memberIds,
  onLink,
  onAddPeople,
}: ChannelLinkSectionProps) {
  const link = channel.link ?? null;
  const [busy, setBusy] = useState(false);
  const teams = useTeams(
    runtime,
    channel.workspaceId,
    link?.type === "team",
    link?.type === "team" ? link.id : null,
  );
  /** The once-only offer after linking a team: the people to add. */
  const [offer, setOffer] = useState<string[] | null>(null);

  const run = async (next: ChatLink | null, fail: string) => {
    setBusy(true);
    setOffer(null);
    try {
      await onLink(next);
      if (next?.type === "team" && canAddPeople && runtime?.tasks.listTeams) {
        const t = await runtime.tasks.listTeams(channel.workspaceId).catch(() => null);
        const ids = teamOffer(
          (t?.members ?? []).filter((m) => m.teamId === next.id).map((m) => m.userId),
          memberIds,
        );
        if (ids.length > 0) setOffer(ids);
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : fail);
    } finally {
      setBusy(false);
    }
  };

  const picker = (label: string) => (
    <ChatLinkPicker
      runtime={runtime}
      workspaceId={channel.workspaceId}
      onPick={(next) => void run(next, "Couldn't link the conversation.")}
      trigger={
        <Button type="button" variant="ghost" size="sm" disabled={busy} data-slot="link-to">
          <Link2 className="size-icon-sm" aria-hidden />
          {label}
        </Button>
      }
    />
  );

  return (
    <div data-slot="details-link" className="flex flex-col gap-1">
      {link ? (
        <LinkedItem link={link} teams={teams} />
      ) : (
        <p className="px-2 text-sm text-subtle-foreground">
          Not linked to a project, client or team yet.
        </p>
      )}
      {offer ? (
        <div
          data-slot="team-offer"
          className="flex flex-wrap items-center gap-2 rounded-md bg-surface-sunken px-2 py-1.5 text-sm"
        >
          <span className="min-w-0 flex-1 text-muted-foreground">
            {teamOfferQuestion(offer.length)}
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              const ids = offer;
              setOffer(null);
              void onAddPeople(ids).catch((e: unknown) =>
                toast.error(e instanceof Error && e.message ? e.message : "Couldn't add them."),
              );
            }}
          >
            Add
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOffer(null)}>
            Not now
          </Button>
        </div>
      ) : null}
      {canLink ? (
        <div className="flex items-center gap-1 px-1">
          {picker(link ? "Change" : "Link to…")}
          {link ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void run(null, "Couldn't unlink the conversation.")}
            >
              Unlink
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The toolbar's chip for the linked item (frame 7): RF-1's live chip, its
 *  tombstone when the item is archived or deleted; a team as its name. */
export function LinkChip({
  channel,
  runtime,
}: {
  channel: ChatChannel;
  runtime: ModuoRuntime | null;
}) {
  const link = channel.link ?? null;
  const teams = useTeams(
    runtime,
    channel.workspaceId,
    link?.type === "team",
    link?.type === "team" ? link.id : null,
  );
  if (!link) return null;
  const refType = linkReferenceType(link);
  if (refType) {
    return (
      <span data-slot="link-chip" className="min-w-0 shrink">
        <Reference type={refType} id={link.id} display="chip" className="min-w-0 shrink" />
      </span>
    );
  }
  const team = teams?.teams.find((t) => t.id === link.id) ?? null;
  if (!team) return null;
  return (
    <span
      data-slot="link-chip"
      className="inline-flex min-w-0 shrink items-center gap-1 text-xs text-muted-foreground"
    >
      <Users className="size-icon-xs shrink-0" aria-hidden />
      <span className="truncate">{team.name}</span>
    </span>
  );
}

function LinkedItem({ link, teams }: { link: ChatLink; teams: Teams | null }) {
  const refType = linkReferenceType(link);
  if (refType) {
    return (
      <div className="px-1">
        <Reference type={refType} id={link.id} display="card" />
      </div>
    );
  }
  const team = teams?.teams.find((t) => t.id === link.id) ?? null;
  const count = teams ? teams.members.filter((m) => m.teamId === link.id).length : null;
  return (
    <div className={cn("flex min-w-0 items-center gap-2 px-2 text-sm")} data-slot="linked-team">
      <Users className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
      <span className={cn("truncate", team ? "text-foreground" : "text-subtle-foreground")}>
        {teams === null ? "Team" : team ? team.name : "Deleted team"}
      </span>
      {team && count !== null ? (
        <span className="shrink-0 text-xs text-subtle-foreground">
          {count === 1 ? "1 person" : `${count} people`}
        </span>
      ) : null}
    </div>
  );
}
