import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { HotkeyScope } from "@/lib/hotkeys/scope";

import { createMailStore } from "../store/mail-store";
import { createFakeCompose } from "../testing/fake-compose";
import { createFakeMailEngine } from "../testing/fake-engine";
import { FIXTURE_NOW_MS, generateFixture } from "../testing/fixture";
import { MailPage } from "../ui/mail-page";
import { type MailAlias, openWithAlias } from "./aliases";
import { MailComposer, type MailComposerProps } from "./mail-composer";
import { type ComposeOpenSpec, createComposeSession } from "./session";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

const spec = (p: Partial<ComposeOpenSpec> = {}): ComposeOpenSpec => ({
  kind: "reply",
  accountId: "acc",
  threadId: "t1",
  fromAddr: "me@x.com",
  fromName: "Me",
  to: "Anna Lee <anna@x.com>",
  cc: "",
  bcc: "",
  subject: "Re: Hi",
  bodyHtml: "",
  inReplyTo: "<m1@x>",
  references: [],
  attachments: [],
  fromInbox: true,
  ...p,
});

function setup(opts: { online?: boolean } = {}) {
  let session: ReturnType<typeof createComposeSession> | null = null;
  const port = createFakeCompose({
    // The engine's `draft_changed` with a server uid, as the page wires it.
    onDraftChanged: (draftId, uid) => uid !== null && session?.markUploaded(draftId),
  });
  port.online = opts.online ?? true;
  session = createComposeSession({
    port,
    settings: () => ({ undoSeconds: 10, doneOnSend: true }),
    markDone: () => {},
  });
  return { port, session };
}

function mount(props: MailComposerProps) {
  return render(
    <TooltipProvider>
      <MailComposer {...props} />
    </TooltipProvider>,
  );
}

const ACCOUNTS = [
  { id: "acc", label: "Personal", hue: "blue" as const },
  { id: "acc-2", label: "Work", hue: "green" as const },
];

