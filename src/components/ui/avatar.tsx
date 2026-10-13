import { cva } from "class-variance-authority";
import { Avatar as AvatarPrimitive } from "radix-ui";
import type * as React from "react";

import { initialsOf, teamLettersOf } from "@/lib/initials";
import { cn } from "@/lib/utils";

function Avatar({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Root> & {
  /** `icon` sits on the icon rung (`--icon`, density-scaled): an avatar
   * inline with 16 px icons, e.g. a task row's assignee. */
  size?: "default" | "sm" | "lg" | "icon";
}) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      data-size={size}
      className={cn(
        "group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-avatar select-none data-[size=lg]:size-10 data-[size=sm]:size-6 data-[size=icon]:size-icon",
        className,
      )}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn("aspect-square size-full", className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        "flex size-full items-center justify-center rounded-avatar bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs group-data-[size=icon]/avatar:text-3xs group-data-[size=icon]/avatar:font-medium",
        className,
      )}
      {...props}
    />
  );
}

function AvatarBadge({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        "absolute right-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background select-none",
        "group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden",
        "group-data-[size=icon]/avatar:size-1.5 group-data-[size=icon]/avatar:[&>svg]:hidden",
        "group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2",
        "group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2",
        className,
      )}
      {...props}
    />
  );
}

function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background",
        className,
      )}
      {...props}
    />
  );
}

function AvatarGroupCount({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        "relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3",
        className,
      )}
      {...props}
    />
  );
}

// ── Identity: people round, teams square (tasks-v3 calls 43 + 95, DS-6) ────────

/** The label hues an avatar or team mark may take (tokens.css §13b). Gray is
 *  kept for "no one", red for errors; the rest are spread by a hash. */
const AVATAR_HUES = ["blue", "green", "amber", "violet", "teal", "pink"] as const;
type AvatarHue = (typeof AVATAR_HUES)[number];

/** A stable hue for a person or a team. Key it on the id (a rename keeps the
 *  colour); fall back to the name. FNV-1a, so it is the same on every device. */
function avatarHue(key: string): AvatarHue {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return AVATAR_HUES[(hash >>> 0) % AVATAR_HUES.length];
}

// Initials sit on the label hue mixed into the card (bg-label-fill), in the
// foreground colour, one type step per rung: two letters must fit 16 px.
// `identityFill` is for a bare element (the team mark). Inside an Avatar the
// fallback already carries `group-data-[size=…]/avatar:` type steps, which are
// more specific than a plain `text-3xs` and survive tailwind-merge (a different
// variant), so `personFill` sets each rung through the same variants.
const personFill = cva(
  "bg-label-fill font-sans font-semibold leading-none tracking-normal text-foreground",
  {
    variants: {
      size: {
        icon: "group-data-[size=icon]/avatar:font-semibold group-data-[size=icon]/avatar:text-3xs",
        sm: "group-data-[size=sm]/avatar:text-2xs",
        default: "text-xs",
        lg: "text-sm",
      },
    },
    defaultVariants: { size: "default" },
  },
);

const identityFill = cva(
  "bg-label-fill font-sans font-semibold leading-none tracking-normal text-foreground",
  {
    variants: {
      size: {
        icon: "text-3xs",
        sm: "text-2xs",
        default: "text-xs",
        lg: "text-sm",
      },
    },
    defaultVariants: { size: "default" },
  },
);

type IdentitySize = "icon" | "sm" | "default" | "lg";

type PersonAvatarProps = Omit<React.ComponentProps<typeof AvatarPrimitive.Root>, "children"> & {
  /** The person's name; `null` draws the empty "unassigned" ring. */
  name: string | null;
  /** Their id: keys the colour, so a rename keeps it. Defaults to the name. */
  id?: string | null;
  /** A photo, when they have one. The initials show until it loads. */
  src?: string | null;
  size?: IdentitySize;
};

/**
 * A person: two initials on a stable colour, round (call 43). Decorative by
 * default (`aria-hidden`), since a name almost always sits beside it and the
 * initials would otherwise join that row's accessible name (gotchas §UI). Pass
 * `aria-hidden={false}` with an `aria-label` when it stands alone.
 */
function PersonAvatar({
  name,
  id,
  src,
  size = "icon",
  className,
  "aria-hidden": ariaHidden = true,
  ...props
}: PersonAvatarProps) {
  if (name === null) {
    return (
      <Avatar
        size={size}
        data-unassigned=""
        aria-hidden={ariaHidden}
        className={cn("border border-dashed border-subtle-foreground", className)}
        {...props}
      />
    );
  }
  const initials = initialsOf(name);
  return (
    <Avatar
      size={size}
      // Someone the app can't name (a former member) is "?" on gray.
      data-label={initials === "?" ? "gray" : avatarHue(id || name)}
      aria-hidden={ariaHidden}
      className={className}
      {...props}
    >
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className={personFill({ size })}>{initials}</AvatarFallback>
    </Avatar>
  );
}

type TeamMarkProps = Omit<React.ComponentProps<"span">, "children"> & {
  /** The team's name. */
  name: string;
  id?: string | null;
  /** The team's own letters, when someone edited them. */
  letters?: string | null;
  size?: IdentitySize;
};

/**
 * A team: two letters on a stable colour in a rounded square (call 95). People
 * are round and teams are square, so the two never read alike in one row.
 */
function TeamMark({
  name,
  id,
  letters,
  size = "icon",
  className,
  "aria-hidden": ariaHidden = true,
  ...props
}: TeamMarkProps) {
  return (
    <span
      data-slot="team-mark"
      data-size={size}
      data-label={avatarHue(id || name)}
      aria-hidden={ariaHidden}
      className={cn(
        "inline-flex size-8 shrink-0 select-none items-center justify-center rounded-sm",
        "data-[size=icon]:size-icon data-[size=sm]:size-6 data-[size=lg]:size-10",
        identityFill({ size }),
        className,
      )}
      {...props}
    >
      {(letters?.trim() || teamLettersOf(name)).slice(0, 2).toUpperCase()}
    </span>
  );
}

export type { AvatarHue, PersonAvatarProps, TeamMarkProps };
export {
  AVATAR_HUES,
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
  avatarHue,
  initialsOf,
  PersonAvatar,
  TeamMark,
  teamLettersOf,
};
