import { describe, expect, it } from "@rstest/core";

import {
  type DbFilter,
  type DbResult,
  deleteAccount,
  type ErasureDb,
  type ErasureDeps,
  ErasureError,
  type ErasureStep,
  type ErasureStripe,
  erasureErrorMessage,
  type StorageBucket,
  type StorageEntry,
} from "./account-erasure.ts";
import type { ErasurePostHog, PostHogEraseResult } from "./posthog-erasure.ts";

// ── In-memory stand-ins for supabase-js and Stripe ────────────────────────────

type Row = Record<string, unknown>;

/** SQL LIKE (`%`, `_`) plus PostgREST's `*` alias for `%`, case-insensitive. */
function likeToRegExp(pattern: string): RegExp {
  const body = [...pattern]
    .map((ch) => {
      if (ch === "%" || ch === "*") return ".*";
      if (ch === "_") return ".";
      return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${body}$`, "is");
}

class FakeQuery implements DbFilter {
  private readonly tests: ((row: Row) => boolean)[] = [];
  private window: [number, number] | null = null;
  private sortKey: string | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
    private readonly mode: "select" | "count" | "delete",
  ) {}

  eq(column: string, value: string): DbFilter {
    this.tests.push((row) => row[column] === value);
    return this;
  }

  neq(column: string, value: string): DbFilter {
    // SQL: NULL <> 'x' is not true, so NULL never matches.
    this.tests.push((row) => row[column] != null && row[column] !== value);
    return this;
  }

  in(column: string, values: readonly string[]): DbFilter {
    const set = new Set(values);
    this.tests.push((row) => set.has(String(row[column])));
    return this;
  }

  is(column: string, value: null): DbFilter {
    this.tests.push((row) => (row[column] ?? null) === value);
    return this;
  }

  ilike(column: string, pattern: string): DbFilter {
    const re = likeToRegExp(pattern);
    this.tests.push((row) => typeof row[column] === "string" && re.test(row[column] as string));
    return this;
  }

  order(column: string): DbFilter {
    this.sortKey = column;
    return this;
  }

  range(from: number, to: number): DbFilter {
    this.window = [from, to];
    return this;
  }

  /** Awaitable like supabase-js's builders. */
  then<A = DbResult, B = never>(
    onfulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(onfulfilled, onrejected);
  }

  private run(): DbResult {
    const op = this.mode === "delete" ? "delete" : "select";
    if (this.db.fail?.table === this.table && this.db.fail.op === op) {
      return { data: null, error: { message: `${op} ${this.table} failed` } };
    }
    const all = this.db.rows(this.table);
    const matched = all.filter((row) => this.tests.every((test) => test(row)));
    if (this.mode === "count") return { data: null, error: null, count: matched.length };
    if (this.mode === "delete") {
      this.db.tables[this.table] = all.filter((row) => !matched.includes(row));
      this.db.log.push(`delete ${this.table}`);
      this.db.afterDelete?.(this.table);
      return { data: null, error: null };
    }
    const key = this.sortKey;
    const sorted = key
      ? [...matched].sort((a, b) => String(a[key]).localeCompare(String(b[key])))
      : matched;
    // PostgREST answers at most maxRows per request, whatever range was asked for.
    const [from, to] = this.window ?? [0, Number.POSITIVE_INFINITY];
    return { data: sorted.slice(from, Math.min(to + 1, from + this.db.maxRows)), error: null };
  }
}

class FakeBucket implements StorageBucket {
  constructor(
    private readonly db: FakeDb,
    readonly files: Set<string>,
  ) {}

  async list(prefix: string, options: { limit: number; offset: number }) {
    const children = new Map<string, StorageEntry>();
    for (const path of this.files) {
      if (!path.startsWith(`${prefix}/`)) continue;
      const [name, ...rest] = path.slice(prefix.length + 1).split("/");
      // Like Storage: a sub-folder is an entry with no id.
      children.set(name, { name, id: rest.length > 0 ? null : `object:${path}` });
    }
    const sorted = [...children.values()].sort((a, b) => a.name.localeCompare(b.name));
    return { data: sorted.slice(options.offset, options.offset + options.limit), error: null };
  }

  async remove(paths: string[]) {
    if (this.db.storageFails) return { error: { message: "storage unavailable" } };
    for (const path of paths) this.files.delete(path);
    this.db.log.push("storage remove");
    return { error: null };
  }
}

class FakeDb implements ErasureDb {
  /** Every write, in order: "delete <table>", "storage remove", "auth delete". */
  log: string[] = [];
  fail: { table: string; op: "select" | "delete" } | null = null;
  storageFails = false;
  /** PostgREST's per-response row cap (1000 for real). */
  maxRows = 1000;
  /** Runs after each delete: lets a test act like a concurrent request. */
  afterDelete: ((table: string) => void) | null = null;
  users = new Set<string>();
  buckets = new Map<string, FakeBucket>();

  constructor(public tables: Record<string, Row[]>) {}

  rows(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  bucket(name: string): FakeBucket {
    let bucket = this.buckets.get(name);
    if (!bucket) {
      bucket = new FakeBucket(this, new Set());
      this.buckets.set(name, bucket);
    }
    return bucket;
  }

  from(table: string) {
    return {
      select: (_columns: string, options?: { count: "exact"; head: true }) =>
        new FakeQuery(this, table, options?.head ? "count" : "select"),
      delete: () => new FakeQuery(this, table, "delete"),
    };
  }

  storage = { from: (name: string) => this.bucket(name) };

  auth = {
    admin: {
      deleteUser: async (id: string) => {
        if (!this.users.has(id)) return { error: { message: "User not found", status: 404 } };
        this.users.delete(id);
        this.log.push("auth delete");
        return { error: null };
      },
    },
  };
}

type FakeCustomer = { id: string; userId: string | null; deleted: boolean };

class FakeStripe implements ErasureStripe {
  customersById = new Map<string, FakeCustomer>();
  subscriptionsById = new Map<string, { id: string; customer: string; status: string }>();
  /** Every write: "cancel <sub>", "del <customer>". */
  log: string[] = [];
  /** Stripe pages lists and searches; tests shrink the page to exercise paging. */
  pageSize = 100;
  searchError: Error | null = null;
  deleteFails = false;

  addCustomer(id: string, userId: string | null, subscriptions: [string, string][] = []) {
    this.customersById.set(id, { id, userId, deleted: false });
    for (const [subId, status] of subscriptions) {
      this.subscriptionsById.set(subId, { id: subId, customer: id, status });
    }
  }

  customers = {
    retrieve: async (id: string) => {
      const customer = this.customersById.get(id);
      if (!customer) throw stripeError(`No such customer: '${id}'`, 404, "resource_missing");
      if (customer.deleted) return { id, deleted: true };
      const metadata: Record<string, string> = customer.userId
        ? { supabase_user_id: customer.userId }
        : {};
      return { id, metadata };
    },
    del: async (id: string) => {
      if (this.deleteFails) throw stripeError("Stripe is unavailable", 500);
      const customer = this.customersById.get(id);
      if (!customer || customer.deleted) {
        throw stripeError(`No such customer: '${id}'`, 404, "resource_missing");
      }
      customer.deleted = true;
      for (const sub of this.subscriptionsById.values()) {
        if (sub.customer === id) sub.status = "canceled";
      }
      this.log.push(`del ${id}`);
      return { id, deleted: true };
    },
    search: async (params: { query: string; limit: number; page?: string }) => {
      if (this.searchError) throw this.searchError;
      const userId = /metadata\['supabase_user_id'\]:'([^']+)'/.exec(params.query)?.[1];
      const all = [...this.customersById.values()]
        .filter((c) => !c.deleted && c.userId === userId)
        .map((c) => ({ id: c.id }));
      const start = Number(params.page ?? 0);
      const end = start + Math.min(params.limit, this.pageSize);
      const more = end < all.length;
      return { data: all.slice(start, end), has_more: more, next_page: more ? String(end) : null };
    },
  };

  subscriptions = {
    list: async (params: {
      customer: string;
      status: "all";
      limit: number;
      starting_after?: string;
    }) => {
      const all = [...this.subscriptionsById.values()]
        .filter((sub) => sub.customer === params.customer)
        .sort((a, b) => a.id.localeCompare(b.id));
      const start = params.starting_after
        ? all.findIndex((sub) => sub.id === params.starting_after) + 1
        : 0;
      const end = start + Math.min(params.limit, this.pageSize);
      return { data: all.slice(start, end).map((sub) => ({ ...sub })), has_more: end < all.length };
    },
    cancel: async (id: string, params: { cancellation_details: { comment: string } }) => {
      const sub = this.subscriptionsById.get(id);
      if (!sub) throw stripeError(`No such subscription: '${id}'`, 404, "resource_missing");
      sub.status = "canceled";
      this.log.push(`cancel ${id} (${params.cancellation_details.comment})`);
      return sub;
    },
  };
}

/** PostHog's bulk delete, as account-erasure sees it. */
class FakePostHog implements ErasurePostHog {
  /** Every request: "erase <distinct id>". */
  log: string[] = [];
  /** What PostHog answers next: "throw" stands for a network error, a 429 or a 5xx. */
  outcome: "queued" | "refused" | "throw" = "queued";

  async erasePerson(distinctId: string): Promise<PostHogEraseResult> {
    this.log.push(`erase ${distinctId}`);
    if (this.outcome === "throw") throw new Error("PostHog 503: busy");
    if (this.outcome === "refused") return { status: "refused", httpStatus: 403 };
    return { status: "queued" };
  }
}

function stripeError(message: string, statusCode: number, code?: string) {
  return Object.assign(new Error(message), { statusCode, code });
}

// ── A workspace world: the user deleting their account, and people who stay ───

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const COHOST = "33333333-3333-4333-8333-333333333333";
const MY_EMAIL = "me@example.com";

function world() {
  const db = new FakeDb({
    profiles: [
      { id: ME, stripe_customer_id: "cus_me" },
      { id: OTHER, stripe_customer_id: "cus_other" },
    ],
    workspaces: [
      { id: "ws-solo", name: "Solo", owner_id: ME, deleted_at: null },
      { id: "ws-trashed", name: "Old", owner_id: ME, deleted_at: "2026-09-01T10:00:00Z" },
      { id: "ws-team", name: "Team", owner_id: OTHER, deleted_at: null },
    ],
    workspace_members: [
      { workspace_id: "ws-solo", user_id: ME },
      // Soft-deleted already: invisible to OTHER, so it doesn't block.
      { workspace_id: "ws-trashed", user_id: ME },
      { workspace_id: "ws-trashed", user_id: OTHER },
      { workspace_id: "ws-team", user_id: OTHER },
      { workspace_id: "ws-team", user_id: ME },
    ],
    exposed_slot_links: [
      { id: "link-mine", slot_id: "slot-mine", owner_user_id: ME, deleted_at: null },
      {
        id: "link-mine-old",
        slot_id: "slot-mine-old",
        owner_user_id: ME,
        deleted_at: "2026-09-02T10:00:00Z",
      },
      { id: "link-other", slot_id: "slot-other", owner_user_id: OTHER, deleted_at: null },
    ],
    slot_bookings: [
      { id: "booking-1", slot_id: "slot-mine", attendee_email: "guest1@example.com" },
      { id: "booking-2", slot_id: "slot-mine-old", attendee_email: "guest2@example.com" },
      { id: "booking-3", slot_id: "slot-other", attendee_email: "guest3@example.com" },
    ],
    slot_conflict_windows: [
      { id: "busy-1", slot_id: "slot-mine-old" },
      { id: "busy-2", slot_id: "slot-other" },
    ],
    booking_link_hosts: [
      { link_id: "link-other", user_id: ME, status: "pending" },
      { link_id: "link-other", user_id: COHOST, status: "accepted" },
    ],
    user_integrations: [
      { id: "int-1", user_id: ME, provider: "google_calendar", account_key: "me@gmail.com" },
      { id: "int-2", user_id: ME, provider: "zoom", account_key: "" },
      { id: "int-3", user_id: OTHER, provider: "google_calendar", account_key: "o@gmail.com" },
    ],
    contact_private_notes: [
      { contact_id: "contact-in-team", user_id: ME, body: "met at the conference" },
      { contact_id: "contact-in-team", user_id: OTHER, body: "owes us a reply" },
    ],
    waitlist: [
      { id: "wait-1", email: MY_EMAIL },
      { id: "wait-2", email: "other@example.com" },
    ],
    founders_interest: [
      { id: "found-1", email: MY_EMAIL },
      { id: "found-2", email: "other@example.com" },
    ],
  });
  db.users.add(ME);
  db.users.add(OTHER);
  for (const path of [
    `profiles/${ME}/avatar.png`,
    `profiles/${OTHER}/avatar.jpg`,
    "workspaces/ws-solo/logo.png",
    "workspaces/ws-trashed/logo.webp",
    "workspaces/ws-team/logo.png",
  ]) {
    db.bucket("avatars").files.add(path);
  }

  const stripe = new FakeStripe();
  stripe.addCustomer("cus_me", ME, [
    ["sub_me_old", "canceled"],
    ["sub_me", "trialing"],
  ]);
  stripe.addCustomer("cus_other", OTHER, [["sub_other", "active"]]);

  const posthog = new FakePostHog();
  const deps: ErasureDeps = { db, stripe, posthog };
  return { db, stripe, posthog, deps };
}

const me = { id: ME, email: MY_EMAIL };
const ids = (rows: Row[]) => rows.map((row) => row.id);
const avatarFiles = (db: FakeDb) => [...db.bucket("avatars").files].sort();

async function failedStep(run: Promise<unknown>): Promise<ErasureStep> {
  const err = await run.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ErasureError);
  return (err as ErasureError).step;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("deleteAccount — sole-owner block (409)", () => {
  it("blocks a sole owner of a workspace with other members before touching anything", async () => {
    const { db, stripe, posthog, deps } = world();
    db.tables.workspace_members.push({ workspace_id: "ws-solo", user_id: OTHER });

    const result = await deleteAccount(deps, me);

    expect(result).toEqual({ status: "blocked", workspaces: [{ id: "ws-solo", name: "Solo" }] });
    expect(db.log).toEqual([]);
    expect(stripe.log).toEqual([]);
    expect(posthog.log).toEqual([]);
    expect(db.users.has(ME)).toBe(true);
    expect(avatarFiles(db)).toContain(`profiles/${ME}/avatar.png`);
  });

  it("does not count the user's own membership or a workspace they already soft-deleted", async () => {
    const { deps } = world();
    const result = await deleteAccount(deps, me);
    expect(result.status).toBe("deleted");
  });
});

describe("deleteAccount — erasing what the FK cascade can't reach", () => {
  it("cancels the live Stripe subscription, then deletes the customer", async () => {
    const { stripe, deps } = world();

    await deleteAccount(deps, me);

    expect(stripe.log).toEqual(["cancel sub_me (Moduo account deleted)", "del cus_me"]);
    expect(stripe.customersById.get("cus_me")?.deleted).toBe(true);
    expect(stripe.customersById.get("cus_other")?.deleted).toBe(false);
    expect(stripe.subscriptionsById.get("sub_other")?.status).toBe("active");
  });

  it("removes the profile picture and the logo of every owned workspace, soft-deleted too", async () => {
    const { db, deps } = world();
    db.bucket("avatars").files.add(`profiles/${ME}/older/avatar.gif`); // a nested folder

    await deleteAccount(deps, me);

    expect(avatarFiles(db)).toEqual([
      `profiles/${OTHER}/avatar.jpg`,
      "workspaces/ws-team/logo.png",
    ]);
  });

  it("deletes the user's booking links with their bookings and busy windows, and their co-host seats", async () => {
    const { db, deps } = world();

    await deleteAccount(deps, me);

    expect(ids(db.rows("exposed_slot_links"))).toEqual(["link-other"]);
    expect(ids(db.rows("slot_bookings"))).toEqual(["booking-3"]);
    expect(ids(db.rows("slot_conflict_windows"))).toEqual(["busy-2"]);
    expect(db.rows("booking_link_hosts")).toEqual([
      { link_id: "link-other", user_id: COHOST, status: "accepted" },
    ]);
  });

  it("catches a booking made while the links were being deleted", async () => {
    const { db, deps } = world();
    let booked = false;
    db.afterDelete = (table) => {
      // A guest lands a booking right after the first bookings delete.
      if (table === "slot_bookings" && !booked) {
        booked = true;
        db.tables.slot_bookings.push({ id: "booking-late", slot_id: "slot-mine" });
      }
    };

    await deleteAccount(deps, me);

    expect(ids(db.rows("slot_bookings"))).toEqual(["booking-3"]);
  });

  it("deletes the user's integration tokens and private contact notes, and nobody else's", async () => {
    const { db, deps } = world();

    await deleteAccount(deps, me);

    expect(ids(db.rows("user_integrations"))).toEqual(["int-3"]);
    expect(db.rows("contact_private_notes").map((row) => row.user_id)).toEqual([OTHER]);
  });

  it("deletes waitlist and founders rows for the email, whatever case founders stored", async () => {
    const { db, deps } = world();
    db.tables.founders_interest.push({ id: "found-3", email: "Me@Example.com" });

    await deleteAccount(deps, me);

    expect(ids(db.rows("waitlist"))).toEqual(["wait-2"]);
    expect(ids(db.rows("founders_interest"))).toEqual(["found-2"]);
  });

  it("never deletes a founders row that only matches through a LIKE wildcard", async () => {
    const { db, deps } = world();
    // ilike 'm_e@example.com' also matches 'mxe@example.com'.
    db.tables.founders_interest.push(
      { id: "found-us", email: "m_e@example.com" },
      { id: "found-lookalike", email: "mxe@example.com" },
    );

    await deleteAccount(deps, { id: ME, email: "m_e@example.com" });

    expect(ids(db.rows("founders_interest"))).toEqual(["found-1", "found-2", "found-lookalike"]);
  });

  it("matches the waitlist email trimmed and lowercased, and skips it without an email", async () => {
    const shouting = world();
    await deleteAccount(shouting.deps, { id: ME, email: "  Me@Example.COM " });
    expect(ids(shouting.db.rows("waitlist"))).toEqual(["wait-2"]);

    const noEmail = world();
    const result = await deleteAccount(noEmail.deps, { id: ME, email: null });
    expect(result.status).toBe("deleted");
    expect(ids(noEmail.db.rows("waitlist"))).toEqual(["wait-1", "wait-2"]);
    expect(ids(noEmail.db.rows("founders_interest"))).toEqual(["found-1", "found-2"]);
  });

  it("deletes the auth user last, after every other step", async () => {
    const { db, deps } = world();

    const result = await deleteAccount(deps, me);

    expect(result).toEqual({ status: "deleted", warnings: [] });
    expect(db.users.has(ME)).toBe(false);
    expect(db.users.has(OTHER)).toBe(true);
    expect(db.log.at(-1)).toBe("auth delete");
    expect(db.log.filter((entry) => entry === "auth delete")).toHaveLength(1);
  });

  it("never deletes bookings that another host's link also points at", async () => {
    const { db, deps } = world();
    db.tables.exposed_slot_links.push({
      id: "link-clash",
      slot_id: "slot-mine",
      owner_user_id: OTHER,
      deleted_at: null,
    });

    await deleteAccount(deps, me);

    expect(ids(db.rows("slot_bookings"))).toEqual(["booking-1", "booking-3"]);
    expect(ids(db.rows("exposed_slot_links"))).toEqual(["link-other", "link-clash"]);
  });

  it("pages past PostgREST's row cap instead of silently stopping at it", async () => {
    const { db, deps } = world();
    db.maxRows = 2;
    for (const n of [1, 2, 3, 4]) {
      db.tables.workspaces.push({
        id: `ws-extra-${n}`,
        name: `Extra ${n}`,
        owner_id: ME,
        deleted_at: null,
      });
      db.bucket("avatars").files.add(`workspaces/ws-extra-${n}/logo.png`);
    }

    await deleteAccount({ ...deps, pageSize: 2 }, me);

    expect(avatarFiles(db)).toEqual([
      `profiles/${OTHER}/avatar.jpg`,
      "workspaces/ws-team/logo.png",
    ]);
  });
});

describe("deleteAccount — Stripe records", () => {
  it("also deletes customers tagged with the user that the profile lost track of", async () => {
    const { stripe, deps } = world();
    stripe.addCustomer("cus_orphan", ME, [["sub_orphan", "trialing"]]);

    await deleteAccount(deps, me);

    expect(stripe.customersById.get("cus_orphan")?.deleted).toBe(true);
    expect(stripe.subscriptionsById.get("sub_orphan")?.status).toBe("canceled");
  });

  it("never touches a stored customer that Stripe says is someone else's", async () => {
    const { db, stripe, deps } = world();
    db.tables.profiles[0].stripe_customer_id = "cus_other";

    const result = await deleteAccount(deps, me);

    expect(result).toEqual({
      status: "deleted",
      warnings: ["stripe_customer_not_theirs: cus_other"],
    });
    expect(stripe.customersById.get("cus_other")?.deleted).toBe(false);
    expect(stripe.subscriptionsById.get("sub_other")?.status).toBe("active");
    // The user's own customer is still found by its tag.
    expect(stripe.customersById.get("cus_me")?.deleted).toBe(true);
  });

  it("follows Stripe's pages of customers and subscriptions", async () => {
    const { stripe, deps } = world();
    stripe.pageSize = 1;
    stripe.addCustomer("cus_orphan", ME, [
      ["sub_orphan_a", "trialing"],
      ["sub_orphan_b", "active"],
      ["sub_orphan_c", "past_due"],
    ]);

    await deleteAccount(deps, me);

    expect(stripe.customersById.get("cus_orphan")?.deleted).toBe(true);
    expect(stripe.log).toContain("cancel sub_orphan_c (Moduo account deleted)");
    expect(stripe.log.filter((entry) => entry.startsWith("cancel "))).toHaveLength(4);
  });

  it("warns, but carries on, when Stripe refuses the customer search for good", async () => {
    const { stripe, deps } = world();
    stripe.searchError = stripeError("This key can't search customers", 403);

    const result = await deleteAccount(deps, me);

    expect(result).toEqual({
      status: "deleted",
      warnings: ["stripe_search_failed: This key can't search customers"],
    });
    expect(stripe.customersById.get("cus_me")?.deleted).toBe(true);
  });

  it("fails the Stripe step when the customer search hits a rate limit or outage", async () => {
    const { db, stripe, deps } = world();
    stripe.searchError = stripeError("Too many requests", 429);

    expect(await failedStep(deleteAccount(deps, me))).toBe("stripe");
    expect(db.log).toEqual([]);
    expect(stripe.log).toEqual([]);
  });

  it("warns about a stored customer id this Stripe account doesn't have", async () => {
    const { db, deps } = world();
    db.tables.profiles[0].stripe_customer_id = "cus_from_test_mode";

    const result = await deleteAccount(deps, me);

    expect(result).toEqual({
      status: "deleted",
      warnings: ["stripe_customer_missing: cus_from_test_mode"],
    });
  });

  it("without a Stripe key, refuses when there is a customer and warns when there isn't", async () => {
    const withCustomer = world();
    expect(
      await failedStep(
        deleteAccount({ db: withCustomer.db, stripe: null, posthog: withCustomer.posthog }, me),
      ),
    ).toBe("stripe");
    expect(withCustomer.db.log).toEqual([]);
    expect(withCustomer.db.users.has(ME)).toBe(true);

    const withoutCustomer = world();
    withoutCustomer.db.tables.profiles[0].stripe_customer_id = null;
    const result = await deleteAccount(
      { db: withoutCustomer.db, stripe: null, posthog: withoutCustomer.posthog },
      me,
    );
    expect(result).toEqual({ status: "deleted", warnings: ["stripe_not_configured"] });
  });
});

describe("deleteAccount — the app's usage analytics at PostHog (PRIV-3)", () => {
  it("asks PostHog to delete the person keyed by the user's id", async () => {
    const { posthog, deps } = world();

    const result = await deleteAccount(deps, me);

    expect(result).toEqual({ status: "deleted", warnings: [] });
    expect(posthog.log).toEqual([`erase ${ME}`]);
  });

  it("stops at PostHog before billing or anything in Moduo is touched, and a retry finishes", async () => {
    const { db, stripe, posthog, deps } = world();
    posthog.outcome = "throw";

    expect(await failedStep(deleteAccount(deps, me))).toBe("posthog");
    expect(stripe.log).toEqual([]);
    expect(stripe.subscriptionsById.get("sub_me")?.status).toBe("trialing");
    expect(db.log).toEqual([]);
    expect(db.users.has(ME)).toBe(true);

    posthog.outcome = "queued";
    const result = await deleteAccount(deps, me);

    expect(result.status).toBe("deleted");
    expect(posthog.log).toEqual([`erase ${ME}`, `erase ${ME}`]);
    expect(db.users.has(ME)).toBe(false);
  });

  it("warns, but carries on, when PostHog refuses for good (a wrong key or project)", async () => {
    const { db, posthog, deps } = world();
    posthog.outcome = "refused";

    const result = await deleteAccount(deps, me);

    expect(result).toEqual({ status: "deleted", warnings: ["posthog_refused: 403"] });
    expect(db.users.has(ME)).toBe(false);
  });

  it("without the PostHog secrets, warns and carries on", async () => {
    const { db, deps } = world();

    const result = await deleteAccount({ ...deps, posthog: null }, me);

    expect(result).toEqual({ status: "deleted", warnings: ["posthog_not_configured"] });
    expect(db.users.has(ME)).toBe(false);
  });

  it("fails before anything is deleted when a caller forgot to pass posthog at all", async () => {
    const { db, stripe, deps } = world();
    // What an Edge Function entry point (not type-checked) would send without the field.
    const { posthog: _left, ...withoutPostHog } = deps;

    expect(await failedStep(deleteAccount(withoutPostHog as typeof deps, me))).toBe("posthog");
    expect(stripe.log).toEqual([]);
    expect(db.users.has(ME)).toBe(true);
  });
});

describe("deleteAccount — failures leave a retryable account", () => {
  it("stops at Stripe with nothing in Moduo deleted, and a retry finishes", async () => {
    const { db, stripe, deps } = world();
    stripe.deleteFails = true;

    expect(await failedStep(deleteAccount(deps, me))).toBe("stripe");
    expect(db.log).toEqual([]);
    expect(db.users.has(ME)).toBe(true);
    expect(avatarFiles(db)).toContain(`profiles/${ME}/avatar.png`);
    // The plan already ended before the customer delete failed.
    expect(stripe.subscriptionsById.get("sub_me")?.status).toBe("canceled");

    stripe.deleteFails = false;
    const result = await deleteAccount(deps, me);

    expect(result.status).toBe("deleted");
    expect(stripe.log).toEqual(["cancel sub_me (Moduo account deleted)", "del cus_me"]);
  });

  it("stops at storage without deleting the auth user", async () => {
    const { db, deps } = world();
    db.storageFails = true;

    expect(await failedStep(deleteAccount(deps, me))).toBe("storage");
    expect(db.users.has(ME)).toBe(true);
    expect(db.log).not.toContain("auth delete");
  });

  it("finishes on retry without touching Stripe twice", async () => {
    const { db, stripe, deps } = world();
    db.fail = { table: "slot_bookings", op: "delete" };

    expect(await failedStep(deleteAccount(deps, me))).toBe("booking");
    expect(db.users.has(ME)).toBe(true);

    db.fail = null;
    const result = await deleteAccount(deps, me);

    expect(result.status).toBe("deleted");
    expect(db.users.has(ME)).toBe(false);
    expect(ids(db.rows("slot_bookings"))).toEqual(["booking-3"]);
    expect(stripe.log.filter((entry) => entry.startsWith("del "))).toEqual(["del cus_me"]);
  });

  it("counts an auth user a concurrent request already deleted as deleted", async () => {
    const { db, deps } = world();
    db.users.delete(ME);

    const result = await deleteAccount(deps, me);

    expect(result.status).toBe("deleted");
  });

  it("reports the guard's own failure as nothing deleted", async () => {
    const { db, stripe, deps } = world();
    db.fail = { table: "workspace_members", op: "select" };

    expect(await failedStep(deleteAccount(deps, me))).toBe("check");
    expect(db.log).toEqual([]);
    expect(stripe.log).toEqual([]);
  });

  it("keeps the original error as the cause", async () => {
    const { db, deps } = world();
    db.fail = { table: "user_integrations", op: "delete" };

    const err = await deleteAccount(deps, me).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ErasureError);
    const { step, cause } = err as ErasureError;
    expect(step).toBe("integrations");
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toBe("user_integrations: delete user_integrations failed");
  });
});

describe("erasureErrorMessage", () => {
  it("says the account wasn't deleted only for the steps before any Moduo data goes", () => {
    for (const step of ["check", "posthog", "stripe"] as const) {
      expect(erasureErrorMessage(step)).toContain("wasn't deleted");
    }
    for (const step of [
      "storage",
      "booking",
      "integrations",
      "contact_notes",
      "waitlist",
      "auth",
    ] as const) {
      expect(erasureErrorMessage(step)).toBe(
        "Your account was only partly deleted. Try again to finish.",
      );
    }
  });

  it("warns that the plan may already be cancelled when Stripe fails", () => {
    expect(erasureErrorMessage("stripe")).toContain("may already be cancelled");
  });
});
