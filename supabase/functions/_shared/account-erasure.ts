/**
 * Account deletion for the delete-account Edge Function (DF-19h; erasure added 2026-10-07).
 *
 * `auth.admin.deleteUser` only removes what Postgres foreign keys cascade from
 * auth.users: the profile, every workspace the user owns (and everything in it),
 * and the user's memberships elsewhere. These live outside that cascade, so they
 * are removed explicitly, all of them BEFORE the auth user goes:
 *
 *   0. posthog        the app's usage analytics (PRIV-3): the PostHog person with the
 *                     user id as distinct id, and their events (posthog-erasure.ts).
 *   1. stripe         every Stripe customer for this user: live subscriptions are
 *                     cancelled, then the customer is deleted (Stripe drops its saved
 *                     cards with it).
 *   2. stripe_mirror  our stripe.* copy of those customers and their saved cards
 *                     (PRIV-2b, SQL account_scrub_stripe_mirror). Invoices stay.
 *   3. storage        profiles/{uid}/… and workspaces/{owned workspace}/… in the public
 *                     `avatars` bucket. Public files stay readable by URL until removed.
 *   4. booking        the user's booking links, the bookings and busy windows tied to
 *                     them, and their co-host seats on other people's links. No FK.
 *   5. integrations   user_integrations: the encrypted Google / Zoom tokens. No FK.
 *   6. contact_notes  the user's private notes on contacts, in any workspace. No FK.
 *   7. workspace_data what they leave in other people's workspaces (PRIV-2a, SQL
 *                     account_erase_workspace_data): private items go with every
 *                     trace, shared ones get a new owner, their tasks are unassigned.
 *   8. waitlist       public.waitlist + founders_interest rows for the account email.
 *
 * Every step is idempotent and the auth delete runs last, so a failure leaves the
 * account in place and a retry finishes the job. PostHog and Stripe run first: when
 * they fail, nothing in Moduo has been deleted yet.
 *
 * Plain TypeScript with injected clients (no Deno globals, no URL imports) so the
 * unit tests can run it: see account-erasure.test.ts. The real supabase-js and
 * Stripe clients satisfy the small interfaces below.
 */

import type { ErasurePostHog } from "./posthog-erasure.ts";

// ── The slices of supabase-js and Stripe this module uses ────────────────────

export type DbError = { message: string; code?: string };
export type DbResult = { data: unknown; error: DbError | null; count?: number | null };

/** A filtered PostgREST request: chain filters, then await it. */
export interface DbFilter extends PromiseLike<DbResult> {
  eq(column: string, value: string): DbFilter;
  neq(column: string, value: string): DbFilter;
  in(column: string, values: readonly string[]): DbFilter;
  is(column: string, value: null): DbFilter;
  ilike(column: string, pattern: string): DbFilter;
  order(column: string): DbFilter;
  range(from: number, to: number): DbFilter;
}

export type StorageEntry = { name: string; id: string | null };

export interface StorageBucket {
  list(
    prefix: string,
    options: { limit: number; offset: number },
  ): PromiseLike<{ data: StorageEntry[] | null; error: DbError | null }>;
  remove(paths: string[]): PromiseLike<{ error: DbError | null }>;
}

export interface ErasureDb {
  from(table: string): {
    select(columns: string, options?: { count: "exact"; head: true }): DbFilter;
    delete(): DbFilter;
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError | null }>;
  storage: { from(bucket: string): StorageBucket };
  auth: {
    admin: {
      deleteUser(id: string): PromiseLike<{ error: (DbError & { status?: number }) | null }>;
    };
  };
}

export interface ErasureStripe {
  customers: {
    retrieve(
      id: string,
    ): Promise<{ id: string; deleted?: unknown; metadata?: Record<string, string> }>;
    del(id: string): Promise<{ id: string; deleted?: unknown }>;
    search(params: {
      query: string;
      limit: number;
      page?: string;
    }): Promise<{ data: { id: string }[]; has_more: boolean; next_page?: string | null }>;
  };
  subscriptions: {
    list(params: {
      customer: string;
      status: "all";
      limit: number;
      starting_after?: string;
    }): Promise<{ data: { id: string; status: string }[]; has_more: boolean }>;
    cancel(id: string, params: { cancellation_details: { comment: string } }): Promise<unknown>;
  };
}

