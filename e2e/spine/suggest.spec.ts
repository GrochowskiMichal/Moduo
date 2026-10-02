/**
 * suggest.spec.ts — block CT-6, AC11 (deterministic auto-suggest round-trip).
 *
 * Server-invariant test (Assumption 10: no SQL unit harness in-repo, so AC11's
 * server half is proven at the e2e/manual layer; the pure scorer is covered by
 * src/features/spine/suggest.test.ts). This exercises the live RPC contract:
 *
 *   1. `links_suggest` returns ranked candidate rows for a focus entity.
 *   2. Accepting one via `links_op_create(origin => 'suggest')` persists a link
 *      stamped origin='suggest'.
 *   3. `links_op_decline_suggestion` removes that pair from future `links_suggest`
 *      results — the "no" is remembered (and is idempotent on repeat).
 *
 * Requires a seeded workspace whose focus entity has at least one deterministic
 * signal (a shared tag, a matching contact/company email domain, or recent
 * co-activity). Skips unless the env below is set, so it never runs in CI
 * (CI does not exercise Supabase — gotchas.md) and is a local/manual harness.
 *
 * Env:
 *   E2E_SUPABASE_URL          — project REST URL
 *   E2E_SUPABASE_PUBLISHABLE_KEY — publishable apikey
 *   E2E_ACCESS_TOKEN          — an authenticated *editor* session JWT
 *   E2E_SUGGEST_WORKSPACE     — workspace uuid
 *   E2E_SUGGEST_FOCUS_TYPE    — focus entity type (e.g. "contact")
 *   E2E_SUGGEST_FOCUS_ID      — focus entity uuid
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

const URL = process.env.E2E_SUPABASE_URL;
const PUBLISHABLE = process.env.E2E_SUPABASE_PUBLISHABLE_KEY;
const TOKEN = process.env.E2E_ACCESS_TOKEN;
const WORKSPACE = process.env.E2E_SUGGEST_WORKSPACE;
const FOCUS_TYPE = process.env.E2E_SUGGEST_FOCUS_TYPE;
const FOCUS_ID = process.env.E2E_SUGGEST_FOCUS_ID;

const ready = Boolean(URL && PUBLISHABLE && TOKEN && WORKSPACE && FOCUS_TYPE && FOCUS_ID);

function rpc(request: APIRequestContext, fn: string, body: Record<string, unknown>) {
  return request.post(`${URL}/rest/v1/rpc/${fn}`, {
    headers: {
      apikey: PUBLISHABLE!,
      Authorization: `Bearer ${TOKEN!}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    data: body,
  });
}

type SuggestRow = { other_type: string; other_id: string; origin?: string };

async function suggest(request: APIRequestContext): Promise<SuggestRow[]> {
  const res = await rpc(request, "links_suggest", {
    p_workspace_id: WORKSPACE,
    p_entity_type: FOCUS_TYPE,
    p_entity_id: FOCUS_ID,
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as SuggestRow[];
}

test.describe("Spine auto-suggest (CT-6, AC11)", () => {
  test.skip(!ready, "E2E_SUPABASE_* / E2E_SUGGEST_* env not set");

  test("suggest → accept stamps origin=suggest → decline is remembered", async ({ request }) => {
    const candidates = await suggest(request);
    expect(Array.isArray(candidates)).toBeTruthy();
    test.skip(
      candidates.length < 2,
      "needs >= 2 seeded candidates to accept one and decline another",
    );

    // 1. Accept the top candidate → a link with origin='suggest'.
    const accepted = candidates[0];
    const createRes = await rpc(request, "links_op_create", {
      p_workspace_id: WORKSPACE,
      p_source_type: FOCUS_TYPE,
      p_source_id: FOCUS_ID,
      p_target_type: accepted.other_type,
      p_target_id: accepted.other_id,
      p_relation_kind: "references",
      p_origin: "suggest",
    });
    expect(createRes.status()).toBe(200);
    const link = await createRes.json();
    const linkRow = Array.isArray(link) ? link[0] : link;
    expect(linkRow.origin).toBe("suggest");

    // An accepted pair is now linked, so it must drop out of future suggestions.
    const afterAccept = await suggest(request);
    expect(afterAccept.find((c) => c.other_id === accepted.other_id)).toBeUndefined();

    // 2. Decline a different candidate → it must never be re-offered.
    const declined = candidates[1];
    const declineRes = await rpc(request, "links_op_decline_suggestion", {
      p_workspace_id: WORKSPACE,
      p_source_type: FOCUS_TYPE,
      p_source_id: FOCUS_ID,
      p_target_type: declined.other_type,
      p_target_id: declined.other_id,
    });
    expect(declineRes.status()).toBe(200);

    const afterDecline = await suggest(request);
    expect(afterDecline.find((c) => c.other_id === declined.other_id)).toBeUndefined();

    // 3. Declining again is idempotent (no error, still suppressed).
    const declineAgain = await rpc(request, "links_op_decline_suggestion", {
      p_workspace_id: WORKSPACE,
      p_source_type: FOCUS_TYPE,
      p_source_id: FOCUS_ID,
      p_target_type: declined.other_type,
      p_target_id: declined.other_id,
    });
    expect(declineAgain.status()).toBe(200);
  });
});
