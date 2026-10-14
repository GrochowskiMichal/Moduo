import { describe, expect, it } from "@rstest/core";

import { type AuthEmailLogRow, type HookDeps, handleAuthEmailHook, inviteConfirmUrl } from "./handler.ts";
import { parseHookSecrets, signWebhook } from "../_shared/standard-webhooks.ts";

const SECRET = `v1,whsec_${btoa("a-thirty-two-byte-test-secret!!!")}`;
const NOW_MS = 1_791_500_000_000;
const SUPABASE_URL = "https://wtoonrvuqumihpkbvwvs.supabase.co";
const CODE = "482913";
const TOKEN_HASH = "7d5b7b1964cf5d388340a7f04f1dbb5eeb6c7b52ef8270e1737a58d0";

type Sent = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function payload(action: string, overrides: { user?: object; email_data?: object } = {}) {
  return JSON.stringify({
    user: { id: "8484b834-f29e-4af2-bf42-80644d154f76", email: "Tom@Becker.Studio", ...overrides.user },
    email_data: {
      token: CODE,
      token_hash: TOKEN_HASH,
      redirect_to: "https://app.moduo.app",
      email_action_type: action,
      site_url: "https://app.moduo.app",
      token_new: "",
      token_hash_new: "",
      ...overrides.email_data,
    },
  });
}

async function signed(body: string, id = "msg_2a") {
  const timestamp = String(Math.floor(NOW_MS / 1000));
  const [key] = parseHookSecrets(SECRET);
  return { method: "POST", body, headers: { id, timestamp, signature: `v1,${await signWebhook(key, id, timestamp, body)}` } };
}

/** A fake Resend: answers each request from `statuses` in turn (default 200). */
function setup(statuses: number[] = [], overrides: Partial<HookDeps> = {}) {
  const sent: Sent[] = [];
  const logs: AuthEmailLogRow[] = [];
  const reports: { event: string; detail: Record<string, unknown> }[] = [];
  const fetchFake = (async (url: string, init: RequestInit) => {
    sent.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const status = statuses.shift() ?? 200;
    return new Response(JSON.stringify(status < 300 ? { id: `re_${sent.length}` } : { message: "boom", name: "x" }), {
      status,
    });
  }) as unknown as typeof fetch;
  const deps: HookDeps = {
    hookSecret: SECRET,
    resendApiKey: "re_test",
    supabaseUrl: SUPABASE_URL,
    log: async (row) => {
      logs.push(row);
    },
    fetch: fetchFake,
    sleep: async () => {},
    now: () => NOW_MS,
    report: (event, detail) => reports.push({ event, detail }),
    ...overrides,
  };
  return { deps, sent, logs, reports };
}

