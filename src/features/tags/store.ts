// The workspace tag store (tasks-v2 TV-T1).
//
// Tags are workspace-wide and every surface shows them: Tasks, Calendar, Notes
// and Email each run their own `useTasksModule` (their own task bundle), and
// the contact, company, note and email hubs read one entity's tags on their
// own. Holding tags in each of those meant a tag added in one place didn't
// show in another until it reloaded. They live here instead, once per
// workspace, shared by every surface:
//
// - **Reads seed it.** Each read hands in what it loaded and what it covered
//   (`seedTags`): the Tasks bundle covers every link, a hub covers one entity,
//   the contacts directory covers contacts and companies. A seed replaces only
//   the part it covered, never a part a newer read already loaded, and never
//   a link written after it started. A read that hit its row cap also leaves
//   alone what full reads of single items loaded.
// - **Writes go through it** (`attachTag`, `detachTag`, `toggleTag`,
//   `createOrAttachByName`, `recolorTag`, `deleteTag`). Each is an op laid on
//   top of what the reads loaded, so the change shows on every surface at
//   once. An op stays on top until a read that started after it saved has
//   come back (an older read can't put back what it changed), or until it
//   fails, which drops it and says so.
// - **New tags get their id here** (a uuid, as the server would), so a tag can
//   be attached the moment it is created; an attach waits for its tag's row.
//   Writes to the same tag on the same item run one after another.
// - **An item that doesn't exist yet can still get a tag** (capture):
//   `createOrAttachByName` takes the item's id as a promise and attaches once
//   it resolves. If the item is never created, a tag made just for it goes too.

import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { pickTagColor } from "../../components/tag-colors";
import type { ModuoRuntime } from "../../lib/runtime.types";
import { undoToast } from "../../lib/undo-toast";
import { isNewer, type LiveChange } from "../tasks/live";
import type { Tag, TagLink } from "../tasks/model";
import { findTagByName } from "./selectors";

/** An item a tag can be attached to (`tag_links.entity_type` is an open string). */
export type TagEntity = { entityType: string; entityId: string };

/** Where a write goes: the workspace, and the runtime that saves it. */
export type TagContext = {
  runtime: ModuoRuntime;
  workspaceId: string;
  /** Recorded as the new tag's owner; the server falls back to the caller. */
  userId?: string | null;
};

/** The part of the workspace's tag links a read loaded. */
export type LinkScope =
  | { kind: "all" }
  | { kind: "types"; entityTypes: readonly string[] }
  | { kind: "entity"; entityType: string; entityId: string };

export type TagSeed = {
  /** Every live tag of the workspace. */
  tags: readonly Tag[];
  /** The links the read covered (`scope`). */
  links: readonly TagLink[];
  scope: LinkScope;
  /** When the read's request started (`Date.now()`). */
  at: number;
  /**
   * False when the read's links hit their row cap (SCALE-1). A link missing
   * from it may just be past the cap, so it doesn't count as having loaded its
   * scope, and it leaves alone what full reads of single items or types loaded.
   * Default true.
   */
  complete?: boolean;
};

/**
 * What every surface renders: live tags and the links between live tags and
 * items. Shared by every reader until the next change — never mutate it.
 */
export type TagView = {
  /** Live tags, name-sorted. */
  tags: Tag[];
  links: TagLink[];
  /** `entityKey(type, id)` → that item's live tags, name-sorted. */
  byEntity: ReadonlyMap<string, Tag[]>;
};

type OpState = { settledAt: number | null };
type LinkOp = OpState & {
  kind: "link";
  id: number;
  tagId: string;
  entityType: string;
  entityId: string;
  present: boolean;
  /** The row to show: a placeholder until the attach returns the saved one. */
  link: TagLink;
};
/** A created or recolored tag. */
type TagOp = OpState & { kind: "tag"; id: number; tag: Tag };
/** A deleted tag (still undoable until `settledAt`). */
type HideOp = OpState & { kind: "hide"; id: number; tagId: string };
type Op = LinkOp | TagOp | HideOp;

