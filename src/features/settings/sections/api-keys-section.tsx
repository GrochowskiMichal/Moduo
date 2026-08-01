import { Check, Copy, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import type { WorkspaceApiKey } from "../../../lib/runtime";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";

import { type KeyScope, keyScope } from "../api-keys";
import { SettingsSectionShell } from "./section-shell";

/**
 * Workspace API keys for the Moduo MCP connector (docs/moduo-mcp-connector.md).
 * Keys are workspace-scoped, read-only by default; the secret is shown exactly
 * once at creation. Owner/admin only (RLS enforces it server-side regardless).
 * DF-19d relocated this out of the nested workspace-settings modal into its own
 * first-class Settings section.
 */
export function ApiKeysSection() {
  const { runtime } = useAuth();
  const { selectedWorkspace, canManageWorkspace } = useWorkspace();
  const workspaceId = selectedWorkspace?.id ?? null;

  const [keys, setKeys] = useState<WorkspaceApiKey[]>([]);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<KeyScope>("view");
  const [creating, setCreating] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState<"secret" | "endpoint" | null>(null);
  // Revoke is instant + irreversible (the secret can't be re-shown), so it
  // confirms first — the confirm-not-undo half of the DF-5 grammar.
  const [revokeTarget, setRevokeTarget] = useState<WorkspaceApiKey | null>(null);

  const refresh = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    try {
      setKeys(await runtime.workspace.listApiKeys(workspaceId));
    } catch {
      // Non-managers can't read keys; the section already gates, so stay quiet.
    }
  }, [runtime, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const copy = async (text: string, what: "secret" | "endpoint") => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleCreate = async () => {
    if (!runtime || !workspaceId || creating) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    try {
      const created = await runtime.workspace.createApiKey({
        workspaceId,
        name: trimmed,
        scopes: { tasks: scope },
      });
      setRevealedSecret(created.secret);
      setName("");
      setScope("view");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the key.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (key: WorkspaceApiKey) => {
    if (!runtime) return;
    try {
      await runtime.workspace.revokeApiKey(key.id);
      setKeys((prev) => prev.filter((k) => k.id !== key.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't revoke the key.");
    }
  };

  const endpoint = runtime?.workspace.getMcpEndpoint() ?? "";

  return (
    <SettingsSectionShell
      title="API keys"
      description="Connect your AI and agents to this workspace over MCP."
    >
      {!selectedWorkspace ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No workspace selected.
        </p>
      ) : !canManageWorkspace ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Only workspace owners and admins can manage API keys.
        </p>
      ) : (
        <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            Agents connect to this workspace over MCP. Keys are read-only by default, and everything
            a key does is attributed in each task&apos;s activity trail.
          </p>

          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
            <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
              {endpoint}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Copy MCP endpoint"
              title="Copy MCP endpoint"
              className="h-6 w-6"
              onClick={() => void copy(endpoint, "endpoint")}
            >
              {copied === "endpoint" ? (
                <Check className="size-3 text-success" aria-hidden />
              ) : (
                <Copy className="size-3" aria-hidden />
              )}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1">
              <Label htmlFor="api-key-name" className="sr-only">
                Key name
              </Label>
              <Input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Key name — e.g. Claude"
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleCreate();
                }}
              />
            </div>
            <div
              role="radiogroup"
              aria-label="Key scope"
              className="inline-flex items-center gap-1"
            >
              {(["view", "edit"] as const).map((level) => (
                <Button
                  key={level}
                  type="button"
                  variant={scope === level ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setScope(level)}
                  aria-pressed={scope === level}
                  className={scope === level ? "text-foreground" : "text-muted-foreground"}
                >
                  {level === "view" ? "View" : "Edit"}
                </Button>
              ))}
            </div>
            <Button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating || !name.trim()}
            >
              <Plus className="size-3.5" aria-hidden />
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>

          {revealedSecret ? (
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-3 py-2">
              <Check className="size-3.5 shrink-0 text-success" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-success">
                  Key created — copy it now, it won&apos;t be shown again:
                </p>
                <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                  {revealedSecret}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Copy API key"
                title="Copy API key"
                className="h-6 w-6"
                onClick={() => void copy(revealedSecret, "secret")}
              >
                {copied === "secret" ? (
                  <Check className="size-3 text-success" aria-hidden />
                ) : (
                  <Copy className="size-3" aria-hidden />
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Dismiss"
                className="h-6 w-6"
                onClick={() => setRevealedSecret(null)}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </div>
          ) : null}

          {keys.length > 0 ? (
            <ul className="flex flex-col gap-1.5">
              {keys.map((key) => (
                <li
                  key={key.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-foreground">{key.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {key.keyPrefix}…
                      <span className="ml-2 font-sans">
                        {key.lastUsedAt
                          ? `Last used ${new Date(key.lastUsedAt).toLocaleDateString()}`
                          : "Never used"}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={keyScope(key) === "edit" ? "info" : "secondary"}>
                      Tasks · {keyScope(key) === "edit" ? "Edit" : "View"}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Revoke ${key.name}`}
                      title="Revoke key"
                      onClick={() => setRevokeTarget(key)}
                      className="h-6 w-6 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No keys yet.</p>
          )}

          <Dialog
            open={revokeTarget !== null}
            onOpenChange={(open) => !open && setRevokeTarget(null)}
          >
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Revoke {revokeTarget?.name || "this key"}?</DialogTitle>
                <DialogDescription>
                  Anything connected with this key loses access immediately. This can&apos;t be
                  undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setRevokeTarget(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    const key = revokeTarget;
                    setRevokeTarget(null);
                    if (key) void handleRevoke(key);
                  }}
                >
                  Revoke key
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </section>
      )}
    </SettingsSectionShell>
  );
}
