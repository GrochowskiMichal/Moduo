import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "../providers/auth-provider";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type Props = {
  avatarDataUrl?: string | null;
  profileInitial?: string;
  onOpenSettings?: () => void;
  onOpenIntegrations?: () => void;
};

export function UserMenu({ avatarDataUrl, profileInitial = "U", onOpenSettings, onOpenIntegrations }: Props) {
  const { signOut } = useAuth();
  const navigate = useNavigate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-border bg-card text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        aria-label="User menu"
      >
        <Avatar size="sm" className="h-full w-full">
          {avatarDataUrl ? <AvatarImage src={avatarDataUrl} alt="Account avatar" /> : null}
          <AvatarFallback>{profileInitial}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[240px]">
        <DropdownMenuLabel>Account</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onOpenSettings?.()}>Settings</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onOpenIntegrations?.()}>Integrations</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            try {
              await signOut();
            } finally {
              void navigate({ to: "/auth" });
            }
          }}
        >
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
