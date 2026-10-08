import { normalizeMcpKeyScope } from "@contracts/vocabularies";
import { Check, Copy, Plus, SlidersHorizontal, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
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
import { SegmentedControl } from "../../../components/ui/segmented-control";
import type { WorkspaceApiKey } from "../../../lib/runtime";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";

import {
  ceilingHint,
  clampScopes,
  DEFAULT_KEY_SCOPES,
  effectiveScopes,
  grantsAnyAccess,
  KEY_SCOPE_LABELS,
  KEY_SCOPE_MODULES,
  type KeyActor,
  keyScopeCap,
  MCP_KEY_MODULES,
  MCP_KEY_SCOPES,
  type McpKeyModule,
  type McpKeyScope,
  type McpKeyScopes,
  sameScopes,
  scopeCeiling,
  scopeDependencyNotes,
  scopeSummary,
  scopesPayload,
  toKeyScopes,
} from "../api-keys";
import { SettingsSectionShell } from "./section-shell";

const RANK: Record<McpKeyScope, number> = { none: 0, view: 1, edit: 2 };
const NO_ACCESS_HINT = "Give the key access to at least one module.";
const CHAT_PLAN_NOTE = "Chat is on the Duo and Team plans.";

function readySentence(name: string) {
  return `${name} is ready. Copy the key now — it won't be shown again.`;
}

/** Per module: the highest level that may be chosen, and why anything above it is off. */
type Ceilings = Record<McpKeyModule, { max: McpKeyScope; why: string | null }>;

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

/**
 * The per-module access picker: one row per module, a None / View / Edit
 * segmented control each. Shared by the new-key card and a key's edit state,
 * and mirrored by the marketing landing's key card, so the labels stay plain.
 * Levels above a row's ceiling are off, with the reason under the hint; when a
 * grant lists tools that also need another module, a note says which.
 */
function KeyScopeFields({
  value,
  onChange,
  ceilings,
  extraNotes,
  disabled,
  ...group
}: {
  value: McpKeyScopes;
  onChange: (next: McpKeyScopes) => void;
  ceilings: Ceilings;
  extraNotes?: Partial<Record<McpKeyModule, string>>;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const idPrefix = useId();
  const notes = scopeDependencyNotes(value);
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0" {...group}>
      <ul className="flex flex-col">
        {KEY_SCOPE_MODULES.map(({ module, label, hint }) => {
          const note = notes[module];
          const { max, why } = ceilings[module];
          const limit = RANK[max] < RANK.edit ? why : null;
          const extra = extraNotes?.[module] ?? null;
          const hintId = `${idPrefix}-${module}-hint`;
          const limitId = `${idPrefix}-${module}-limit`;
          const noteId = `${idPrefix}-${module}-note`;
          const describedBy = [hintId, limit ? limitId : null, note || extra ? noteId : null]
            .filter(Boolean)
            .join(" ");
          return (
            <li
              key={module}
              className="flex items-center justify-between gap-4 border-b border-border py-2.5 first:pt-0 last:border-b-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm text-foreground">{label}</span>
                <span id={hintId} className="truncate text-xs text-muted-foreground">
                  {hint}
                </span>
                {limit ? (
                  <span id={limitId} className="text-xs text-muted-foreground">
                    {limit}
                  </span>
                ) : null}
                {/* Its own line, and it wraps: the last words are the part to act on. */}
                {note || extra ? (
                  <span id={noteId} className="text-xs text-warning">
                    {[note, extra].filter(Boolean).join(" ")}
                  </span>
                ) : null}
              </div>
              <SegmentedControl
                aria-label={`${label} access`}
                aria-describedby={describedBy}
                items={MCP_KEY_SCOPES.map((level) => ({
                  value: level,
                  label: KEY_SCOPE_LABELS[level],
                  // The current level stays selectable even above the ceiling,
                  // so a narrowed role never traps a row (the server agrees).
                  disabled: RANK[level] > RANK[max] && level !== value[module],
                }))}
                value={value[module]}
                onValueChange={(next) =>
                  onChange({ ...value, [module]: normalizeMcpKeyScope(next) })
                }
                disabled={disabled}
              />
            </li>
          );
        })}
      </ul>
      {/* One quiet live region for the notes, so a new one is read out without re-reading every hint. */}
      <p className="sr-only" aria-live="polite">
        {Object.values(notes).join(" ")}
      </p>
    </fieldset>
  );
}

/** Who a key acts as, in words, and what that leaves it. */
type KeyOwner = {
  actor: KeyActor | null;
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
}: {
  apiKey: WorkspaceApiKey;
  owner: KeyOwner;
  ceilings: Ceilings;
  extraNotes?: Partial<Record<McpKeyModule, string>>;
  editing: boolean;
  draft: McpKeyScopes;
  saving: boolean;
  onDraftChange: (next: McpKeyScopes) => void;
  onToggleEdit: () => void;
  onSave: () => void;
  onRevoke: () => void;
}) {
  const scopes = toKeyScopes(apiKey.scopes);
  // What it can do today: its scopes, capped by its creator's access.
  const effective = effectiveScopes(scopes, owner.actor);
  const limited = !sameScopes(effective, scopes);
  const draftGrantsAccess = grantsAnyAccess(draft);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);
  const wasSaving = useRef(saving);
  // Set by this row's own close / save — never by another row's toggle closing
  // this editor, which would otherwise pull focus back here (WebKit doesn't
  // focus clicked buttons, so focus sits on <body> either way).
  const restoreFocus = useRef(false);

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
          <p className="truncate text-sm text-foreground">{apiKey.name}</p>
          <p className="text-xs text-muted-foreground">{scopeSummary(effective)}</p>
          <p className="text-xs text-muted-foreground">
            {owner.line}
            {limited && owner.actor ? ` · Limited to what ${owner.name} can do` : ""}
          </p>
          <p className="truncate font-mono text-xs text-muted-foreground">
            {apiKey.keyPrefix}…
            <span className="ml-2 font-sans">
              {apiKey.lastUsedAt
                ? `Last used ${new Date(apiKey.lastUsedAt).toLocaleDateString()}`
                : "Never used"}
            </span>
          </p>
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
            disabled={saving}
          >
            <SlidersHorizontal aria-hidden />
            Edit access
          </Button>
          <IconButton
            icon={X}
            label={`Revoke ${apiKey.name}`}
            tooltip="Revoke key"
            onClick={onRevoke}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          />
        </div>
      </div>

      {editing ? (
        <>
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            {owner.isMine ? null : (
              <p className="text-xs text-muted-foreground">
                {owner.actor
                  ? `${ceilingHint({ module: "tasks", isCreator: false, myCap: "none", creatorName: owner.name })} You can lower it or revoke it.`
                  : "You can lower this key's access or revoke it."}
              </p>
            )}
            <KeyScopeFields
              aria-label={`${apiKey.name} access`}
              value={draft}
              onChange={onDraftChange}
              ceilings={ceilings}
              extraNotes={extraNotes}
              disabled={saving}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">
              {draftGrantsAccess
                ? "Applies right away. Reconnect your AI app to pick up new tools."
                : `${NO_ACCESS_HINT} To cut it off, revoke it.`}
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
  const myCaps = Object.fromEntries(
    MCP_KEY_MODULES.map((module) => [module, keyScopeCap(me, module)]),
  ) as McpKeyScopes;

  const ceilingsFor = (stored: McpKeyScopes, isMine: boolean, ownerName: string): Ceilings =>
    Object.fromEntries(
      MCP_KEY_MODULES.map((module) => {
        const myCap = myCaps[module];
        const max = scopeCeiling({ stored: stored[module], isCreator: isMine, myCap });
        // Someone else's key: one reason for every row, said once above them.
        const why =
          isMine && RANK[max] < RANK.edit
            ? ceilingHint({ module, isCreator: true, myCap, creatorName: ownerName })
            : null;
        return [module, { max, why }];
      }),
    ) as Ceilings;
  // A new key holds nothing yet: each row goes up to what you can do yourself.
  const newKeyCeilings = ceilingsFor(toKeyScopes({}), true, "you");
  // The form keeps your choice; what it shows and sends never exceeds what you
  // can give (a role without Tasks starts the default at nothing).
  const shownNewScopes = clampScopes(newScopes, myCaps);

  const ownerOf = (key: WorkspaceApiKey): KeyOwner => {
    if (!key.createdBy) {
      return {
        actor: null,
        isMine: false,
        name: "its creator",
        line: "No creator on record, so it can't connect. Revoke it and make a new one.",
      };
    }
    if (key.createdBy === userId)
      return { actor: me, isMine: true, name: "you", line: "Acts as you" };
    const member = members.find((m) => m.userId === key.createdBy);
    if (!member) {
      return {
        actor: null,
        isMine: false,
        name: "a former member",
        line: "Acts as a former member, so it has no access",
      };
    }
    const name = member.displayName?.trim() || "a teammate";
    return {
      actor: { role: member.role, perms: member.perms },
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

  const handleRevoke = async (key: WorkspaceApiKey) => {
    if (!runtime) return;
    try {
      await runtime.workspace.revokeApiKey(key.id);
      setKeys((prev) => prev?.filter((k) => k.id !== key.id) ?? prev);
      setEditingId((current) => (current === key.id ? null : current));
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
      ) : !canManageKeys ? (
        <p className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Your role doesn&apos;t include API keys in this workspace. Ask the workspace owner.
        </p>
      ) : (
        <>
          <KeysGroup label="Connector">
            <p className="text-sm text-muted-foreground">
              Point your AI app at this address and give it a key. A key reaches only the modules
              you choose — View lets it read, Edit also lets it make changes — and it never gets
              more than the person who made it. Everything it does is attributed in the activity
              trail.
            </p>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 py-1 pr-1 pl-3">
              <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                {endpoint}
              </p>
              <IconButton
                icon={copied === "endpoint" ? Check : Copy}
                label={copied === "endpoint" ? "Copied" : "Copy MCP endpoint"}
                onClick={() => void copy(endpoint, "endpoint")}
                className={copied === "endpoint" ? "text-success" : undefined}
              />
            </div>
          </KeysGroup>

          <KeysGroup label="New key">
            <div className="flex flex-col gap-2">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. Claude"
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

          <KeysGroup label={keys && keys.length > 0 ? `Keys · ${keys.length}` : "Keys"}>
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
              <p className="text-xs text-muted-foreground">No keys yet.</p>
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
                    />
                  );
                })}
              </ul>
            )}
          </KeysGroup>

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
        </>
      )}
    </SettingsSectionShell>
  );
}
