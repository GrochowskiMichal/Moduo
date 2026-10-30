import { Check, Copy, Pencil, Plus, SlidersHorizontal, Unplug, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
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
import { Eyebrow } from "../../../components/ui/eyebrow";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Switch } from "../../../components/ui/switch";
import type { WorkspaceApiKey } from "../../../lib/runtime";
import { formatFullDate } from "../../../lib/time-format";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import {
  ceilingHint,
  clampScopes,
  CONNECT_BY_URL_LEAD,
  DEFAULT_KEY_EXPIRY,
  DEFAULT_KEY_SCOPES,
  disconnectCopy,
  effectiveScopes,
  expiryDays,
  grantsAnyAccess,
  isConnectedApp,
  type KeyActor,
  type KeyCeilings,
  keyCeilings,
  keyLifecycle,
  KEYS_FOR_SCRIPTS_LABEL,
  keyScopeCaps,
  type McpKeyModule,
  type McpKeyScopes,
  sameScopes,
  scopesPayload,
  scopeSummary,
  toKeyScopes,
} from "../api-keys";
import { connectedAppLine, isCheckedApp, UNCHECKED_APP_NOTE } from "../oauth-consent";
import { KeyExpiryField, KeyScopeFields } from "./key-scope-fields";
import { SettingsSectionShell } from "./section-shell";

const NO_ACCESS_HINT = "Give the key access to at least one module.";
const CHAT_PLAN_NOTE = "Chat is on the Duo and Team plans.";

function readySentence(name: string) {
  return `${name} is ready. Copy the key now — it won't be shown again.`;
}

/** A labelled cluster (eyebrow above a card), mirroring the other settings sections. */
function KeysGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Eyebrow className="px-1">{label}</Eyebrow>
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card px-6 py-5">
        {children}
      </section>
    </div>
  );
}

/** Who a key acts as, in words, and what that leaves it. */
type KeyOwner = {
  actor: KeyActor | null;
  /** False while the member list hasn't loaded: the creator's access isn't known yet. */
  known: boolean;
  isMine: boolean;
  /** "you", a teammate's name, or a placeholder. */
  name: string;
  /** The row's line about it ("Acts as you"). */
  line: string;
};

