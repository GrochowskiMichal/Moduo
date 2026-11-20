import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { EmailThreadRef } from "../../../lib/runtime.types";
import { EmailWebView } from "./email-web-view";
import { readThreadLinks, type WebLinkedEntity } from "./use-web-thread-links";

afterEach(cleanup);

const empty = { tissueRefs: [] };

const ref = (id: string, subject: string, extra: Partial<EmailThreadRef> = {}): EmailThreadRef => ({
  id,
  workspaceId: "w1",
  ownerId: "me",
  accountId: null,
  threadKey: `thread-${id}`,
  messageKey: null,
  fromAddr: "ana@acme.test",
  fromName: "Ana Lima",
  subject,
  snippet: "",
  sentAt: "2026-11-05T10:00:00.000Z",
  isSnoozed: false,
  snoozeUntil: null,
  followUpAt: null,
  followUpClearedAt: null,
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
  ...extra,
});

describe("EmailWebView (AC36)", () => {
  it("loading: shows a loading state, not the empty state, until the tissue arrives", () => {
    const { rerender } = render(
      <EmailWebView email={{ ...empty, loading: true }} highlightedRefId={null} />,
    );
    screen.getByRole("status", { name: "Loading email" });
    expect(screen.queryByText("No linked conversations yet")).toBeNull();
    rerender(<EmailWebView email={{ ...empty, loading: false }} highlightedRefId={null} />);
    expect(screen.queryByRole("status", { name: "Loading email" })).toBeNull();
    screen.getByText("No linked conversations yet");
    screen.getByText("Link an email to a task on your Mac and it shows here.");
  });

  it("honest banner, linked only, chips", () => {
    const refs = [
      ref("r1", "Pilot terms"),
      ref("r2", "Snoozed only", { isSnoozed: true, snoozeUntil: "2026-11-09T08:00:00.000Z" }),
      ref("r3", "Follow-up only", { followUpAt: "2026-11-01T08:00:00.000Z" }),
      ref("r4", "Board deck"),
    ];
    const links: Record<string, WebLinkedEntity[]> = {
      r1: [
        { kind: "task", id: "t1", title: "Sign the pilot" },
        { kind: "calendar_event", id: "e1", title: "Pilot kickoff" },
      ],
      r4: [{ kind: "note", id: "n1", title: "Board prep" }],
    };
    const opened: string[] = [];
    render(
      <EmailWebView
        email={{ tissueRefs: refs }}
        links={links}
        highlightedRefId={null}
        onOpenEntity={(e) => opened.push(`${e.kind}:${e.id}`)}
      />,
    );
    const banner = screen.getByRole("note");
    expect(banner.textContent).toContain("Mail lives on your Mac.");
    expect(banner.textContent).toContain("Snoozes and follow-ups stay on the Mac.");
    screen.getByRole("link", { name: "Open Moduo for Mac" });

    const section = screen.getByRole("region", { name: "Linked conversations" });
    expect(section.textContent).toContain("Linked conversations 2");
    expect(section.textContent).toContain("Pilot terms");
    expect(section.textContent).toContain("Board deck");
    // Nothing claims snoozes or follow-ups here.
    expect(screen.queryByText("Snoozed only")).toBeNull();
    expect(screen.queryByText("Follow-up only")).toBeNull();
    expect(screen.queryByText("Snoozed")).toBeNull();
    expect(screen.queryByText("Follow-ups due")).toBeNull();

    const card = section.querySelector('[data-thread-ref-id="r1"]') as HTMLElement;
    fireEvent.click(within(card).getByRole("button", { name: "Open task: Sign the pilot" }));
    fireEvent.click(within(card).getByRole("button", { name: "Open event: Pilot kickoff" }));
    within(card).getByText("Continue on Mac");
    expect(opened).toEqual(["task:t1", "calendar_event:e1"]);
  });

  it("reads each thread's linked tasks, notes and events, named from the registry", async () => {
    const spine = {
      listLinks: async ({ entityId }: { entityId: string }) =>
        entityId === "r1"
          ? [
              {
                sourceType: "task",
                sourceId: "t1",
                targetType: "email_thread",
                targetId: "r1",
                deletedAt: null,
              },
              {
                sourceType: "email_thread",
                sourceId: "r1",
                targetType: "contact",
                targetId: "c1",
                deletedAt: null,
              },
              {
                sourceType: "note",
                sourceId: "n9",
                targetType: "email_thread",
                targetId: "r1",
                deletedAt: "x",
              },
            ]
          : [],
      getEntities: async ({ refs }: { refs: { type: string; id: string }[] }) =>
        refs.map((r) => ({
          workspaceId: "w1",
          type: r.type,
          id: r.id,
          label: "Sign the pilot",
          icon: null,
          deletedAt: null,
        })),
    };
    const out = await readThreadLinks(spine as never, "w1", [ref("r1", "a"), ref("r2", "b")]);
    expect(out).toEqual({ r1: [{ kind: "task", id: "t1", title: "Sign the pilot" }], r2: [] });
  });
});

// specs/mail-improve.md MI-0, AC25 (web): the web view hides compose and + in the bottom
// bar while it shows, and its conversations sit in one centred column at --measure-thread.
describe("no compose on web (AC25)", () => {
  it("hides Quick capture and Create new while mounted; one centred column", async () => {
    const { GlobalBottomBar } = await import("../../../components/app/global-bottom-bar");
    const { TooltipProvider } = await import("../../../components/ui/tooltip");
    const bar = render(
      <TooltipProvider>
        <GlobalBottomBar />
      </TooltipProvider>,
    );
    within(bar.container).getByRole("button", { name: /^Create new/ });
    const view = render(
      <EmailWebView email={{ ...empty, loading: false }} highlightedRefId={null} />,
    );
    expect(within(bar.container).queryByRole("button", { name: /^Create new/ })).toBeNull();
    expect(within(bar.container).queryByRole("button", { name: /^Quick capture/ })).toBeNull();
    within(bar.container).getByRole("button", { name: /^Search/ });
    const column = view.container.querySelector<HTMLElement>("[data-web-column]")!;
    expect(column.className).toContain("max-w-(--measure-thread)");
    expect(column.className).toContain("mx-auto");
    view.unmount();
    within(bar.container).getByRole("button", { name: /^Create new/ });
  });
});
