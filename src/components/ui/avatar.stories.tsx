import type { Meta, StoryObj } from "@storybook/react";

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
  PersonAvatar,
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
