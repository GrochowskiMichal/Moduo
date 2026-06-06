import { Share2 } from "lucide-react";
import type { NoteSharePermission, NoteShareScope, NoteShareTarget } from "../../types";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../../components/ui/dialog";
import { Button } from "../../../../components/ui/button";

type TeamMember = {
  id: string;
  name: string;
  role: string;
};

type Props = {
  open: boolean;
  shareScope: NoteShareScope;
  sharePermission: NoteSharePermission;
  shareUsers: NoteShareTarget[];
  teamMembers: TeamMember[];
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onShareScopeChange: (scope: NoteShareScope) => void;
  onSharePermissionChange: (permission: NoteSharePermission) => void;
  onShareUsersChange: (users: NoteShareTarget[]) => void;
  onToggleUser: (userId: string) => void;
  onSetUserPermission: (userId: string, permission: NoteSharePermission) => void;
  onSave: () => void;
};

export function NotesShareDialog({
  open,
  shareScope,
  sharePermission,
  shareUsers,
  teamMembers,
  saving,
  onOpenChange,
  onShareScopeChange,
  onSharePermissionChange,
  onShareUsersChange,
  onToggleUser,
  onSetUserPermission,
  onSave,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="size-4" aria-hidden="true" />
            Share note
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-1 rounded-md bg-muted p-1">
            {(["private", "workspace", "selected"] as NoteShareScope[]).map((scope) => (
              <button
                key={scope}
                type="button"
                className={`rounded px-2 py-1.5 text-sm font-medium capitalize transition-colors ${
                  shareScope === scope ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => onShareScopeChange(scope)}
              >
                {scope === "workspace" ? "Everyone" : scope}
              </button>
            ))}
          </div>

          {shareScope !== "private" ? (
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-foreground">Permission</span>
              <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1">
                {(["view", "edit"] as NoteSharePermission[]).map((permission) => (
                  <button
                    key={permission}
                    type="button"
                    className={`rounded px-3 py-1 text-sm font-medium capitalize transition-colors ${
                      sharePermission === permission ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => {
                      onSharePermissionChange(permission);
                      onShareUsersChange(shareUsers.map((share) => ({ ...share, permission })));
                    }}
                  >
                    {permission}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {shareScope === "selected" ? (
            <div className="max-h-56 space-y-1 overflow-y-auto">
              {teamMembers.map((member) => {
                const checked = shareUsers.some((share) => share.userId === member.id);
                const permission = shareUsers.find((share) => share.userId === member.id)?.permission ?? sharePermission;
                return (
                  <div key={member.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                    <input
                      type="checkbox"
                      className="size-4 accent-foreground"
                      checked={checked}
                      onChange={() => onToggleUser(member.id)}
                      aria-label={`Share with ${member.name}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">{member.name}</span>
                    <div className="grid grid-cols-2 gap-1 rounded bg-muted p-0.5">
                      {(["view", "edit"] as NoteSharePermission[]).map((item) => (
                        <button
                          key={item}
                          type="button"
                          className={`rounded px-2 py-0.5 text-xs font-medium capitalize transition-colors ${
                            checked && permission === item ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                          }`}
                          disabled={!checked}
                          onClick={() => onSetUserPermission(member.id, item)}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
              {teamMembers.length === 0 ? (
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">No teammates</div>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={onSave}
            disabled={saving || (shareScope === "selected" && shareUsers.length === 0)}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