export type ErasureDeps = {
  db: ErasureDb;
  /** null when STRIPE_SECRET_KEY isn't configured. */
  stripe: ErasureStripe | null;
  /** null when the PostHog secrets aren't configured (posthog-erasure.ts). Required, so
   *  every caller of deleteAccount decides it rather than skipping it by omission. */
  posthog: ErasurePostHog | null;
  /** Rows per select page. PostgREST caps every response at 1000 rows; tests use less. */
  pageSize?: number;
};

/** `email` only when the account has confirmed it: it decides whose waitlist rows go. */
export type AccountUser = { id: string; email: string | null };

export type DeleteAccountResult =
  | { status: "blocked"; workspaces: { id: string; name: string }[] }
  | { status: "deleted"; warnings: string[] };

export type ErasureStep =
  | "check"
  | "posthog"
  | "stripe"
  | "stripe_mirror"
  | "storage"
  | "booking"
  | "integrations"
  | "contact_notes"
  | "workspace_data"
  | "waitlist"
  | "auth";

/** A step failed. Steps before it completed; the account itself still exists. */
export class ErasureError extends Error {
  readonly step: ErasureStep;

  constructor(step: ErasureStep, cause: unknown) {
    super(`${step}: ${errorMessage(cause)}`, { cause });
    this.name = "ErasureError";
    this.step = step;
  }
}

/** What the Danger zone shows when a step fails. */
export function erasureErrorMessage(step: ErasureStep): string {
  switch (step) {
    case "check":
      return "Couldn't check your workspaces. Your account wasn't deleted. Try again.";
    case "posthog":
      // Neutral: most people never shared analytics, and nothing was deleted yet.
      return "Something went wrong on our side. Your account wasn't deleted. Try again in a few minutes.";
    case "stripe":
      // Subscriptions are cancelled before the customer is deleted, so a failure
      // here can come after the plan already ended.
      return "Couldn't finish closing your billing at Stripe, so your account wasn't deleted. Your plan may already be cancelled. Try again in a few minutes.";
    default:
      return "Your account was only partly deleted. Try again to finish.";
  }
}

// ── The sole-owner guard ─────────────────────────────────────────────────────

/** A workspace the caller owns, with how many OTHER members it has. */
export type OwnedWorkspace = { id: string; name: string; otherMemberCount: number };

/** Sole-owner-of-shared blocks deletion: it would orphan teammates. Kept in lockstep
 *  with the client's pure `blockingWorkspaces` in src/features/settings/delete-account.ts. */
export function blockingWorkspaces(owned: OwnedWorkspace[]): OwnedWorkspace[] {
  return owned.filter((w) => w.otherMemberCount > 0);
}

export async function findBlockingWorkspaces(
  deps: ErasureDeps,
  userId: string,
): Promise<{ id: string; name: string }[]> {
  // Workspaces this user owns. `deleted_at is null` excludes a workspace the user
  // already soft-deleted: it's invisible to its members, and the account delete
  // hard-cascades it (+ its lingering member rows) anyway, so it can't orphan anyone.
  const owned = await selectAll<{ id: string; name: string }>(deps, "workspaces", "id, name", (q) =>
    q.eq("owner_id", userId).is("deleted_at", null),
  );

  // Count OTHER members per owned workspace with an EXACT head-count. A single
  // `.in(...).select()` would rely on PostgREST's 1000-row cap: a workspace whose
  // member rows page out would compute 0 others and false-safe through the block,
  // orphaning teammates. Per-workspace counts have no such cap.
  const withCounts: OwnedWorkspace[] = [];
  for (const w of owned) {
    const { count, error } = await deps.db
      .from("workspace_members")
      .select("user_id", { count: "exact", head: true })
      .eq("workspace_id", w.id)
      .neq("user_id", userId);
    if (error) throw new Error(`workspace_members: ${error.message}`);
    withCounts.push({ ...w, otherMemberCount: count ?? 0 });
  }
  return blockingWorkspaces(withCounts).map(({ id, name }) => ({ id, name }));
}

