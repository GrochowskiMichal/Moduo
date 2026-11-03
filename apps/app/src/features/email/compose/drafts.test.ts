import { describe, expect, it } from "@rstest/core";

import { createFakeCompose } from "../testing/fake-compose";
import { draftForThread, draftToOpenSpec } from "./drafts";
import { createComposeSession, type ComposeOpenSpec } from "./session";

const spec = (p: Partial<ComposeOpenSpec> = {}): ComposeOpenSpec => ({
  kind: "reply",
  placement: "inline",
  accountId: "acc",
  threadId: "t1",
  fromAddr: "me@x.com",
  fromName: "Me",
  to: "anna@x.com",
  cc: "",
  bcc: "",
  subject: "Re: Hi",
  bodyHtml: "",
  inReplyTo: "<m1@x>",
  references: ["<m1@x>"],
  attachments: [],
  fromInbox: true,
  ...p,
});

function setup(settings = { undoSeconds: 10, doneOnSend: true }) {
  let t = 1_000_000;
  const port = createFakeCompose({ now: () => t });
  const done: string[] = [];
  const toasts: { undo: () => void; edit: () => void }[] = [];
  const session = createComposeSession({
    port,
    settings: () => settings,
    markDone: (id) => {
      done.push(id);
    },
    showSent: (_h, actions) => toasts.push(actions),
  });
  return { port, session, done, toasts, advance: (ms: number) => (t += ms) };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("compose drafts and send (AC21, AC22)", () => {
  it("saves the draft locally on every change and restores it", async () => {
    const { port, session } = setup();
    await session.open(spec());
    await session.update({ bodyHtml: "<p>Hel</p>" });
    await session.update({ bodyHtml: "<p>Hello</p>" });
    const rows = await port.listDrafts("acc");
    expect(rows).toHaveLength(1);
    expect(rows[0].doc.html).toBe("<p>Hello</p>");
    const reopened = draftToOpenSpec(draftForThread(rows, "t1")!);
    expect(reopened).toMatchObject({ draftId: rows[0].id, kind: "reply", placement: "inline" });
  });

  it("server drafts made elsewhere appear", async () => {
    const { port } = setup();
    port.serverDraft({
      id: "srv",
      accountId: "acc",
      threadId: null,
      doc: { ...draftToOpenSpecDoc(), subject: "From phone" },
      updatedAtMs: 1,
      serverUid: 42,
      queued: false,
    });
    expect((await port.listDrafts("acc")).map((d) => d.doc.subject)).toEqual(["From phone"]);
  });

  it("send waits out the undo window; Undo reopens the draft", async () => {
    const { port, session, toasts, done } = setup();
    await session.open(spec());
    await session.update({ bodyHtml: "<p>Yes</p>" });
    const res = await session.send();
    expect(res.ok).toBe(true);
    expect(session.active).toBeNull();
    expect(done).toEqual(["t1"]);
    port.drain();
    expect(port.sent).toHaveLength(0);
    toasts[0].undo();
    await tick();
    await tick();
    expect(session.active?.bodyHtml).toBe("<p>Yes</p>");
    expect(await port.listOutbox()).toHaveLength(0);
  });

  it("offline waits in Outbox and sends on reconnect; failure returns to Drafts with the reason", async () => {
    const { port, session, advance } = setup({ undoSeconds: 5, doneOnSend: false });
    await session.open(spec());
    await session.send();
    advance(6000);
    port.online = false;
    port.drain();
    expect(await port.listOutbox()).toHaveLength(1);
    port.online = true;
    port.drain();
    expect(port.sent).toHaveLength(1);

    await session.open(spec({ threadId: "t2" }));
    await session.send();
    advance(6000);
    port.failNext = "550 mailbox unavailable";
    port.drain();
    const drafts = await port.listDrafts();
    expect(drafts[0].doc.lastError).toBe("550 mailbox unavailable");
    expect(draftToOpenSpec(drafts[0]).lastError).toBe("550 mailbox unavailable");
  });

  it("refuses to send without recipients or over the size limit", async () => {
    const { session } = setup();
    await session.open(spec({ to: "" }));
    expect(await session.send()).toEqual({ ok: false, reason: "Add a recipient." });
    await session.update({ to: "a@x.com", attachments: [{ filename: "big", contentType: "x", path: "/p", size: 30 * 1024 * 1024 }] });
    const r = await session.send(25 * 1024 * 1024);
    expect(r.ok).toBe(false);
  });
});

function draftToOpenSpecDoc() {
  return {
    messageId: "<srv@x>",
    fromName: null,
    fromAddr: "me@x.com",
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    text: "",
    html: null,
    inReplyTo: null,
    references: [],
    attachments: [],
    lastError: null,
  };
}