type WorkspaceTags = {
  /** What the reads loaded, plus every op that has saved since. */
  tags: Map<string, Tag>;
  links: Map<string, TagLink>;
  /** The newest read per scope, so an older read arriving late is ignored. */
  seeds: Map<string, { scope: LinkScope; at: number }>;
  /** When the read behind `tags` started. */
  tagsAt: number;
  /** When a live change (TV-D5) last touched each link (by `linkKey`) and
   *  tag: a read that started before it can't put back what it changed. */
  liveLinks: Map<string, number>;
  liveTags: Map<string, number>;
  /** Link ids a live change deleted (a delete carries only the id, and the
   *  link may not have been loaded yet), with when. */
  liveDeletedLinks: Map<string, number>;
  ops: Op[];
  view: TagView | null;
};

const EMPTY_VIEW: TagView = { tags: [], links: [], byEntity: new Map() };
/** A saved op is dropped this long after saving even if no read covered it. */
const SETTLED_OP_TTL_MS = 10 * 60_000;

let nextOpId = 1;
const workspaces = new Map<string, WorkspaceTags>();
/** Tag id → resolves true once its row exists (false: it never will — kept so later writes skip it). */
const tagReady = new Map<string, Promise<boolean>>();
/** A link or a tag → the last write queued for it (writes to one thing run in order). */
const writeChains = new Map<string, Promise<unknown>>();
const listeners = new Set<() => void>();

export function entityKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

function linkKey(tagId: string, entityType: string, entityId: string): string {
  return `${tagId}|${entityType}|${entityId}`;
}

function scopeKey(scope: LinkScope): string {
  if (scope.kind === "all") return "all";
  if (scope.kind === "types") return `types:${[...scope.entityTypes].sort().join(",")}`;
  return `entity:${entityKey(scope.entityType, scope.entityId)}`;
}

function inScope(scope: LinkScope, entityType: string, entityId: string): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "types") return scope.entityTypes.includes(entityType);
  return scope.entityType === entityType && scope.entityId === entityId;
}

/** Does a read of `outer` load everything a read of `inner` does? */
function covers(outer: LinkScope, inner: LinkScope): boolean {
  if (outer.kind === "all") return true;
  if (inner.kind === "all") return false;
  if (inner.kind === "entity") return inScope(outer, inner.entityType, inner.entityId);
  return outer.kind === "types" && inner.entityTypes.every((t) => outer.entityTypes.includes(t));
}

function workspace(workspaceId: string): WorkspaceTags {
  let ws = workspaces.get(workspaceId);
  if (!ws) {
    ws = {
      tags: new Map(),
      links: new Map(),
      seeds: new Map(),
      tagsAt: Number.NEGATIVE_INFINITY,
      liveLinks: new Map(),
      liveTags: new Map(),
      liveDeletedLinks: new Map(),
      ops: [],
      view: null,
    };
    workspaces.set(workspaceId, ws);
  }
  return ws;
}

function changed(ws: WorkspaceTags): void {
  ws.view = null;
  for (const listener of listeners) listener();
}

const byName = (a: Tag, b: Tag) => a.name.localeCompare(b.name);

function computeView(ws: WorkspaceTags): TagView {
  const tags = new Map(ws.tags);
  const links = new Map(ws.links);
  const hidden = new Set<string>();
  for (const op of ws.ops) {
    if (op.kind === "tag") {
      tags.set(op.tag.id, op.tag);
    } else if (op.kind === "hide") {
      hidden.add(op.tagId);
    } else {
      const key = linkKey(op.tagId, op.entityType, op.entityId);
      if (op.present) links.set(key, op.link);
      else links.delete(key);
    }
  }
  const live = new Map<string, Tag>();
  for (const tag of tags.values()) if (!tag.deletedAt && !hidden.has(tag.id)) live.set(tag.id, tag);
  const liveLinks: TagLink[] = [];
  const byEntity = new Map<string, Tag[]>();
  for (const link of links.values()) {
    const tag = live.get(link.tagId);
    if (!tag) continue;
    liveLinks.push(link);
    const key = entityKey(link.entityType, link.entityId);
    const list = byEntity.get(key);
    if (list) list.push(tag);
    else byEntity.set(key, [tag]);
  }
  for (const list of byEntity.values()) list.sort(byName);
  return { tags: [...live.values()].sort(byName), links: liveLinks, byEntity };
}