// ── The whole flow ───────────────────────────────────────────────────────────

/**
 * Blocked (409) when the user solely owns a workspace that has other members;
 * otherwise erases everything outside the FK cascade, then deletes the auth user.
 * Throws ErasureError when a step fails.
 */
export async function deleteAccount(
  deps: ErasureDeps,
  user: AccountUser,
): Promise<DeleteAccountResult> {
  const blocking = await step("check", () => findBlockingWorkspaces(deps, user.id));
  if (blocking.length > 0) return { status: "blocked", workspaces: blocking };
  // The SQL side runs after Stripe, which can't be undone: a dry run of both functions
  // now fails the deletion while nothing is gone (e.g. a migration not yet applied).
  await step("check", () => previewErasureSql(deps.db, user.id));

  const warnings: string[] = [];
  // Analytics first: an outage there leaves everything else, billing included, untouched.
  await step("posthog", () => eraseAnalytics(deps, user.id, warnings));
  const stripeCustomers = await step("stripe", () => closeStripeBilling(deps, user.id, warnings));
  // After the Stripe delete, so the webhooks it causes are older than the wipe.
  await step("stripe_mirror", () => wipeStripeCopy(deps.db, user.id, stripeCustomers, warnings));
  await step("storage", () => removeStoredImages(deps, user.id));
  await step("booking", () => deleteBookingData(deps, user.id));
  await step("integrations", () =>
    deleteRows(deps.db, "user_integrations", (q) => q.eq("user_id", user.id)),
  );
  // Private by construction, so nobody else could use them. Notes in the user's own
  // workspaces would go with the contacts anyway; these are the ones elsewhere.
  await step("contact_notes", () =>
    deleteRows(deps.db, "contact_private_notes", (q) => q.eq("user_id", user.id)),
  );
  // Before the auth delete: afterwards their rows can't be told apart (created_by goes NULL).
  await step("workspace_data", () =>
    runErasureSql(deps.db, "account_erase_workspace_data", user.id),
  );
  await step("waitlist", () => deleteWaitlistEntries(deps, user.email));
  // Last, so every step above can be retried: the FK cascade takes the profile,
  // owned workspaces with everything in them, and the user's memberships elsewhere.
  await step("auth", () => deleteAuthUser(deps.db, user.id));
  return { status: "deleted", warnings };
}

async function step<T>(name: ErasureStep, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw new ErasureError(name, err);
  }
}

// ── PostHog (PRIV-3) ─────────────────────────────────────────────────────────

async function eraseAnalytics(
  deps: ErasureDeps,
  userId: string,
  warnings: string[],
): Promise<void> {
  // Edge Function entry points aren't type-checked, so a caller that forgot the field
  // fails here instead of silently skipping the erasure as "not configured".
  if (deps.posthog === undefined) throw new Error("ErasureDeps.posthog is missing");
  if (!deps.posthog) {
    warnings.push("posthog_not_configured");
    return;
  }
  const result = await deps.posthog.erasePerson(userId);
  // A wrong key, scope, project or host can't be fixed by retrying, and it must not
  // block every deletion. The warning names the user, so the analytics can still be
  // deleted by hand. A network error, timeout, rate limit or 5xx throws and fails the step.
  if (result.status === "refused") warnings.push(`posthog_refused: ${result.httpStatus}`);
}

// ── Stripe ───────────────────────────────────────────────────────────────────

const ENDED_SUBSCRIPTION = new Set(["canceled", "incomplete_expired"]);

/** Returns the user's customers that are gone at Stripe now (deleted here, or by an
 *  earlier run), for the wipe of our copy. */