describe("MailComposer (specs/mail-v3.md §9)", () => {
  it("inline reply, reader-column new message", async () => {
    const engine = createFakeMailEngine({
      fixture: generateFixture({ messages: 200 }),
      now: () => FIXTURE_NOW_MS,
    });
    const store = createMailStore({ engine, accounts: await engine.listAccounts() });
    const ui = render(
      <TooltipProvider>
        <HotkeyScope scope="email">
          <MailPage store={store} compose={createFakeCompose()} now={() => FIXTURE_NOW_MS} />
        </HotkeyScope>
      </TooltipProvider>,
    );
    await tick();
    await tick();
    const press = (key: string) =>
      act(() => {
        document.body.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
        );
      });
    press("j");
    press("r");
    await tick();
    await tick();
    // A reply sits under the conversation, inside the reader's thread.
    const reply = screen.getByRole("region", { name: /^Reply to / });
    expect(reply.getAttribute("data-placement")).toBe("inline");
    expect(reply.closest("[data-reader-thread]")).toBeTruthy();
    // Esc closes it and keeps the draft.
    fireEvent.keyDown(within(reply).getByLabelText("Message"), { key: "Escape" });
    await tick();
    expect(screen.queryByRole("region", { name: /^Reply/ })).toBeNull();

    press("c");
    await tick();
    await tick();
    // A New message fills the reader column; the list stays beside it.
    const fresh = screen.getByRole("region", { name: "New message" });
    expect(fresh.getAttribute("data-placement")).toBe("column");
    expect(fresh.parentElement?.getAttribute("aria-label")).toBe("Reader");
    expect(ui.container.querySelector("[data-reader-thread]")).toBeNull();
    expect(ui.container.querySelectorAll("[data-thread-id]").length).toBeGreaterThan(0);
    // No floating box anywhere.
    expect(ui.container.querySelector(".absolute.bottom-4")).toBeNull();
  });

  it("one active compose saves draft: starting another keeps the first as a draft", async () => {
    const { port, session } = setup();
    const ui = mount({ session });
    await act(() => session.open(spec()).then(() => {}));
    await act(async () => {
      fireEvent.change(ui.getByLabelText("Message"), { target: { value: "First" } });
      await session.flush();
    });
    await act(() => session.open(spec({ kind: "new", threadId: null, to: "" })).then(() => {}));
    expect(ui.getByRole("region", { name: "New message" })).toBeTruthy();
    expect(ui.queryByRole("region", { name: /^Reply/ })).toBeNull();
    const drafts = await port.listDrafts();
    expect(drafts.map((d) => d.doc.text)).toContain("First");
    // Fast typing saves into the one draft, never a second.
    expect(drafts.length).toBe(1);
  });

  it("alias switch changes account and signature", async () => {
    const { port, session } = setup();
    const aliases: MailAlias[] = [
      {
        id: "a1",
        accountId: "acc",
        address: "me@x.com",
        name: "Me",
        isDefault: true,
        signatureHtml: "<p>Mike G</p>",
      },
      {
        id: "a2",
        accountId: "acc-2",
        address: "me@work.com",
        name: "Mike at Work",
        isDefault: true,
        signatureHtml: "<p>Mike · Acme</p><p>+1 555</p>",
      },
    ];
    const ui = mount({ session, aliases, accounts: ACCOUNTS, onOpenSettings: () => {} });
    // The alias's signature is inserted on open.
    await act(() => session.open(openWithAlias(spec(), aliases)).then(() => {}));
    expect(session.active?.bodyHtml).toContain("Mike G");
    ui.getByText("Signs ‘Mike G’");
    ui.getByRole("button", { name: "Aliases and signatures…" });

    fireEvent.pointerDown(ui.getByRole("button", { name: "From me@x.com, change address" }), {
      button: 0,
      pointerType: "mouse",
    });
    const work = screen.getByRole("menuitemradio", { name: /me@work\.com/ });
    expect(work.textContent).toContain("Signs ‘Mike · Acme’ · default for Work");
    await act(async () => {
      fireEvent.click(work);
      await session.flush();
    });
    expect(session.active?.accountId).toBe("acc-2");
    expect(session.active?.fromAddr).toBe("me@work.com");
    const draft = (await port.listDrafts())[0]!;
    expect(draft.accountId).toBe("acc-2");
    expect(draft.doc.html).toContain("Mike · Acme");
    expect(draft.doc.html).not.toContain("Mike G");
    ui.getByText("Signs ‘Mike · Acme’");
  });

  it("one alias: no From menu", async () => {
    const { session } = setup();
    const ui = mount({
      session,
      aliases: [
        {
          id: "a1",
          accountId: "acc",
          address: "me@x.com",
          name: "Me",
          isDefault: true,
          signatureHtml: "",
        },
      ],
    });
    await act(() => session.open(spec()).then(() => {}));
    expect(ui.queryByRole("button", { name: /change address/ })).toBeNull();
    ui.getByText("me@x.com");
  });

  it("draft status stages and offline suffix", async () => {
    const { port, session } = setup();
    const ui = mount({ session, accounts: ACCOUNTS });
    await act(() => session.open(spec()).then(() => {}));
    expect(ui.queryByText(/^Saved /)).toBeNull();
    const status = () => ui.getByText(/^Saved /);

    await act(async () => {
      fireEvent.change(ui.getByLabelText("Message"), { target: { value: "Sounds good" } });
      await session.flush();
    });
    expect(status().textContent).toBe("Saved on this Mac");

    // The engine uploads it and reports the server uid.
    await act(async () => port.uploadDrafts());
    expect(status().textContent).toBe("Saved to Drafts");
    expect(status().closest("[title]")?.getAttribute("title")).toBe("Saved to Drafts on Personal");

    // An edit is newer than the server's copy again.
    await act(async () => {
      fireEvent.change(ui.getByLabelText("Message"), { target: { value: "Sounds good!" } });
      await session.flush();
    });
    expect(status().textContent).toBe("Saved on this Mac");

    // Offline, the local copy waits for the connection.
    ui.rerender(
      <TooltipProvider>
        <MailComposer session={session} accounts={ACCOUNTS} offline />
      </TooltipProvider>,
    );
    expect(status().textContent).toBe("Saved on this Mac · reaches Drafts when you're online");
  });

  it("over the size limit: names the provider and the largest file, and Send is off", async () => {
    const { session } = setup();
    const ui = mount({ session, sizeLimit: { bytes: 3 * 1024 * 1024, provider: "outlook" } });
    await act(() =>
      session
        .open(
          spec({
            attachments: [
              { id: "s1", filename: "deck.pdf", contentType: "application/pdf", size: 2_500_000 },
              { id: "s2", filename: "note.txt", contentType: "text/plain", size: 2_000 },
            ],
          }),
        )
        .then(() => {}),
    );
    const alert = ui.getByRole("alert");
    expect(alert.textContent).toMatch(
      /^This message is 3\.2 MB; Outlook accepts up to 3 MB\. Remove deck\.pdf or share it as a link\.$/,
    );
    const send = ui.getByRole("button", { name: /^Send/ }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    ui.getByLabelText(/^Send is off: This message is/);
    // Removing the big file turns Send back on.
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Remove deck.pdf" }));
      await session.flush();
    });
    expect((ui.getByRole("button", { name: /^Send/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("instant intro banner moves the introducer to Bcc and Undo returns her to To", async () => {
    const { session } = setup();
    const ui = mount({ session, introducer: "Priya Shah <priya@a.test>" });
    await act(() =>
      session.open(spec({ to: "Priya Shah <priya@a.test>", cc: "ana@b.test" })).then(() => {}),
    );
    ui.getByText("Priya Shah introduced you.");
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Move Priya to Bcc" }));
      await session.flush();
    });
    expect(session.active?.bcc).toBe("priya@a.test");
    expect(session.active?.to).toBe("");
    ui.getByText("Moved Priya to Bcc.");
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Undo" }));
      await session.flush();
    });
    expect(session.active?.to).toBe("Priya Shah <priya@a.test>");
    expect(session.active?.bcc).toBe("");
  });

  it(";; snippets preview with the first name, Tab inserts, an unknown key explains", async () => {
    const { session } = setup();
    const ui = mount({
      session,
      snippets: [
        { id: "1", name: "thanks", body: "Thanks {first name}, talk soon." },
        { id: "2", name: "later", body: "Later this week works." },
      ],
    });
    await act(() => session.open(spec()).then(() => {}));
    ui.getByText("snippets");
    const message = ui.getByLabelText("Message");
    fireEvent.change(message, { target: { value: "Hi ;;" } });
    const list = ui.getByRole("listbox", { name: "Snippets" });
    expect(within(list).getAllByRole("option").length).toBe(2);
    fireEvent.change(message, { target: { value: "Hi ;;th" } });
    const only = within(ui.getByRole("listbox", { name: "Snippets" })).getByRole("option");
    expect(only.textContent).toBe(";;thanksThanks Anna, talk soon.");
    await act(async () => {
      fireEvent.keyDown(message, { key: "Tab" });
      await session.flush();
    });
    expect((message as HTMLTextAreaElement).value).toBe("Hi Thanks Anna, talk soon.");
    fireEvent.change(message, { target: { value: "Hi ;;nope" } });
    ui.getByText("No snippet called ;;nope. Make one in Settings → Mail → Snippets.");
  });

  it("⌘Enter without recipients shows the reason", async () => {
    const { session } = setup();
    const ui = mount({ session });
    await act(() => session.open(spec({ to: "" })).then(() => {}));
    await act(async () => {
      fireEvent.keyDown(ui.getByLabelText("Message"), { key: "Enter", metaKey: true });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ui.getByRole("alert").textContent).toBe("Add a recipient.");
  });

  it("attaches picked files by opaque staging id, never a path", async () => {
    const { port, session } = setup();
    const ui = mount({
      session,
      pickFiles: async () => [{ id: "stg-1", filename: "a.pdf", size: 3 }],
    });
    await act(() => session.open(spec()).then(() => {}));
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Attach files" }));
      await new Promise((r) => setTimeout(r, 0));
      await session.flush();
    });
    const att = (await port.listDrafts())[0].doc.attachments[0];
    expect(att.id).toBe("stg-1");
    expect("path" in att).toBe(false);
    within(ui.getByRole("list", { name: "Attachments" })).getByText("a.pdf");
  });

  it("a failed send reopens with Not sent and its reason (AC11)", async () => {
    const { session } = setup();
    const ui = mount({ session });
    await act(() => session.open(spec({ draftId: "d1", lastError: "Refused" })).then(() => {}));
    expect(ui.getByRole("alert").textContent).toBe("Not sent: Refused");
  });
});

import { outboxLabel, OutboxView } from "./outbox-view";

describe("OutboxView (AC22)", () => {
  const item = {
    id: "o",
    accountId: "a",
    draftId: "d",
    subject: "Hi",
    to: ["x@y.com"],
    state: "pending",
    attempts: 0,
    lastError: null,
    notBeforeMs: 5000,
  };
  it("labels the window and offline wait, and Edit reopens", () => {
    expect(outboxLabel(item, 1000)).toBe("Sends in 4 s");
    expect(outboxLabel(item, 9000)).toBe("Waiting for connection");
    expect(outboxLabel({ ...item, state: "in_flight" }, 9000)).toBe("Sending…");
    const edited: string[] = [];
    const ui = render(<OutboxView items={[item]} nowMs={1000} onEdit={(id) => edited.push(id)} />);
    fireEvent.click(ui.getByText("Edit"));
    expect(edited).toEqual(["o"]);
  });
});
