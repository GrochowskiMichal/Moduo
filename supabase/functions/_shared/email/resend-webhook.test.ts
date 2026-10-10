import { describe, expect, it } from "@rstest/core";

import { parseHookSecrets, signWebhook } from "../standard-webhooks.ts";
import { classifyResendEvent, handleResendWebhook, type ResendWebhookDeps } from "./resend-webhook.ts";

// Resend's signing secrets look like this: whsec_ + base64.
const SECRET = `whsec_${btoa("resend-webhook-test-secret-32by!")}`;
const NOW = 1_791_500_000;

function event(type: string, data: Record<string, unknown>) {
  return JSON.stringify({ type, created_at: "2026-10-16T12:00:05.000Z", data });
}

async function signed(body: string, secret = SECRET, id = "msg_2Abc") {
  const timestamp = String(NOW);
  const [key] = parseHookSecrets(secret);
  return {
    method: "POST",
    body,
    headers: { id, timestamp, signature: `v1,${await signWebhook(key, id, timestamp, body)}` },
  };
}

function fakeDb() {
  const suppressed: { email: string; reason: string; eventId: string }[] = [];
  const delivered: { providerId: string; at: string }[] = [];
  const deps: ResendWebhookDeps = {
    secret: SECRET,
    suppress: async (entry) => {
      suppressed.push(entry);
    },
    markDelivered: async (entry) => {
      delivered.push(entry);
    },
    now: () => NOW * 1000,
  };
  return { deps, suppressed, delivered };
}

const BOUNCE = (type: string) =>
  event("email.bounced", {
    email_id: "56761188-7520-42d8-8898-ff6fc54ce618",
    created_at: "2026-10-16T12:00:00.000Z",
    to: ["Tom.Becker@Becker.Studio"],
    bounce: { type, subType: "General", message: "…" },
  });

describe("svix signature + suppression", () => {
  it("suppresses a hard bounce, lower-cased, with the event id", async () => {
    const db = fakeDb();
    const response = await handleResendWebhook(await signed(BOUNCE("Permanent")), db.deps);
    expect(response).toEqual({ status: 200, body: { ok: true, action: "suppress" } });
    expect(db.suppressed).toEqual([{ email: "tom.becker@becker.studio", reason: "bounce", eventId: "msg_2Abc" }]);
  });

  it("does not suppress a soft or undetermined bounce", async () => {
    for (const type of ["Transient", "Undetermined"]) {
      const db = fakeDb();
      const response = await handleResendWebhook(await signed(BOUNCE(type)), db.deps);
      expect(response.status).toBe(200);
      expect(db.suppressed).toEqual([]);
    }
  });

  it("suppresses a spam complaint, and an address Resend itself suppressed", async () => {
    const complaint = fakeDb();
    await handleResendWebhook(
      await signed(event("email.complained", { email_id: "e1", to: ["Anna Carter <anna@northwind.studio>"] })),
      complaint.deps,
    );
    expect(complaint.suppressed).toEqual([{ email: "anna@northwind.studio", reason: "complaint", eventId: "msg_2Abc" }]);

    const resendList = fakeDb();
    await handleResendWebhook(
      await signed(
        event("email.suppressed", {
          email_id: "e2",
          to: ["tom@becker.studio"],
          suppressed: { type: "OnAccountSuppressionList" },
        }),
      ),
      resendList.deps,
    );
    expect(resendList.suppressed).toEqual([{ email: "tom@becker.studio", reason: "bounce", eventId: "msg_2Abc" }]);
  });

  it("stamps delivery with the event's time", async () => {
    const db = fakeDb();
    await handleResendWebhook(
      await signed(event("email.delivered", { email_id: "re_123", created_at: "2026-10-16T12:00:00.000Z", to: ["x@y.z"] })),
      db.deps,
    );
    expect(db.delivered).toEqual([{ providerId: "re_123", at: "2026-10-16T12:00:05.000Z" }]);
    expect(db.suppressed).toEqual([]);
  });

  it("acknowledges other events and writes nothing", async () => {
    const db = fakeDb();
    const response = await handleResendWebhook(await signed(event("email.opened", { email_id: "e" })), db.deps);
    expect(response.status).toBe(200);
    expect(db.suppressed).toEqual([]);
    expect(db.delivered).toEqual([]);
  });

  it("refuses an unsigned, wrongly signed or altered request, and writes nothing", async () => {
    const db = fakeDb();
    const good = await signed(BOUNCE("Permanent"));

    const unsigned = await handleResendWebhook({ ...good, headers: { id: null, timestamp: null, signature: null } }, db.deps);
    expect(unsigned.status).toBe(401);

    const otherSecret = await signed(BOUNCE("Permanent"), `whsec_${btoa("some-other-secret-thirty-two-by!")}`);
    expect((await handleResendWebhook(otherSecret, db.deps)).status).toBe(401);

    const altered = { ...good, body: BOUNCE("Permanent").replace("Tom.Becker", "Anna") };
    expect((await handleResendWebhook(altered, db.deps)).status).toBe(401);

    const noSecret = await handleResendWebhook(good, { ...db.deps, secret: undefined });
    expect(noSecret.status).toBe(401);

    expect(db.suppressed).toEqual([]);
  });

  it("answers 500 when the database write fails, so Svix delivers it again", async () => {
    const db = fakeDb();
    const response = await handleResendWebhook(await signed(BOUNCE("Permanent")), {
      ...db.deps,
      suppress: async () => {
        throw new Error("rpc email_suppression__add: 503");
      },
    });
    expect(response.status).toBe(500);
  });

  it("refuses anything but POST", async () => {
    const db = fakeDb();
    expect((await handleResendWebhook({ ...(await signed("{}")), method: "GET" }, db.deps)).status).toBe(405);
  });

  it("ignores events without a usable recipient", () => {
    expect(classifyResendEvent({ type: "email.complained", data: { to: ["not an address"] } })).toEqual({
      type: "ignore",
      why: "no_recipient",
    });
    expect(classifyResendEvent(null)).toEqual({ type: "ignore", why: "no_type" });
  });
});