/** The workspace's tags as every surface should show them right now. */
export function getTagView(workspaceId: string | null): TagView {
  if (!workspaceId) return EMPTY_VIEW;
  const ws = workspaces.get(workspaceId);
  if (!ws) return EMPTY_VIEW;
  ws.view ??= computeView(ws);
  return ws.view;
}

/** The live tags on one item, name-sorted. */
export function tagsOf(view: TagView, entity: TagEntity): Tag[] {
  return view.byEntity.get(entityKey(entity.entityType, entity.entityId)) ?? [];
}

export function subscribeTags(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders when the workspace's tags change; `null` → nothing. */
export function useTagView(workspaceId: string | null): TagView {
  return useSyncExternalStore(
    subscribeTags,
    () => getTagView(workspaceId),
    () => getTagView(workspaceId),
  );
}

// ── seeding ───────────────────────────────────────────────────────────────────

function opCoveredBy(op: Op, scope: LinkScope): boolean {
  // Every read loads all the workspace's live tags, so tag ops are always covered.
  return op.kind !== "link" || inScope(scope, op.entityType, op.entityId);
}

/** Hand the store what a read loaded. */
export function seedTags(workspaceId: string, seed: TagSeed): void {
  const ws = workspace(workspaceId);
  const complete = seed.complete !== false;
  const newer = [...ws.seeds.values()].filter((n) => n.at > seed.at);
  // A newer read already loaded everything this one did: this one is stale.
  if (newer.some((n) => covers(n.scope, seed.scope))) return;
  // Parts a newer read loaded keep that read's links.
  const loadedSince = (link: TagLink) =>
    newer.some((n) => inScope(n.scope, link.entityType, link.entityId));
  // A capped read can't tell a removed link from one past its cap, so it
  // leaves alone what a full read of one item or type loaded.
  const fullyRead = complete ? null : narrowSeedsIndex(ws);
  const keep = (link: TagLink) =>
    loadedSince(link) ||
    (fullyRead !== null &&
      (fullyRead.types.has(link.entityType) ||
        fullyRead.entities.has(entityKey(link.entityType, link.entityId))));
  // A link written since this read started is the write's to say, and so is
  // one a live change touched since then.
  const changedSince = new Set<string>();
  for (const op of ws.ops) {
    if (op.kind === "link" && (op.settledAt === null || op.settledAt > seed.at)) {
      changedSince.add(linkKey(op.tagId, op.entityType, op.entityId));
    }
  }
  forgetOldLive(ws);
  for (const [key, at] of ws.liveLinks) if (at > seed.at) changedSince.add(key);
  if (complete) {
    // This read now stands for its scope; older reads it covers are forgotten.
    for (const [key, old] of ws.seeds) {
      if (old.at <= seed.at && covers(seed.scope, old.scope)) ws.seeds.delete(key);
    }
    ws.seeds.set(scopeKey(seed.scope), { scope: seed.scope, at: seed.at });
  }
  // Every read loads the workspace's live tags (a capped list is the same first rows each time).
  if (seed.at >= ws.tagsAt) {
    ws.tagsAt = seed.at;
    const tags = new Map(seed.tags.map((t) => [t.id, t]));
    // A tag a live change touched after this read started keeps that state.
    for (const [id, at] of ws.liveTags) {
      if (at <= seed.at) continue;
      const live = ws.tags.get(id);
      if (live) tags.set(id, live);
      else tags.delete(id);
    }
    ws.tags = tags;
  }
  const links = new Map<string, TagLink>();
  for (const [k, link] of ws.links) {
    if (!inScope(seed.scope, link.entityType, link.entityId) || keep(link) || changedSince.has(k)) {
      links.set(k, link);
    }
  }
  const deletedSince = (link: TagLink) => (ws.liveDeletedLinks.get(link.id) ?? 0) > seed.at;
  for (const link of seed.links) {
    const k = linkKey(link.tagId, link.entityType, link.entityId);
    if (deletedSince(link)) continue;
    if (
      inScope(seed.scope, link.entityType, link.entityId) &&
      !loadedSince(link) &&
      !changedSince.has(k)
    ) {
      links.set(k, link);
    }
  }
  ws.links = links;
  // A saved op is in any read that started after it saved and covers it; keep
  // the rest on top. A capped read lacking a link the op attached may just
  // have stopped short of it, so that op stays (until it expires).
  const now = Date.now();
  const seen = complete
    ? null
    : new Set(seed.links.map((l) => linkKey(l.tagId, l.entityType, l.entityId)));
  ws.ops = ws.ops.filter((op) => {
    if (op.settledAt === null) return true;
    if (now - op.settledAt >= SETTLED_OP_TTL_MS) return false;
    if (op.settledAt > seed.at || !opCoveredBy(op, seed.scope)) return true;
    if (seen === null || op.kind !== "link" || !op.present) return false;
    return !seen.has(linkKey(op.tagId, op.entityType, op.entityId));
  });
  changed(ws);
}

// ── live changes (TV-D5) ──────────────────────────────────────────────────────

/**
 * Fold teammates' changes from Realtime into what's loaded. An op still
 * saving stays on top (it is the newer word). A saved op on the same tag or
 * link gives way, since changes arrive in commit order: this one came after
 * it. A tag version only replaces a newer one it beats on `updated_at`
 * (server-stamped). Nothing loaded for the workspace yet: the first read
 * brings it all.
 */
export function applyLiveTags(workspaceId: string, changes: readonly LiveChange[]): void {
  const ws = workspaces.get(workspaceId);
  if (!ws) return;
  // Deletes reach us from every workspace (they carry only an id), so keep
  // the marks bounded here too, not only when a read lands.
  forgetOldLive(ws);
  const now = Date.now();
  let touched = false;
  const giveWay = (gone: (op: Op) => boolean) => {
    const before = ws.ops.length;
    ws.ops = ws.ops.filter((op) => op.settledAt === null || !gone(op));
    if (ws.ops.length !== before) touched = true;
  };
  for (const change of changes) {
    if (change.table === "tags") {
      if (change.kind === "delete") {
        if (ws.tags.delete(change.id)) touched = true;
        ws.liveTags.set(change.id, now);
        giveWay((op) => op.kind === "tag" && op.tag.id === change.id);
        continue;
      }
      const row = change.row as Tag;
      const local = ws.tags.get(row.id);
      if (local && !isNewer(row.updatedAt, local.updatedAt)) continue;
      ws.tags.set(row.id, row);
      ws.liveTags.set(row.id, now);
      touched = true;
      giveWay(
        (op) =>
          op.kind === "tag" && op.tag.id === row.id && !isNewer(op.tag.updatedAt, row.updatedAt),
      );
    } else if (change.table === "tag_links") {
      if (change.kind === "delete") {
        ws.liveDeletedLinks.set(change.id, now);
        for (const [key, link] of ws.links) {
          if (link.id === change.id) {
            ws.links.delete(key);
            ws.liveLinks.set(key, now);
            touched = true;
          }
        }
        giveWay((op) => op.kind === "link" && op.link.id === change.id);
        continue;
      }
      const link = change.row as TagLink;
      const key = linkKey(link.tagId, link.entityType, link.entityId);
      ws.liveLinks.set(key, now);
      if (ws.links.get(key)?.id !== link.id) {
        ws.links.set(key, link);
        touched = true;
      }
      giveWay((op) => op.kind === "link" && linkKey(op.tagId, op.entityType, op.entityId) === key);
    }
  }
  if (touched) changed(ws);
}

/** Live-change marks only matter to reads still in flight: drop old ones. */
function forgetOldLive(ws: WorkspaceTags): void {
  const cutoff = Date.now() - SETTLED_OP_TTL_MS;
  for (const [key, at] of ws.liveLinks) if (at < cutoff) ws.liveLinks.delete(key);
  for (const [id, at] of ws.liveTags) if (at < cutoff) ws.liveTags.delete(id);
  for (const [id, at] of ws.liveDeletedLinks) if (at < cutoff) ws.liveDeletedLinks.delete(id);
}

/** The entity types and single entities that full reads (not "everything") loaded. */
function narrowSeedsIndex(ws: WorkspaceTags): { types: Set<string>; entities: Set<string> } {
  const types = new Set<string>();
  const entities = new Set<string>();
  for (const { scope } of ws.seeds.values()) {
    if (scope.kind === "types") for (const t of scope.entityTypes) types.add(t);
    else if (scope.kind === "entity") entities.add(entityKey(scope.entityType, scope.entityId));
  }
  return { types, entities };
}

// ── ops ───────────────────────────────────────────────────────────────────────

function addOp<T extends Op>(workspaceId: string, op: T): T {
  const ws = workspace(workspaceId);
  ws.ops.push(op);
  changed(ws);
  return op;
}

function dropOp(workspaceId: string, op: Op): void {
  const ws = workspace(workspaceId);
  const before = ws.ops.length;
  ws.ops = ws.ops.filter((o) => o !== op);
  if (ws.ops.length !== before) changed(ws);
}

/** The op saved: fold it into what's loaded, and keep it on top of older reads. */
function settleOp(workspaceId: string, op: Op): void {
  const ws = workspace(workspaceId);
  op.settledAt = Date.now();
  if (op.kind === "tag") {
    ws.tags.set(op.tag.id, op.tag);
  } else if (op.kind === "hide") {
    ws.tags.delete(op.tagId);
    for (const [k, link] of ws.links) if (link.tagId === op.tagId) ws.links.delete(k);
  } else {
    const key = linkKey(op.tagId, op.entityType, op.entityId);
    if (op.present) ws.links.set(key, op.link);
    else ws.links.delete(key);
  }
  changed(ws);
}

function errorText(e: unknown): string | undefined {
  return e instanceof Error ? e.message : undefined;
}

/** Run `write` after every earlier write queued under the same key. */
function chain<T>(key: string, write: () => Promise<T>): Promise<T> {
  const run = (writeChains.get(key) ?? Promise.resolve()).then(write, write);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  writeChains.set(key, tail);
  void tail.then(() => {
    if (writeChains.get(key) === tail) writeChains.delete(key);
  });
  return run;
}

const tagChainKey = (tagId: string) => `tag|${tagId}`;

function hasLink(workspaceId: string, tagId: string, entity: TagEntity): boolean {
  return tagsOf(getTagView(workspaceId), entity).some((t) => t.id === tagId);
}

function writeLink(ctx: TagContext, tagId: string, entity: TagEntity, present: boolean): void {
  const { runtime, workspaceId } = ctx;
  const id = nextOpId++;
  const op = addOp<LinkOp>(workspaceId, {
    kind: "link",
    id,
    tagId,
    entityType: entity.entityType,
    entityId: entity.entityId,
    present,
    link: {
      id: `pending-${id}`,
      workspaceId,
      tagId,
      entityType: entity.entityType,
      entityId: entity.entityId,
      createdAt: new Date().toISOString(),
    },
    settledAt: null,
  });
  const input = { workspaceId, tagId, ...entity };
  void chain(linkKey(tagId, entity.entityType, entity.entityId), async () => {
    // A tag created a moment ago may not have its row yet; a tag whose create
    // failed never will (its own toast has said so).
    if (!(await (tagReady.get(tagId) ?? true))) {
      dropOp(workspaceId, op);
      return;
    }
    try {
      if (present) op.link = await runtime.tasks.attachTag(input);
      else await runtime.tasks.detachTag(input);
      settleOp(workspaceId, op);
    } catch (e) {
      dropOp(workspaceId, op);
      toast.error(present ? "Couldn’t add the tag" : "Couldn’t remove the tag", {
        description: errorText(e),
      });
    }
  });
}

/** Put a tag on an item (no-op if it's already there). */
export function attachTag(ctx: TagContext, entity: TagEntity, tagId: string): void {
  if (hasLink(ctx.workspaceId, tagId, entity)) return;
  writeLink(ctx, tagId, entity, true);
}

/** Take a tag off an item. The tag itself stays. */
export function detachTag(ctx: TagContext, entity: TagEntity, tagId: string): void {
  if (!hasLink(ctx.workspaceId, tagId, entity)) return;
  writeLink(ctx, tagId, entity, false);
}

/** Attach or detach, whichever the item doesn't have. */
export function toggleTag(ctx: TagContext, entity: TagEntity, tagId: string): void {
  writeLink(ctx, tagId, entity, !hasLink(ctx.workspaceId, tagId, entity));
}

/** Create a workspace tag (auto-coloured). Shown at once; resolves when saved. */
function createTag(ctx: TagContext, name: string): { tag: Tag; saved: Promise<boolean> } {
  const { runtime, workspaceId } = ctx;
  const now = new Date().toISOString();
  const tag: Tag = {
    id: crypto.randomUUID(),
    workspaceId,
    ownerId: ctx.userId ?? "",
    name,
    color: pickTagColor(getTagView(workspaceId).tags),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };
  const op = addOp<TagOp>(workspaceId, {
    kind: "tag",
    id: nextOpId++,
    tag,
    settledAt: null,
  });
  const saved = chain(tagChainKey(tag.id), () => runtime.tasks.upsertTag(tag)).then(
    (row) => {
      op.tag = row;
      settleOp(workspaceId, op);
      return true;
    },
    (e) => {
      dropOp(workspaceId, op);
      toast.error("Couldn’t create the tag", { description: errorText(e) });
      return false;
    },
  );
  tagReady.set(tag.id, saved);
  // Once the row exists, nothing needs to wait; a failed create stays marked.
  void saved.then((ok) => {
    if (ok && tagReady.get(tag.id) === saved) tagReady.delete(tag.id);
  });
  return { tag, saved };
}

/** Where `createOrAttachByName` attaches: an item, or one still being created. */
export type TagTarget = {
  entityType: string;
  /** The item's id, or a promise of it while it's being created (null: it wasn't). */
  entityId: string | PromiseLike<string | null>;
};

/**
 * Attach the live tag with this name (any case), or create it and attach it,
 * in one step. Works before the item exists: pass its id as a promise.
 * Returns the tag (to show as a chip right away), or null for a blank name.
 */
export function createOrAttachByName(ctx: TagContext, name: string, target: TagTarget): Tag | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const existing = findTagByName(getTagView(ctx.workspaceId).tags, trimmed);
  const created = existing ? null : createTag(ctx, trimmed);
  const tag = existing ?? (created as { tag: Tag }).tag;
  const { entityId, entityType } = target;
  if (typeof entityId === "string") {
    attachTag(ctx, { entityType, entityId }, tag.id);
    return tag;
  }
  void Promise.resolve(entityId).then(
    async (id) => {
      if (!id) {
        if (created) void discardIfUnused(ctx, tag.id, created.saved);
        return;
      }
      // A tag whose create failed has said so already; don't attach it.
      if (created && !(await created.saved)) return;
      attachTag(ctx, { entityType, entityId: id }, tag.id);
    },
    () => {
      if (created) void discardIfUnused(ctx, tag.id, created.saved);
    },
  );
  return tag;
}

