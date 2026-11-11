// HV-15 variant of benchmarks/escapes/644-1-error-read-as-empty: saving a booking link reads the
// host's `profiles` row and drops its `error`, so a failed read writes the fallbacks (the email as
// the host's name, no avatar) over the link's public host name and photo. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/calendar/ui/booking-links.644-1.variant.test.tsx
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = rs.hoisted(() => ({
  /** What a read of `profiles` answers. */
  profile: { data: null as unknown, error: null as unknown },
  /** Every update sent to `exposed_slot_links`. */
  updates: [] as Record<string, unknown>[],
  link: null as unknown,
}));

rs.mock("../../../lib/runtime.web.client", () => {
  const chain = (answer: () => unknown): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => unknown) => Promise.resolve(answer()).then(resolve);
          }
          if (prop === "update") {
            return (values: Record<string, unknown>) => {
              h.updates.push(values);
              return chain(() => ({ data: null, error: null }));
            };
          }
          return () => chain(answer);
        },
      },
    );
  const answerFor = (table: string) => () => {
    if (table === "profiles") return h.profile;
    if (table === "exposed_slot_links") return { data: [h.link], error: null };
    return { data: [], error: null };
  };
  return {
    supabaseClient: {
      from: (table: string) => chain(answerFor(table)),
      rpc: async (name: string) => ({
        data: name === "booking_google_connected" ? true : null,
        error: null,
      }),
      functions: { invoke: async () => ({ data: {}, error: null }) },
      auth: { getUser: async () => ({ data: { user: { id: "u1", email: "ada@example.com" } } }) },
    },
  };
});

rs.mock("../../workspaces/workspace-context", () => ({
  useWorkspace: () => ({ members: [] }),
}));

rs.mock("../connect-return", () => ({
  CONNECT_FINISHED_EVENT: "moduo:connect-finished",
  finishConnectReturn: async () => null,
  rememberConnectStart: () => {},
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { BookingLinks } from "./booking-links";

afterEach(cleanup);

const LINK = {
  id: "l1",
  slot_id: "s1",
  slug: "intro",
  name: "Intro call",
  description: "",
  duration_minutes: 30,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  date_range_days: 14,
  min_notice_minutes: 240,
  host_timezone: "Europe/Warsaw",
  weekly_hours: null,
  busy_calendar_ids: ["moduo"],
  note_enabled: true,
  guests_enabled: true,
  questions_json: [],
  paused: false,
  video_provider: "google_meet",
  owner_display_name: "Ada Lovelace",
  owner_avatar_url: "https://example.com/ada.png",
};

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 644-1: a failed profile read rewrites the booking link's host", () => {
  it("saving a link while the profile read fails never replaces the host's name and photo with fallbacks", async () => {
    h.link = LINK;
    h.updates.length = 0;
    // The network hiccups on the profile read only.
    h.profile = { data: null, error: { message: "fetch failed", code: "" } };

    render(
      <TooltipProvider>
        <BookingLinks runtime={null} workspaceId="w1" userId="u1" accounts={[]} />
      </TooltipProvider>,
    );
    fireEvent.click(await screen.findByText("Intro call"));
    const save = await screen.findByRole("button", { name: "Save link" });
    fireEvent.click(save);

    // Give the save time to run to its end, whichever way it goes.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull());
    await new Promise((r) => setTimeout(r, 50));

    // The damage: an update that names the host by their email and drops their photo.
    const clobbering = h.updates.filter(
      (u) =>
        "owner_display_name" in u &&
        (u.owner_display_name !== "Ada Lovelace" || u.owner_avatar_url === null),
    );
    expect(clobbering).toEqual([]);
  });
});