describe("auth-email-hook · verifies signature", () => {
  it("refuses an unsigned request and sends nothing", async () => {
    const { deps, sent, logs } = setup();
    const response = await handleAuthEmailHook(
      { method: "POST", body: payload("magiclink"), headers: { id: null, timestamp: null, signature: null } },
      deps,
    );
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { http_code: 401, message: "invalid_signature" } });
    expect(sent).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it("refuses a request signed with another secret", async () => {
    const { deps, sent } = setup([], { hookSecret: `v1,whsec_${btoa("another-thirty-two-byte-secret!!")}` });
    const response = await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(response.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("sends A1 from hello@moduo.app through Resend for a valid sign-in request", async () => {
    const { deps, sent } = setup();
    const response = await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(response).toEqual({ status: 200, body: {} });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.resend.com/emails");
    expect(sent[0].headers.Authorization).toBe("Bearer re_test");
    expect(sent[0].headers["Idempotency-Key"]).toBe("auth_code:msg_2a:0");
    expect(sent[0].body.from).toBe('"Moduo" <hello@moduo.app>');
    expect(sent[0].body.to).toEqual(["tom@becker.studio"]);
    expect(sent[0].body.subject).toBe("482913 is your Moduo code");
    expect(String(sent[0].body.text)).toContain("It works once, for 10 minutes.");
  });

  it("sends the same A1 for `email` and for a first sign-in (`signup`)", async () => {
    for (const action of ["email", "signup"]) {
      const { deps, sent } = setup();
      expect((await handleAuthEmailHook(await signed(payload(action)), deps)).status).toBe(200);
      expect(sent[0].body.subject).toBe("482913 is your Moduo code");
    }
  });

  it("answers the *_notification types without sending", async () => {
    const { deps, sent, logs } = setup();
    const response = await handleAuthEmailHook(await signed(payload("password_changed_notification")), deps);
    expect(response).toEqual({ status: 200, body: {} });
    expect(sent).toHaveLength(0);
    expect(logs).toHaveLength(0);
  });

  it("refuses an unknown action or a payload without an address or code", async () => {
    const cases = [
      payload("something_new"),
      payload("magiclink", { user: { email: "" } }),
      payload("magiclink", { email_data: { token: "" } }),
    ];
    for (const body of cases) {
      const { deps, sent } = setup();
      expect((await handleAuthEmailHook(await signed(body), deps)).status).toBe(400);
      expect(sent).toHaveLength(0);
    }
  });

  it("refuses anything but POST and oversized bodies", async () => {
    const { deps } = setup();
    expect((await handleAuthEmailHook({ ...(await signed("{}")), method: "GET" }, deps)).status).toBe(405);
    expect((await handleAuthEmailHook(await signed("x".repeat(257 * 1024)), deps)).status).toBe(413);
  });
});

describe("auth-email-hook · dashboard invite keeps its confirmation link", () => {
  it("emails the /auth/v1/verify link for the invite, not a code", async () => {
    const { deps, sent, logs } = setup();
    const response = await handleAuthEmailHook(await signed(payload("invite")), deps);
    expect(response.status).toBe(200);
    const html = String(sent[0].body.html);
    const text = String(sent[0].body.text);
    const link = `${SUPABASE_URL}/auth/v1/verify?token=${TOKEN_HASH}&type=invite&redirect_to=https%3A%2F%2Fapp.moduo.app`;
    expect(sent[0].body.subject).toBe("You're invited to Moduo");
    expect(text).toContain(link);
    expect(html).toContain(link.replaceAll("&", "&amp;"));
    expect(text).not.toContain(CODE);
    // Logged with the new user's id even though Auth hasn't committed that user yet
    // (the table has no foreign key for exactly this reason).
    expect(logs[0]).toMatchObject({
      to_user_id: "8484b834-f29e-4af2-bf42-80644d154f76",
      payload: { action: "invite", variant: "invite", fallback: false },
    });
  });

  it("only ever redirects to one of our app hosts", () => {
    expect(inviteConfirmUrl(SUPABASE_URL, "h", "https://evil.example/x", "https://app.moduo.app")).toContain(
      "redirect_to=https%3A%2F%2Fapp.moduo.app",
    );
    expect(inviteConfirmUrl(SUPABASE_URL, "h", "https://app.staging.moduo.app/join", null)).toMatch(
      /redirect_to=https%3A%2F%2Fapp\.staging\.moduo\.app$/,
    );
    expect(inviteConfirmUrl(SUPABASE_URL, "h", null, "https://moduo.app")).toContain(
      "redirect_to=https%3A%2F%2Fapp.moduo.app",
    );
  });

  it("logs a failed invite without the user's id, since Auth rolls that user back", async () => {
    const { deps, logs } = setup([500, 500]);
    const response = await handleAuthEmailHook(await signed(payload("invite")), deps);
    expect(response.status).toBe(500);
    expect(logs[0]).toMatchObject({ status: "failed", to_user_id: null, to_email: "tom@becker.studio" });
  });

  it("refuses an invite without a token hash", async () => {
    const { deps, sent } = setup();
    const response = await handleAuthEmailHook(await signed(payload("invite", { email_data: { token_hash: "" } })), deps);
    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});

describe("auth-email-hook · other auth codes", () => {
  it("sends a neutral confirmation code for recovery and reauthentication", async () => {
    for (const action of ["recovery", "reauthentication"]) {
      const { deps, sent } = setup();
      expect((await handleAuthEmailHook(await signed(payload(action)), deps)).status).toBe(200);
      expect(sent[0].body.subject).toBe("482913 is your Moduo confirmation code");
    }
  });

  it("sends both email-change codes to the right addresses (Supabase's reversed naming)", async () => {
    const { deps, sent } = setup();
    const body = payload("email_change", {
      user: { new_email: "tom@northwind.studio" },
      email_data: { token: "111111", token_new: "222222", token_hash_new: "hash-current" },
    });
    expect((await handleAuthEmailHook(await signed(body), deps)).status).toBe(200);
    const byAddress = Object.fromEntries(sent.map((item) => [(item.body.to as string[])[0], item.body.subject]));
    expect(byAddress).toEqual({
      "tom@becker.studio": "111111 is your Moduo confirmation code",
      "tom@northwind.studio": "222222 is your Moduo confirmation code",
    });
  });

  it("sends a single email-change code to the new address when secure change is off", async () => {
    const { deps, sent } = setup();
    const body = payload("email_change", { user: { new_email: "tom@northwind.studio" } });
    expect((await handleAuthEmailHook(await signed(body), deps)).status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].body.to).toEqual(["tom@northwind.studio"]);
  });
});

describe("auth-email-hook · falls back to plain text", () => {
  it("still sends the code when the designed email throws", async () => {
    const { deps, sent, logs, reports } = setup([], {
      render: () => {
        throw new Error("template bug");
      },
    });
    const response = await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(response.status).toBe(200);
    expect(sent[0].body.subject).toBe("482913 is your Moduo code");
    expect(String(sent[0].body.text)).toContain("Your Moduo sign-in code: 482913");
    expect(logs[0].payload.fallback).toBe(true);
    expect(reports.map((r) => r.event)).toEqual(["render_failed"]);
  });

  it("keeps the invite's confirmation link when the designed invite throws", async () => {
    const { deps, sent, logs } = setup([], {
      render: () => {
        throw new Error("template bug");
      },
    });
    const response = await handleAuthEmailHook(await signed(payload("invite")), deps);
    expect(response.status).toBe(200);
    const link = `${SUPABASE_URL}/auth/v1/verify?token=${TOKEN_HASH}&type=invite&redirect_to=https%3A%2F%2Fapp.moduo.app`;
    expect(sent[0].body.subject).toBe("You're invited to Moduo");
    expect(String(sent[0].body.text)).toContain(`Confirm your address: ${link}`);
    expect(String(sent[0].body.html)).toContain(`href="${link.replaceAll("&", "&amp;")}"`);
    expect(logs[0].payload).toEqual({ action: "invite", variant: "invite", fallback: true });
  });

  it("retries a temporary Resend failure once, then succeeds", async () => {
    const { deps, sent, logs } = setup([503, 200]);
    const response = await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(2);
    expect(logs[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("doesn't retry when the retry wouldn't finish inside Auth's five seconds", async () => {
    // The first Resend request took 3.2 s: 1.3 s are left, less than a retry needs.
    let calls = 0;
    const { deps, sent, logs } = setup([503, 200], {
      now: () => (calls++ === 0 ? NOW_MS : NOW_MS + 3200),
    });
    const response = await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(response.status).toBe(500);
    expect(sent).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "failed", attempts: 1 });
  });

  it("hands the log write to `defer` instead of waiting for it", async () => {
    const deferred: Promise<void>[] = [];
    let release: () => void = () => {};
    const { deps, logs } = setup([], {
      log: (row) =>
        new Promise<void>((resolve) => {
          release = () => {
            logs.push(row);
            resolve();
          };
        }),
      defer: (task) => {
        deferred.push(task);
      },
    });
    const response = await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(response.status).toBe(200);
    expect(deferred).toHaveLength(1);
    expect(logs).toHaveLength(0);
    release();
    await deferred[0];
    expect(logs).toHaveLength(1);
  });

  it("returns the hook error shape and records the failure when Resend fails", async () => {
    const { deps, logs } = setup([500, 500]);
    const response = await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(response).toEqual({ status: 500, body: { error: { http_code: 500, message: "email_send_failed" } } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ status: "failed", provider_id: null, sent_at: null, last_error: "boom" });
  });

  it("fails cleanly when Resend isn't configured", async () => {
    const { deps, sent, logs } = setup([], { resendApiKey: undefined });
    const response = await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(response.status).toBe(500);
    expect(sent).toHaveLength(0);
    expect(logs[0].last_error).toBe("resend_not_configured");
  });

  it("still answers 200 when the log write throws synchronously", async () => {
    const { deps, reports } = setup([], {
      log: () => {
        throw new Error("sync bug");
      },
    });
    const response = await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(response.status).toBe(200);
    expect(reports.map((r) => r.event)).toEqual(["log_failed"]);
  });

  it("still answers 200 when the log write fails after the email went out", async () => {
    const { deps, reports } = setup([], {
      log: async () => {
        throw new Error("db down");
      },
    });
    const response = await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(response.status).toBe(200);
    expect(reports.map((r) => r.event)).toEqual(["log_failed"]);
  });
});

describe("auth-email-hook · never logs the code", () => {
  it("keeps the code, the token hash and the link out of the log row and the reports", async () => {
    for (const action of ["magiclink", "invite", "recovery"]) {
      const { deps, logs, reports } = setup([500, 500]);
      await handleAuthEmailHook(await signed(payload(action)), deps);
      const stored = JSON.stringify({ logs, reports });
      expect(stored).not.toContain(CODE);
      expect(stored).not.toContain(TOKEN_HASH);
      expect(stored).not.toContain("/auth/v1/verify");
    }
  });

  it("logs who got what, lower-cased, tied to the account", async () => {
    const { deps, logs } = setup();
    await handleAuthEmailHook(await signed(payload("magiclink")), deps);
    expect(logs).toEqual([
      {
        kind: "auth_code",
        stream: "account",
        to_email: "tom@becker.studio",
        to_user_id: "8484b834-f29e-4af2-bf42-80644d154f76",
        payload: { action: "magiclink", variant: "sign_in", fallback: false },
        dedupe_key: "auth_code:msg_2a:0",
        status: "sent",
        attempts: 1,
        last_error: null,
        provider_id: "re_1",
        sent_at: new Date(NOW_MS).toISOString(),
      },
    ]);
  });
});