async function closeStripeBilling(
  deps: ErasureDeps,
  userId: string,
  warnings: string[],
): Promise<string[]> {
  const { data, error } = await deps.db
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", userId);
  if (error) throw new Error(`profiles: ${error.message}`);
  const stored = ((data ?? []) as { stripe_customer_id: string | null }[])[0]?.stripe_customer_id;

  const { stripe } = deps;
  if (!stripe) {
    // No key, no way to reach the customer the profile points at: refuse rather
    // than report a deletion that left the billing record behind.
    if (stored) throw new Error("STRIPE_SECRET_KEY is not configured");
    warnings.push("stripe_not_configured");
    return [];
  }

  const customerIds = new Set<string>(stored ? [stored] : []);
  try {
    for (const id of await customersTaggedWith(stripe, userId)) customerIds.add(id);
  } catch (err) {
    // A rate limit or outage fails the step (retry). A permanent refusal, like a
    // restricted key without search, must not block every deletion: the profile's
    // customer still goes. Extras only exist after a failed profile write or two
    // first sign-ins racing getOrCreateCustomer.
    if (!isPermanentStripeError(err)) throw err;
    warnings.push(`stripe_search_failed: ${errorMessage(err)}`);
  }
  const gone: string[] = [];
  for (const id of customerIds) {
    if (await deleteCustomer(stripe, id, userId, warnings)) gone.push(id);
  }
  return gone;
}

/** Customers getOrCreateCustomer tagged with this user (_shared/billing.ts). */
async function customersTaggedWith(stripe: ErasureStripe, userId: string): Promise<string[]> {
  const ids: string[] = [];
  let page: string | undefined;
  for (let i = 0; i < 10; i++) {
    const res = await stripe.customers.search({
      query: `metadata['supabase_user_id']:'${userId}'`,
      limit: 100,
      ...(page ? { page } : {}),
    });
    ids.push(...res.data.map((c) => c.id));
    if (!res.has_more || !res.next_page) break;
    page = res.next_page;
  }
  return ids;
}