function ApiKeyRow({
  apiKey,
  owner,
  ceilings,
  extraNotes,
  editing,
  draft,
  saving,
  onDraftChange,
  onToggleEdit,
  onSave,
  onRevoke,
  onRename,
  privateBusy,
  onSetPrivateChat,
}: {
  apiKey: WorkspaceApiKey;
  owner: KeyOwner;
  ceilings: KeyCeilings;
  extraNotes?: Partial<Record<McpKeyModule, string>>;
  editing: boolean;
  draft: McpKeyScopes;
  saving: boolean;
  onDraftChange: (next: McpKeyScopes) => void;
  onToggleEdit: () => void;
  onSave: () => void;
  onRevoke: () => void;
  /** Resolves true once the new name is stored; the field stays open otherwise. */
  onRename: (name: string) => Promise<boolean>;
  privateBusy: boolean;
  onSetPrivateChat: (on: boolean) => void;
}) {
  const scopes = toKeyScopes(apiKey.scopes);
  const privateId = useId();
  // What it can do today: its scopes, capped by its creator's access (or just
  // its scopes while that access isn't known).
  const effective = owner.known ? effectiveScopes(scopes, owner.actor) : scopes;
  const limited = !sameScopes(effective, scopes);
  const life = keyLifecycle(apiKey);
  const expired = life.status === "expired";
  const draftGrantsAccess = grantsAnyAccess(draft);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const reasonId = useId();
  const wasEditing = useRef(editing);
  const wasSaving = useRef(saving);
  // Set by this row's own close / save — never by another row's toggle closing
  // this editor, which would otherwise pull focus back here (WebKit doesn't
  // focus clicked buttons, so focus sits on <body> either way).
  const restoreFocus = useRef(false);
  const app = isConnectedApp(apiKey);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(apiKey.name);
  const [renameBusy, setRenameBusy] = useState(false);
  const renameButtonRef = useRef<HTMLButtonElement>(null);

  const startRename = () => {
    setNameDraft(apiKey.name);
    setRenaming(true);
  };
  const stopRename = () => {
    setRenaming(false);
    // The field unmounts; go back to the button that opened it.
    window.setTimeout(() => renameButtonRef.current?.focus(), 0);
  };
  const commitRename = async () => {
    if (renameBusy) return;
    const next = nameDraft.trim();
    if (!next || next === apiKey.name) {
      stopRename();
      return;
    }
    setRenameBusy(true);
    const ok = await onRename(next);
    setRenameBusy(false);
    if (ok) stopRename();
  };

  // Closing the editor unmounts Cancel / Save, and a failed save re-enables
  // controls that were disabled while it ran. Either way, if focus fell to
  // <body>, put it back where the user was working.
  useEffect(() => {
    const closed = wasEditing.current && !editing;
    const saveSettled = wasSaving.current && !saving;
    if (restoreFocus.current && document.activeElement === document.body) {
      if (closed) editButtonRef.current?.focus();
      else if (saveSettled && editing) saveButtonRef.current?.focus();
    }
    if (closed || saveSettled) restoreFocus.current = false;
    wasEditing.current = editing;
    wasSaving.current = saving;
  }, [editing, saving]);

  const closeFromHere = () => {
    restoreFocus.current = true;
    onToggleEdit();
  };
  const saveFromHere = () => {
    restoreFocus.current = true;
    onSave();
  };

  return (
    <li className="flex flex-col gap-3 rounded-md border border-border bg-muted/30 px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {renaming ? (
            <Input
              aria-label={`Name for ${apiKey.name}`}
              value={nameDraft}
              maxLength={80}
              autoFocus
              // Renaming usually replaces the name: start with it selected.
              onFocus={(event) => event.currentTarget.select()}
              readOnly={renameBusy}
              size="sm"
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => void commitRename()}
              onKeyDown={(event) => {
                if (event.key === "Enter") void commitRename();
                if (event.key === "Escape") {
                  event.stopPropagation();
                  stopRename();
                }
              }}
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm text-foreground">{apiKey.name}</p>
              {app ? <Badge variant="outline">Connected app</Badge> : null}
              {owner.isMine ? (
                <IconButton
                  ref={renameButtonRef}
                  icon={Pencil}
                  label={`Rename ${apiKey.name}`}
                  tooltip="Rename"
                  onClick={startRename}
                />
              ) : null}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{scopeSummary(effective)}</p>
          <p className="text-xs text-muted-foreground">
            {owner.line}
            {limited && owner.actor ? ` · Limited to what ${owner.name} can do` : ""}
          </p>
          {app ? (
            // No secret to show: the app signed in, so where it returns to says which one it is.
            // The scheme counts as on the consent screen: someapp://claude.ai is not claude.ai.
            <>
              <p className="truncate text-xs text-muted-foreground">{connectedAppLine(apiKey)}</p>
              {isCheckedApp(apiKey.oauthClientScheme, apiKey.oauthClientDomain) ? null : (
                <p className="text-xs text-muted-foreground">{UNCHECKED_APP_NOTE}</p>
              )}
            </>
          ) : (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {apiKey.keyPrefix}…
              <span className="ml-2 font-sans">
                {apiKey.lastUsedAt
                  ? `Last used ${formatFullDate(apiKey.lastUsedAt)}`
                  : "Never used"}
              </span>
            </p>
          )}
          {life.expiryLine ? (
            <p
              className={`text-xs ${
                expired
                  ? "text-destructive"
                  : life.status === "expiring"
                    ? "text-warning"
                    : "text-muted-foreground"
              }`}
            >
              {life.expiryLine}
              {expired
                ? app
                  ? ". The app is asked to sign in again."
                  : ". It no longer connects. Revoke it to clear it."
                : ""}
            </p>
          ) : null}
          {life.staleNote ? <p className="text-xs text-warning">{life.staleNote}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            ref={editButtonRef}
            type="button"
            variant={editing ? "secondary" : "ghost"}
            size="sm"
            aria-label={`Edit access for ${apiKey.name}`}
            aria-expanded={editing}
            onClick={editing ? closeFromHere : onToggleEdit}
            disabled={saving || expired}
          >
            <SlidersHorizontal aria-hidden />
            Edit access
          </Button>
          <IconButton
            icon={app ? Unplug : X}
            label={`${app ? "Disconnect" : "Revoke"} ${apiKey.name}`}
            tooltip={app ? "Disconnect" : "Revoke key"}
            onClick={onRevoke}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          />
        </div>
      </div>

      {editing ? (
        <>
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            {owner.isMine ? null : (
              <p id={reasonId} className="text-xs text-muted-foreground">
                {owner.actor
                  ? `${ceilingHint({ module: "tasks", isCreator: false, myCap: "none", creatorName: owner.name })} You can lower it or ${app ? "disconnect" : "revoke"} it.`
                  : `You can lower this key's access or ${app ? "disconnect" : "revoke"} it.`}
              </p>
            )}
            <KeyScopeFields
              aria-label={`${apiKey.name} access`}
              // Disabled levels can't take focus, so the reason has to be read with the group.
              aria-describedby={owner.isMine ? undefined : reasonId}
              value={draft}
              onChange={onDraftChange}
              ceilings={ceilings}
              extraNotes={extraNotes}
              disabled={saving}
            />
            {/* CV-21: its own switch, saved at once (not a scope: KEYS-1's map stays as it is). */}
            {draft.chat !== "none" || apiKey.includePrivateChat ? (
              <div className="flex items-center justify-between gap-4 border-t border-border pt-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Label htmlFor={privateId} className="text-sm text-foreground">
                    Include private channels I'm in
                  </Label>
                  <span id={`${privateId}-hint`} className="text-xs text-muted-foreground">
                    {owner.isMine
                      ? "Off: it reads public channels only. Direct messages stay out of reach of every key."
                      : `Only ${owner.name} can turn this on. You can turn it off.`}
                  </span>
                </div>
                <Switch
                  id={privateId}
                  aria-describedby={`${privateId}-hint`}
                  checked={apiKey.includePrivateChat}
                  disabled={privateBusy || saving || (!owner.isMine && !apiKey.includePrivateChat)}
                  onCheckedChange={(on) => onSetPrivateChat(on === true)}
                />
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {draftGrantsAccess
                ? app
                  ? "Applies right away. The app picks up new tools when it reloads them."
                  : "Applies right away. Reconnect your AI app to pick up new tools."
                : `${NO_ACCESS_HINT} To cut it off, ${app ? "disconnect" : "revoke"} it.`}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" onClick={closeFromHere} disabled={saving}>
                Cancel
              </Button>
              {/* Secondary, not primary: "Create key" keeps the section's one accent action (R5). */}
              <Button
                ref={saveButtonRef}
                type="button"
                variant="secondary"
                onClick={saveFromHere}
                disabled={saving || !draftGrantsAccess || sameScopes(draft, scopes)}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </li>
  );
}

/**
 * Workspace API keys for the Moduo MCP connector (docs/moduo-mcp-connector.md).
 * Each key is scoped per module on the none / view / edit ladder (admin is
 * never key-grantable), acts as the person who created it and never gets more
 * than they can do, can have its access changed later without rotating the
 * secret (only its creator can widen it), and shows its secret exactly once.
 * Needs the API keys permission; the key RPCs enforce every rule server-side.
 */
export function ApiKeysSection() {
  const { runtime, userId } = useAuth();
  const { selectedWorkspace, can, members, myPerms } = useWorkspace();
  const canManageKeys = can("ws.api_keys");
  const workspaceId = selectedWorkspace?.id ?? null;

  // null until the first load lands, so an existing list never flashes "No keys yet".
  const [keys, setKeys] = useState<WorkspaceApiKey[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [newScopes, setNewScopes] = useState<McpKeyScopes>(() => ({ ...DEFAULT_KEY_SCOPES }));
  const [expiry, setExpiry] = useState<string>(DEFAULT_KEY_EXPIRY);
  const [creating, setCreating] = useState(false);
  const [revealed, setRevealed] = useState<{ name: string; secret: string } | null>(null);
  // What the status region reads out. Cleared first on every reveal, so a second
  // key with the same name is still announced (identical text isn't).
  const [announcement, setAnnouncement] = useState("");
  // Bumped when a create fails, so focus can go back to Create.
  const [createFailures, setCreateFailures] = useState(0);
  const [copied, setCopied] = useState<"secret" | "endpoint" | null>(null);
  // One key's access is edited at a time, in place; Save sends the whole map.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editScopes, setEditScopes] = useState<McpKeyScopes>(() => ({ ...DEFAULT_KEY_SCOPES }));
  const [saving, setSaving] = useState(false);
  const [privateBusyId, setPrivateBusyId] = useState<string | null>(null);
  // Revoke is instant + irreversible (the secret can't be re-shown), so it
  // confirms first — the confirm-not-undo half of the DF-5 grammar.
  const [revokeTarget, setRevokeTarget] = useState<WorkspaceApiKey | null>(null);
  // null = unknown (still checking, or the check failed): say nothing.
  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null);

  // A workspace switch can resolve the old list after the new one — only the
  // latest request may land.
  const loadSeq = useRef(0);
  // The workspace on screen, so work that started in another one can tell.
  const currentWorkspaceId = useRef(workspaceId);
  const copySecretRef = useRef<HTMLButtonElement>(null);
  const createButtonRef = useRef<HTMLButtonElement>(null);

  // The person creating a new key (you) and what a key acting as you may hold.
  const me: KeyActor | null = selectedWorkspace
    ? { role: selectedWorkspace.role, perms: myPerms }
    : null;
  const myCaps = keyScopeCaps(me);

  // Someone else's key: one reason for every row, said once above them.
  const ceilingsFor = (stored: McpKeyScopes, isMine: boolean, ownerName: string): KeyCeilings =>
    keyCeilings({ stored, isMine, ownerName, myCaps });
  // A new key holds nothing yet: each row goes up to what you can do yourself.
  const newKeyCeilings = ceilingsFor(toKeyScopes({}), true, "you");
  // The form keeps your choice; what it shows and sends never exceeds what you
  // can give (a role without Tasks starts the default at nothing).
  const shownNewScopes = clampScopes(newScopes, myCaps);

  const ownerOf = (key: WorkspaceApiKey): KeyOwner => {
    if (!key.createdBy) {
      return {
        actor: null,
        known: true,
        isMine: false,
        name: "its creator",
        line: "No creator on record, so it can't connect. Revoke it and make a new one.",
      };
    }
    if (key.createdBy === userId)
      return { actor: me, known: true, isMine: true, name: "you", line: "Acts as you" };
    const member = members.find((m) => m.userId === key.createdBy);
    // A loaded member list always includes you, so an empty one hasn't loaded
    // (or failed to): the creator is unknown, not gone.
    if (!member && members.length === 0) {
      return {
        actor: null,
        known: false,
        isMine: false,
        name: "a workspace member",
        line: "Acts as a workspace member",
      };
    }
    if (!member) {
      return {
        actor: null,
        known: true,
        isMine: false,
        name: "a former member",
        line: "Acts as a former member, so it has no access",
      };
    }
    const name = member.displayName?.trim() || "a workspace member";
    return {
      actor: { role: member.role, perms: member.perms },
      known: true,
      isMine: false,
      name,
      line: `Acts as ${name}`,
    };
  };

  const chatNotes = chatEnabled === false ? { chat: CHAT_PLAN_NOTE } : undefined;

  const refresh = useCallback(async () => {
    if (!runtime || !workspaceId || !canManageKeys) return;
    const seq = ++loadSeq.current;
    try {
      const next = await runtime.workspace.listApiKeys(workspaceId);
      if (seq !== loadSeq.current) return;
      setKeys(next);
      setLoadFailed(false);
    } catch {
      if (seq === loadSeq.current) setLoadFailed(true);
    }
  }, [runtime, workspaceId, canManageKeys]);

  useEffect(() => {
    // Nothing from the previous workspace — least of all a revealed secret — carries over.
    currentWorkspaceId.current = workspaceId;
    setKeys(null);
    setLoadFailed(false);
    setEditingId(null);
    setRevealed(null);
    setRevokeTarget(null);
    setChatEnabled(null);
    setNewScopes({ ...DEFAULT_KEY_SCOPES });
    setExpiry(DEFAULT_KEY_EXPIRY);
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!runtime || !workspaceId || !canManageKeys) return;
    let live = true;
    runtime.chat
      .isEnabled(workspaceId)
      .then((on) => live && setChatEnabled(on))
      .catch(() => live && setChatEnabled(null));
    return () => {
      live = false;
    };
  }, [runtime, workspaceId, canManageKeys]);

  // A clicked Create disables itself (busy, then an empty name), which drops
  // focus on <body>; the next thing to do is copy the key, so go there.
  useEffect(() => {
    setAnnouncement("");
    if (!revealed) return;
    if (document.activeElement === document.body) copySecretRef.current?.focus();
    const timer = window.setTimeout(() => setAnnouncement(readySentence(revealed.name)), 50);
    return () => window.clearTimeout(timer);
  }, [revealed]);

  // A failed create re-enables Create; put focus back on it rather than <body>.
  useEffect(() => {
    if (createFailures > 0 && document.activeElement === document.body) {
      createButtonRef.current?.focus();
    }
  }, [createFailures]);

  const copy = async (text: string, what: "secret" | "endpoint") => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(what);
    setTimeout(() => setCopied(null), 2000);
  };

  const newKeyGrantsAccess = grantsAnyAccess(shownNewScopes);
  const canCreate = name.trim().length > 0 && newKeyGrantsAccess && !creating;

  const handleCreate = async () => {
    if (!runtime || !workspaceId || !canCreate) return;
    const startedIn = workspaceId;
    const workspaceName = selectedWorkspace?.name ?? "another workspace";
    setCreating(true);
    try {
      const created = await runtime.workspace.createApiKey({
        workspaceId,
        name: name.trim(),
        scopes: scopesPayload(shownNewScopes),
        expiresInDays: expiryDays(expiry),
      });
      if (currentWorkspaceId.current !== startedIn) {
        // Switched workspace before the secret came back. The screen (and the
        // form) belong to the new workspace now — but the secret is never shown
        // again, so hand it over in a toast that stays until dismissed.
        toast.success(`${created.name} is ready in ${workspaceName}.`, {
          description: "Copy the key now — it won't be shown again.",
          duration: Infinity,
          action: { label: "Copy key", onClick: () => void copy(created.secret, "secret") },
        });
        return;
      }
      setRevealed({ name: created.name, secret: created.secret });
      setName("");
      setNewScopes({ ...DEFAULT_KEY_SCOPES });
      setExpiry(DEFAULT_KEY_EXPIRY);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create the key.");
      setCreateFailures((n) => n + 1);
    } finally {
      setCreating(false);
    }
  };

  const toggleEdit = (key: WorkspaceApiKey) => {
    if (editingId === key.id) {
      setEditingId(null);
      return;
    }
    setEditingId(key.id);
    setEditScopes(toKeyScopes(key.scopes));
  };

  const handleSave = async (key: WorkspaceApiKey) => {
    if (!runtime || saving || !grantsAnyAccess(editScopes)) return;
    setSaving(true);
    try {
      const scopes = await runtime.workspace.setApiKeyScopes(key.id, scopesPayload(editScopes));
      setKeys((prev) => prev?.map((k) => (k.id === key.id ? { ...k, scopes } : k)) ?? prev);
      setEditingId((current) => (current === key.id ? null : current));
      toast.success(`Access updated for ${key.name}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update the key's access.");
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrivateChat = async (key: WorkspaceApiKey, on: boolean) => {
    if (!runtime || privateBusyId) return;
    setPrivateBusyId(key.id);
    try {
      const next = await runtime.workspace.setApiKeyPrivateChat(key.id, on);
      setKeys(
        (prev) =>
          prev?.map((k) => (k.id === key.id ? { ...k, includePrivateChat: next } : k)) ?? prev,
      );
      toast.success(
        next
          ? `${key.name} can read your private channels.`
          : `${key.name} reads public channels only.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't change the key.");
    } finally {
      setPrivateBusyId(null);
    }
  };

  const handleRevoke = async (key: WorkspaceApiKey) => {
    if (!runtime) return;
    const app = isConnectedApp(key);
    try {
      if (app) await runtime.workspace.disconnectApp(key);
      else await runtime.workspace.revokeApiKey(key.id);
      setKeys((prev) => prev?.filter((k) => k.id !== key.id) ?? prev);
      setEditingId((current) => (current === key.id ? null : current));
      if (app) toast.success(`${key.name} is disconnected.`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : app
            ? "Couldn't disconnect it."
            : "Couldn't revoke the key.",
      );
    }
  };

  const handleRename = async (key: WorkspaceApiKey, next: string): Promise<boolean> => {
    if (!runtime) return false;
    try {
      const stored = await runtime.workspace.renameApiKey(key.id, next);
      setKeys((prev) => prev?.map((k) => (k.id === key.id ? { ...k, name: stored } : k)) ?? prev);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't rename it.");
      return false;
    }
  };

  const endpoint = runtime?.workspace.getMcpEndpoint() ?? "";
  const revokingApp = revokeTarget ? isConnectedApp(revokeTarget) : false;
  const disconnect = disconnectCopy(revokeTarget?.name ?? "");
  const appCount = keys?.filter(isConnectedApp).length ?? 0;
  const listLabel =
    keys && keys.length > 0
      ? `${appCount > 0 ? "Connected apps and keys" : "Keys"} · ${keys.length}`
      : "Connected apps and keys";

  return (
    <SettingsSectionShell
      title="API keys"
      description="Connect your AI and agents to this workspace over MCP."
    >
      {!selectedWorkspace ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          No workspace selected.
        </p>
      ) : !canManageKeys ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Your role doesn&apos;t include API keys in this workspace. Ask the workspace owner.
        </p>
      ) : (
        <>
          <KeysGroup label="Connector">
            <p className="text-sm text-foreground">{CONNECT_BY_URL_LEAD}</p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 py-1 pr-1 pl-3">
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {endpoint}
              </p>
              <IconButton
                icon={copied === "endpoint" ? Check : Copy}
                label={copied === "endpoint" ? "Copied" : "Copy connector URL"}
                onClick={() => void copy(endpoint, "endpoint")}
                className={copied === "endpoint" ? "text-success" : undefined}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              An app reaches only the modules you choose: View lets it read, Edit also lets it make
              changes, and it never gets more than you can do. Everything it does is attributed in
              the activity trail.
            </p>
          </KeysGroup>

          <KeysGroup label={listLabel}>
            {loadFailed ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground" role="alert">
                  Couldn&apos;t load this workspace&apos;s keys.
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={() => void refresh()}>
                  Try again
                </Button>
              </div>
            ) : keys === null ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : keys.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nothing connected yet. Apps you connect by URL show up here, and so do keys.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {keys.map((key) => {
                  const owner = ownerOf(key);
                  return (
                    <ApiKeyRow
                      key={key.id}
                      apiKey={key}
                      owner={owner}
                      ceilings={ceilingsFor(toKeyScopes(key.scopes), owner.isMine, owner.name)}
                      extraNotes={chatNotes}
                      editing={editingId === key.id}
                      draft={editScopes}
                      saving={saving}
                      onDraftChange={setEditScopes}
                      onToggleEdit={() => toggleEdit(key)}
                      onSave={() => void handleSave(key)}
                      onRevoke={() => setRevokeTarget(key)}
                      onRename={(next) => handleRename(key, next)}
                      privateBusy={privateBusyId === key.id}
                      onSetPrivateChat={(on) => void handleSetPrivateChat(key, on)}
                    />
                  );
                })}
              </ul>
            )}
          </KeysGroup>

          <KeysGroup label={KEYS_FOR_SCRIPTS_LABEL}>
            <p className="text-xs text-muted-foreground">
              A key is pasted into the tool as a header instead of signing in. Point the tool at the
              connector URL above.
            </p>
            {/* Always mounted, so the reveal is announced — the sentence only, never the secret. */}
            <p role="status" className="sr-only">
              {announcement}
            </p>
            {revealed ? (
              <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 py-1.5 pr-1 pl-3">
                <Check className="size-icon-sm shrink-0 text-success" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-success">{readySentence(revealed.name)}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {revealed.secret}
                  </p>
                </div>
                <IconButton
                  ref={copySecretRef}
                  icon={copied === "secret" ? Check : Copy}
                  label={copied === "secret" ? "Copied" : "Copy API key"}
                  onClick={() => void copy(revealed.secret, "secret")}
                  className={copied === "secret" ? "text-success" : undefined}
                />
                <IconButton icon={X} label="Dismiss" onClick={() => setRevealed(null)} />
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Nightly import"
                // Read-only, not disabled, while creating: keeps the caret for Enter-to-create.
                readOnly={creating}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleCreate();
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <span id="api-key-access" className="text-sm font-medium text-foreground">
                Access
              </span>
              <KeyScopeFields
                aria-labelledby="api-key-access"
                value={shownNewScopes}
                onChange={setNewScopes}
                ceilings={newKeyCeilings}
                extraNotes={chatNotes}
                disabled={creating}
              />
            </div>
            <KeyExpiryField
              value={expiry}
              onChange={setExpiry}
              hint="A key that stops working on its own limits what a leak can do."
              disabled={creating}
            />
            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <p className="text-xs text-muted-foreground">
                {newKeyGrantsAccess
                  ? "The key acts as you. You'll see it once, right after you create it."
                  : NO_ACCESS_HINT}
              </p>
              <Button
                ref={createButtonRef}
                type="button"
                onClick={() => void handleCreate()}
                disabled={!canCreate}
              >
                <Plus aria-hidden />
                {creating ? "Creating…" : "Create key"}
              </Button>
            </div>
          </KeysGroup>

          <Dialog
            open={revokeTarget !== null}
            onOpenChange={(open) => !open && setRevokeTarget(null)}
          >
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>
                  {revokingApp ? disconnect.title : `Revoke ${revokeTarget?.name || "this key"}?`}
                </DialogTitle>
                <DialogDescription>
                  {revokingApp
                    ? disconnect.body
                    : "Anything connected with this key loses access immediately. This can't be undone."}
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
                  {revokingApp ? "Disconnect" : "Revoke key"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </SettingsSectionShell>
  );
}
