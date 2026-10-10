import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

type Props = {
  avatarDataUrl?: string | null;
  profileInitial?: string;
  /** Called when the avatar is clicked. Drives the Settings modal open. */
  onOpenSettings?: () => void;
};

/**
 * Single-button avatar trigger. The avatar itself opens the global settings
 * modal — see SettingsModal — which now hosts the Account / Workspace /
 * Integrations / Preferences / Advanced / About sections and a Log out
 * button. There is no dropdown menu in this surface.
 */
export function UserMenu({ avatarDataUrl, profileInitial = "U", onOpenSettings }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        onClick={() => onOpenSettings?.()}
        className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-avatar border border-border bg-muted text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Open settings"
      >
        <Avatar size="sm" className="h-full w-full">
          {avatarDataUrl ? <AvatarImage src={avatarDataUrl} alt="Account avatar" /> : null}
          <AvatarFallback>{profileInitial}</AvatarFallback>
        </Avatar>
      </TooltipTrigger>
      <TooltipContent>Account &amp; settings</TooltipContent>
    </Tooltip>
  );
}