/** True when the customer is the user's and is gone at Stripe afterwards. */
async function deleteCustomer(
  stripe: ErasureStripe,
  id: string,
  userId: string,
  warnings: string[],
): Promise<boolean> {
  let customer: Awaited<ReturnType<ErasureStripe["customers"]["retrieve"]>>;
  try {
    customer = await stripe.customers.retrieve(id);
  } catch (err) {
    if (!isMissingStripeObject(err)) throw err;
    // Not in this Stripe account (e.g. an id from the other mode): nothing to delete.
    warnings.push(`stripe_customer_missing: ${id}`);
    return false;
  }
  if (customer.deleted === true) return true; // a retry: already gone

  // profiles.stripe_customer_id was client-writable until 20261006120000, and
  // recompute_entitlement copies it from any subscription tagged with the user.
  // Never cancel or delete a customer that Stripe says belongs to someone else.
  const owner = customer.metadata?.supabase_user_id;
  if (owner && owner !== userId) {
    warnings.push(`stripe_customer_not_theirs: ${id}`);
    return false;
  }

  // Deleting a customer cancels its subscriptions too; cancelling first is explicit
  // and leaves a reason on each subscription. No proration, no final invoice.
  let after: string | undefined;
  do {
    const page = await stripe.subscriptions.list({
      customer: id,
      status: "all",
      limit: 100,
      ...(after ? { starting_after: after } : {}),
    });
    for (const sub of page.data) {
      if (ENDED_SUBSCRIPTION.has(sub.status)) continue;
      await stripe.subscriptions.cancel(sub.id, {
        cancellation_details: { comment: "Moduo account deleted" },
      });
    }
    after = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (after);

  try {
    await stripe.customers.del(id);
  } catch (err) {
    if (!isMissingStripeObject(err)) throw err;
  }
  return true;
}

function stripeErrorFields(err: unknown): {
  code?: unknown;
  statusCode?: unknown;
  message?: unknown;
} {
  return (err ?? {}) as { code?: unknown; statusCode?: unknown; message?: unknown };
}

function isMissingStripeObject(err: unknown): boolean {
  const e = stripeErrorFields(err);
  return (
    e.code === "resource_missing" ||
    e.statusCode === 404 ||
    /no such customer/i.test(String(e.message ?? ""))
  );
}

/** 400 / 403: Stripe refused the request itself. A retry won't change that. */
function isPermanentStripeError(err: unknown): boolean {
  const { statusCode } = stripeErrorFields(err);
  return statusCode === 400 || statusCode === 403;
}

// ── The SQL side (PRIV-2) ────────────────────────────────────────────────────

const ERASURE_SQL = ["account_scrub_stripe_mirror", "account_erase_workspace_data"] as const;

async function previewErasureSql(db: ErasureDb, userId: string): Promise<void> {
  for (const fn of ERASURE_SQL) {
    const { data, error } = await db.rpc(fn, { p_user: userId, p_preview: true });
    if (error) throw new Error(`${fn}: ${error.message}`);
    if ((data as { preview?: unknown } | null)?.preview !== true) {
      throw new Error(`${fn}: no preview answer`);
    }
  }
}

/** Both functions preview unless told otherwise, so a deletion run passes false and
 *  refuses an answer that says it was only a preview. Each is one transaction and a
 *  retry finds nothing left to do. */
async function runErasureSql(
  db: ErasureDb,
  fn: (typeof ERASURE_SQL)[number],
  userId: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc(fn, { ...args, p_user: userId, p_preview: false });
  if (error) throw new Error(`${fn}: ${error.message}`);
  const result = (data ?? {}) as Record<string, unknown>;
  if (result.preview !== false) {
    throw new Error(`${fn}: answered as a preview, nothing was deleted`);
  }
  return result;
}

/** Our stripe.* copy of the customers the Stripe step deleted, and of any others it
 *  holds for the user. */
async function wipeStripeCopy(
  db: ErasureDb,
  userId: string,
  deletedCustomers: string[],
  warnings: string[],
): Promise<void> {
  const result = await runErasureSql(db, "account_scrub_stripe_mirror", userId, {
    p_customer_ids: deletedCustomers,
  });
  // No stripe.customers table: a project without the Stripe sync, or one that lost it.
  // Nothing to wipe, but it shouldn't pass unnoticed.
  if (result.stripe_mirror === false) warnings.push("stripe_mirror_missing");
}

// ── Storage ──────────────────────────────────────────────────────────────────

/** Profile pictures and workspace logos (src/features/branding/image-asset.ts). */
const AVATAR_BUCKET = "avatars";
const STORAGE_PAGE = 100;

async function removeStoredImages(deps: ErasureDeps, userId: string): Promise<void> {
  // Every workspace the cascade will take, soft-deleted ones included.
  const owned = await selectAll<{ id: string }>(deps, "workspaces", "id", (q) =>
    q.eq("owner_id", userId),
  );
  const bucket = deps.db.storage.from(AVATAR_BUCKET);
  const paths: string[] = [];
  for (const prefix of [`profiles/${userId}`, ...owned.map((w) => `workspaces/${w.id}`)]) {
    paths.push(...(await listFiles(bucket, prefix)));
  }
  for (const batch of chunks(paths, STORAGE_PAGE)) {
    const { error } = await bucket.remove(batch);
    if (error) throw new Error(`storage remove: ${error.message}`);
  }
}

/** Every file under a folder. Listing (not guessing avatar.{ext}) also catches
 *  files a future upload path adds. */
async function listFiles(bucket: StorageBucket, prefix: string): Promise<string[]> {
  const files: string[] = [];
  for (let offset = 0; ; offset += STORAGE_PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: STORAGE_PAGE, offset });
    if (error) throw new Error(`storage list ${prefix}: ${error.message}`);
    const entries = data ?? [];
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      // Storage lists a sub-folder as an entry without an id.
      if (entry.id === null) files.push(...(await listFiles(bucket, path)));
      else files.push(path);
    }
    if (entries.length < STORAGE_PAGE) return files;
  }
}

// ── Booking links ────────────────────────────────────────────────────────────

const IN_BATCH = 100; // keeps `in.(…)` filters well under URL length limits