/** A tag made for an item that was never created goes too, unless it's in use by then. */
async function discardIfUnused(ctx: TagContext, tagId: string, saved: Promise<boolean>) {
  const ws = workspace(ctx.workspaceId);
  const inUse = () =>
    getTagView(ctx.workspaceId).links.some((l) => l.tagId === tagId) ||
    ws.ops.some((op) => op.kind === "link" && op.tagId === tagId && op.settledAt === null);
  if (inUse() || !(await saved) || inUse()) return;
  const op = addOp<HideOp>(ctx.workspaceId, {
    kind: "hide",
    id: nextOpId++,
    tagId,
    settledAt: null,
  });
  try {
    await ctx.runtime.tasks.deleteTag({ workspaceId: ctx.workspaceId, tagId });
    settleOp(ctx.workspaceId, op);
  } catch {
    dropOp(ctx.workspaceId, op);
  }
}

/** Recolour a tag everywhere it shows. */
export function recolorTag(ctx: TagContext, tagId: string, color: string): void {
  const { runtime, workspaceId } = ctx;
  const current = getTagView(workspaceId).tags.find((t) => t.id === tagId);
  if (!current || current.color === color) return;
  const op = addOp<TagOp>(workspaceId, {
    kind: "tag",
    id: nextOpId++,
    tag: { ...current, color, updatedAt: new Date().toISOString() },
    settledAt: null,
  });
  void chain(tagChainKey(tagId), async () => {
    if (!(await (tagReady.get(tagId) ?? true))) {
      dropOp(workspaceId, op);
      return;
    }
    try {
      op.tag = await runtime.tasks.upsertTag(op.tag);
      settleOp(workspaceId, op);
    } catch (e) {
      dropOp(workspaceId, op);
      toast.error("Couldn’t recolor the tag", { description: errorText(e) });
    }
  });
}

