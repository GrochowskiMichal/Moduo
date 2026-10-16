import type { Meta, StoryObj } from "@storybook/react";

import {
  AppAvatar,
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
  PersonAvatar,
  PresenceBadge,
  type PresenceShape,
  TeamMark,
} from "./avatar";
import { AtThreeDensities } from "./kit-densities";

const meta: Meta<typeof Avatar> = {
  title: "Components/ui/avatar",
  component: Avatar,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const FallbackOnly: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      {/* Two initials at every size, the icon rung included (call 43). */}
      <Avatar size="icon">
        <AvatarFallback>EN</AvatarFallback>
      </Avatar>
      <Avatar size="sm">
        <AvatarFallback>EN</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>MJ</AvatarFallback>
      </Avatar>
      <Avatar size="lg">
        <AvatarFallback>AS</AvatarFallback>
      </Avatar>
    </div>
  ),
};

export const WithImage: Story = {
  render: () => (
    <Avatar>
      <AvatarImage
        src="https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=128&h=128&fit=crop"
        alt="User"
      />
      <AvatarFallback>U</AvatarFallback>
    </Avatar>
  ),
};

export const WithStatusBadge: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Avatar>
        <AvatarFallback>EN</AvatarFallback>
        <AvatarBadge className="bg-success" />
      </Avatar>
      <Avatar>
        <AvatarFallback>MJ</AvatarFallback>
        <AvatarBadge className="bg-warning" />
      </Avatar>
      <Avatar>
        <AvatarFallback>AS</AvatarFallback>
        <AvatarBadge className="bg-muted-foreground" />
      </Avatar>
    </div>
  ),
};

export const Group: Story = {
  render: () => (
    <AvatarGroup>
      <Avatar>
        <AvatarFallback>EN</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>MJ</AvatarFallback>
      </Avatar>
      <Avatar>
        <AvatarFallback>AS</AvatarFallback>
      </Avatar>
      <AvatarGroupCount>+3</AvatarGroupCount>
    </AvatarGroup>
  ),
};

const PEOPLE = [
  { id: "u-maciej", name: "Maciej" },
  { id: "u-mike", name: "Mike" },
  { id: "u-alex", name: "Alex Rivera" },
  { id: "u-sam", name: "Sam Okafor" },
  { id: "u-mia", name: "Mia Chen" },
  { id: "u-anna", name: "anna.kowalska@example.com" },
];

const TEAMS = [
  { id: "t-design", name: "Design" },
  { id: "t-dev", name: "Development" },
  { id: "t-cs", name: "Customer success" },
  { id: "t-ops", name: "Ops", letters: "OP" },
];

/**
 * People are round, teams are square (calls 43 + 95). Two initials on a
 * stable colour keyed on the id, so Maciej (MA) and Mike (MI) never read alike
 * and a rename keeps the colour. No one assigned is the dashed ring.
 */