async function deleteBookingData(deps: ErasureDeps, userId: string): Promise<void> {
  // owner_user_id (a legacy column) has no FK to the user, so the cascade never
  // reaches these. Soft-deleted links included: their bookings still hold guest details.
  const links = await selectAll<{ slot_id: string | null }>(
    deps,
    "exposed_slot_links",
    "id, slot_id",
    (q) => q.eq("owner_user_id", userId),
  );
  const slotIds = [...new Set(links.map((l) => l.slot_id).filter((s): s is string => !!s))];

  // Bookings and busy windows point at a link by slot_id. A slot id is one link's,
  // but never delete rows that another host's link also points at.
  const elsewhere = new Set<string>();
  for (const batch of chunks(slotIds, IN_BATCH)) {
    const rows = await selectAll<{ slot_id: string }>(
      deps,
      "exposed_slot_links",
      "id, slot_id",
      (q) => q.in("slot_id", batch).neq("owner_user_id", userId),
    );
    for (const row of rows) elsewhere.add(row.slot_id);
  }
  const ownSlotIds = slotIds.filter((s) => !elsewhere.has(s));
  const deleteBySlot = async (table: string) => {
    for (const batch of chunks(ownSlotIds, IN_BATCH)) {
      await deleteRows(deps.db, table, (q) => q.in("slot_id", batch));
    }
  };

  // Bookings go while the links still exist, so a failure here can be retried.
  await deleteBySlot("slot_bookings");
  await deleteBySlot("slot_conflict_windows");
  // Co-host seats on other people's links; seats on the user's own links go with
  // the links (booking_link_hosts.link_id cascades).
  await deleteRows(deps.db, "booking_link_hosts", (q) => q.eq("user_id", userId));
  await deleteRows(deps.db, "exposed_slot_links", (q) => q.eq("owner_user_id", userId));
  // A guest who booked between the first delete and the links going would leave a
  // booking with no link to find it by. Sweep once more.
  await deleteBySlot("slot_bookings");
}

// ── Waitlist ─────────────────────────────────────────────────────────────────

async function deleteWaitlistEntries(deps: ErasureDeps, rawEmail: string | null): Promise<void> {
  const email = rawEmail?.trim().toLowerCase();
  if (!email) return;
  // waitlist_join stores the address trimmed + lowercased (a CHECK enforces it).
  await deleteRows(deps.db, "waitlist", (q) => q.eq("email", email));

  // founders_interest isn't normalized: issue-founder-coupon stores the address as
  // the admin typed it. Match case-insensitively, then keep only exact matches:
  // `_` and `%` in an address can only make ilike match more, never less.
  const rows = await selectAll<{ id: string; email: string | null }>(
    deps,
    "founders_interest",
    "id, email",
    (q) => q.ilike("email", email),
  );
  const ids = rows.filter((r) => r.email?.trim().toLowerCase() === email).map((r) => r.id);
  for (const batch of chunks(ids, IN_BATCH)) {
    await deleteRows(deps.db, "founders_interest", (q) => q.in("id", batch));
  }
}

// ── Auth user ────────────────────────────────────────────────────────────────

async function deleteAuthUser(db: ErasureDb, userId: string): Promise<void> {
  const { error } = await db.auth.admin.deleteUser(userId);
  // 404: a concurrent request already finished the delete.
  if (error && error.status !== 404) throw new Error(error.message);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const POSTGREST_MAX_ROWS = 1000;

/** Every matching row. PostgREST silently caps a response at 1000 rows, so page
 *  with `.range()` under a total order (docs/gotchas.md, SCALE-1). */
async function selectAll<Row>(
  deps: ErasureDeps,
  table: string,
  columns: string,
  where: (q: DbFilter) => DbFilter,
): Promise<Row[]> {
  const size = deps.pageSize ?? POSTGREST_MAX_ROWS;
  const rows: Row[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await where(deps.db.from(table).select(columns))
      .order("id")
      .range(from, from + size - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < size) return rows;
  }
}

async function deleteRows(
  db: ErasureDb,
  table: string,
  where: (q: DbFilter) => DbFilter,
): Promise<void> {
  const { error } = await where(db.from(table).delete());
  if (error) throw new Error(`${table}: ${error.message}`);
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