/**
 * Delete a tag workspace-wide: it comes off everything at once, with Undo.
 * The server delete (which drops every attachment for good) runs only when
 * the Undo toast closes without Undo.
 */
export function deleteTag(ctx: TagContext, tagId: string): void {
  const { runtime, workspaceId } = ctx;
  const tag = getTagView(workspaceId).tags.find((t) => t.id === tagId);
  if (!tag) return;
  const op = addOp<HideOp>(workspaceId, {
    kind: "hide",
    id: nextOpId++,
    tagId,
    settledAt: null,
  });
  undoToast("Tag deleted", {
    description: `“${tag.name}” comes off everything it was tagged on.`,
    onUndo: () => dropOp(workspaceId, op),
    onCommit: () => {
      void (async () => {
        if (!(await (tagReady.get(tagId) ?? true))) {
          dropOp(workspaceId, op);
          return;
        }
        try {
          await runtime.tasks.deleteTag({ workspaceId, tagId });
          settleOp(workspaceId, op);
        } catch (e) {
          dropOp(workspaceId, op);
          toast.error("Couldn’t delete the tag", { description: errorText(e) });
        }
      })();
    },
  });
}

/** Who the store's data was read as (undefined: not told yet). */
let signedInAs: string | null | undefined;

/** Who is signed in: another person (or signing out) starts from an empty store. */
export function attachTagUser(userId: string | null): void {
  const first = signedInAs === undefined;
  if (userId === signedInAs) return;
  signedInAs = userId;
  if (!first) resetTagStore();
}

/** Forget everything (sign-in as someone else, sign-out, tests). */
export function resetTagStore(): void {
  workspaces.clear();
  tagReady.clear();
  writeChains.clear();
  for (const listener of listeners) listener();
}