export const Identity: Story = {
  render: () => (
    <div className="flex flex-col gap-4 font-sans text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-4">
        {PEOPLE.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <PersonAvatar name={p.name} id={p.id} />
            {p.name}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <PersonAvatar name={null} />
          Unassigned
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {TEAMS.map((t) => (
          <span key={t.id} className="flex items-center gap-1.5">
            <TeamMark name={t.name} id={t.id} letters={t.letters} />
            {t.name}
          </span>
        ))}
      </div>
      <div className="flex items-end gap-3">
        {(["icon", "sm", "default", "lg"] as const).map((size) => (
          <PersonAvatar key={size} name="Maciej Grzywacz" id="u-maciej" size={size} />
        ))}
        {(["icon", "sm", "default", "lg"] as const).map((size) => (
          <TeamMark key={size} name="Design" id="t-design" size={size} />
        ))}
      </div>
    </div>
  ),
};

/**
 * Apps, not people (MOD-149): what an API key wrote shows the gray circle with
 * a small plug; Moduo's own work (a repeat's catch-up, a waiting-on that came in) the same
 * circle with the Moduo mark (the follow-up), at every rung and density; a
 * former member keeps "?". No colour and no AI badge: the name beside it says
 * who.
 */
export const ConnectedApp: Story = {
  render: () => (
    <div className="flex flex-col gap-4 font-sans text-sm text-foreground">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-1.5">
          <AppAvatar />
          Claude Code (app)
        </span>
        <span className="flex items-center gap-1.5">
          <AppAvatar />
          Maciej · via Claude Code
        </span>
        <span className="flex items-center gap-1.5">
          <AppAvatar kind="moduo" />
          Moduo caught this up to Tue (recurrence)
        </span>
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <PersonAvatar name="?" />
          Former member
        </span>
      </div>
      {(["app", "moduo"] as const).map((kind) => (
        <div key={kind} className="flex items-end gap-3">
          {(["icon", "sm", "default", "lg"] as const).map((size) => (
            <AppAvatar key={size} kind={kind} size={size} />
          ))}
        </div>
      ))}
      <AtThreeDensities>
        <div className="flex items-center gap-2">
          <AppAvatar />
          <AppAvatar kind="moduo" />
          <PersonAvatar name="?" />
          <PersonAvatar name="Maciej" id="u-maciej" />
        </div>
      </AtThreeDensities>
    </div>
  ),
};

/** An 8 × 8 PNG, inline so the story (and its visual test) needs no network. */
const PHOTO_FIXTURE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR42mOIqjiBFTEMLQkA8ZFmgbB74tkAAAAASUVORK5CYII=";
/** A photo that can't load: a PNG header with nothing after it. */
const BROKEN_PHOTO = "data:image/png;base64,iVBORw0KGgo=";

/**
 * A person with a profile photo shows it, round, at every size (MOD-96). The
 * initials on their colour stand in while it loads, and stay when it fails
 * (second row: a photo that can't load) or when there is none (third row).
 * tests/visual/avatars.spec.ts reads the three rows.
 */
export const PersonWithPhoto: Story = {
  render: () => {
    const sizes = ["icon", "sm", "default", "lg"] as const;
    return (
      <div className="flex flex-col gap-3">
        <div data-row="photo" className="flex items-end gap-3">
          {sizes.map((size) => (
            <PersonAvatar
              key={size}
              name="Mike Grochowski"
              id="u-mike"
              src={PHOTO_FIXTURE}
              size={size}
            />
          ))}
        </div>
        <div data-row="broken" className="flex items-end gap-3">
          {sizes.map((size) => (
            <PersonAvatar
              key={size}
              name="Mike Grochowski"
              id="u-mike"
              src={BROKEN_PHOTO}
              size={size}
            />
          ))}
        </div>
        <div data-row="none" className="flex items-end gap-3">
          {sizes.map((size) => (
            <PersonAvatar key={size} name="Mike Grochowski" id="u-mike" size={size} />
          ))}
        </div>
      </div>
    );
  },
};

/** The icon rung scales with density: 16 / 15 / 14 px, two letters still fit. */
export const Densities: Story = {
  render: () => (
    <AtThreeDensities>
      <div className="flex items-center gap-2">
        <PersonAvatar name="Maciej" id="u-maciej" />
        <PersonAvatar name="Mike" id="u-mike" />
        <PersonAvatar name={null} />
        <TeamMark name="Design" id="t-design" />
        <TeamMark name="Development" id="t-dev" />
        <PersonAvatar name="Maciej" id="u-maciej" size="sm" />
      </div>
    </AtThreeDensities>
  ),
};

const SHAPES: PresenceShape[] = ["reachable", "away", "dnd", "focusing", "in_call", "offline"];

/** The presence shapes (chat v2 §10, AC11.1): green only for reachable; grey
 *  outline, bar, target and dot; nothing offline. At three densities. */
export const Presence: Story = {
  render: () => (
    <AtThreeDensities>
      <div className="flex items-center gap-4" data-testid="presence-shapes">
        {SHAPES.map((state) => (
          <span key={state} className="flex items-center gap-4">
            <span className="relative flex">
              <PersonAvatar name="Sofia Ortiz" id="u-sofia" size="icon" />
              <PresenceBadge state={state} />
            </span>
            <span className="relative flex">
              <PersonAvatar name="Sofia Ortiz" id="u-sofia" size="lg" />
              <PresenceBadge state={state} size="lg" />
            </span>
          </span>
        ))}
      </div>
    </AtThreeDensities>
  ),
};

/** The feed rung (chat's stream, CH29): 32 / 28 / 24 px beside a message. */
export const Feed: Story = {
  render: () => (
    <AtThreeDensities>
      <div className="flex items-center gap-2">
        <PersonAvatar name="Sofia Ortiz" id="u-sofia" size="feed" />
        <PersonAvatar name="Mike Chen" id="u-mike" size="feed" />
        <PersonAvatar name="?" size="feed" />
      </div>
    </AtThreeDensities>
  ),
};
