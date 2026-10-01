import { useRef, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { cn } from "../../../lib/utils";
import { validateImageFile, WORKSPACE_ICON_CHOICES } from "../../branding/image-asset";

type MarkProps = {
  name: string;
  icon?: string | null;
  logoUrl?: string | null;
  className?: string;
};

/** The workspace's logo, emoji, or initial. Square, so it reads as a brand mark. */
export function WorkspaceMark({ name, icon, logoUrl, className }: MarkProps) {
  const initial = (name.trim().slice(0, 1) || "?").toUpperCase();
  return (
    <span
      className={cn(
        "grid size-7 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-muted text-xs font-medium text-muted-foreground",
        className,
      )}
      aria-hidden
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" className="size-full object-cover" />
      ) : icon ? (
        <span className="text-sm leading-none">{icon}</span>
      ) : (
        initial
      )}
    </span>
  );
}

type PickerProps = MarkProps & {
  busy?: boolean;
  onPickIcon: (emoji: string) => void;
  onPickLogo: (file: File) => void;
  onInvalidLogo: (message: string) => void;
  onClear: () => void;
};

/** Owner control: pick an emoji or upload a logo. The two are alternatives. */
export function WorkspaceMarkPicker({
  name,
  icon,
  logoUrl,
  className,
  busy,
  onPickIcon,
  onPickLogo,
  onInvalidLogo,
  onClear,
}: PickerProps) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [custom, setCustom] = useState("");
  const hasMark = Boolean(icon || logoUrl);

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const problem = validateImageFile(file);
          if (problem) {
            onInvalidLogo(problem);
            return;
          }
          onPickLogo(file);
        }}
      />
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={busy}
            aria-label="Change workspace icon"
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:opacity-50"
          >
            <WorkspaceMark name={name} icon={icon} logoUrl={logoUrl} className={className} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <p className="text-xs text-muted-foreground">Icon</p>
          <div className="mt-2 grid grid-cols-8 gap-1">
            {WORKSPACE_ICON_CHOICES.map((emoji) => {
              const active = icon === emoji && !logoUrl;
              return (
                <button
                  key={emoji}
                  type="button"
                  disabled={busy}
                  aria-label={`Use ${emoji} as the workspace icon`}
                  aria-pressed={active}
                  onClick={() => onPickIcon(emoji)}
                  className={cn(
                    "grid size-7 place-items-center rounded-md text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    active && "bg-accent",
                  )}
                >
                  {emoji}
                </button>
              );
            })}
          </div>
          <form
            className="mt-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!custom.trim() || busy) return;
              onPickIcon(custom);
              setCustom("");
            }}
          >
            <Label htmlFor="ws-custom-icon" className="sr-only">
              Custom emoji
            </Label>
            <Input
              id="ws-custom-icon"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="Or paste an emoji"
              disabled={busy}
              className="h-8"
            />
          </form>
          <div className="mt-3 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              Upload logo
            </Button>
            {hasMark ? (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClear}>
                Remove
              </Button>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">JPEG, PNG, WebP, or GIF. Up to 4 MB.</p>
        </PopoverContent>
      </Popover>
    </>
  );
}
