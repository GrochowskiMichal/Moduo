// REL-4 · AC9: the desktop update toast shows the new version's two
// highlights, read from the updater manifest's notes (Markdown), with
// Update & restart and See what's new.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Toaster, toast } from "sonner";

import { WhatsNewDialog } from "../whats-new/whats-new-dialog";
import { resetWhatsNewForTest } from "../whats-new/whats-new-store";
import { manifestHighlights, releaseFromManifest } from "./manifest-notes";
import { showUpdateToast } from "./update-toast";

const NOTES = [
  "## Highlights",
  "- Chat keeps your place",
  "- **Tasks** remember your view",
  "- A third one",
  "",
  "### New",
  "- Chat keeps your place in every conversation.",
  "### Improved",
  "* Notes open faster.",
  "### Fixed",
  "- Calendar events keep their time.",
].join("\n");

beforeEach(resetWhatsNewForTest);
afterEach(() => {
  toast.dismiss();
  cleanup();
});

describe("two highlights", () => {
  it("reads the Highlights section, at most two, as plain text", () => {
    expect(manifestHighlights(NOTES)).toEqual([
      "Chat keeps your place",
      "Tasks remember your view",
    ]);
  });

  it("without a Highlights heading, the first two bullets", () => {
    expect(manifestHighlights("- One\n- Two\n- Three")).toEqual(["One", "Two"]);
  });

  it("no notes, no highlights", () => {
    expect(manifestHighlights(null)).toEqual([]);
    expect(manifestHighlights("Production build from commit abc1234")).toEqual([]);
  });

  it("turns the notes into a release What's new can show", () => {
    expect(
      releaseFromManifest({ version: "1.2.0", body: NOTES, date: "2026-10-25T10:00:00Z" }),
    ).toMatchObject({
      version: "1.2.0",
      date: "2026-10-25",
      items: [
        { type: "new", text: "Chat keeps your place in every conversation." },
        { type: "improved", text: "Notes open faster." },
        { type: "fixed", text: "Calendar events keep their time." },
      ],
    });
    expect(releaseFromManifest({ version: "1.2.0", body: "", date: null })).toBeNull();
  });

  it("the toast shows them under the title, with Update & restart and See what's new", async () => {
    const onUpdate = rs.fn();
    render(
      <>
        <Toaster />
        <WhatsNewDialog releases={[]} />
      </>,
    );
    act(() => showUpdateToast({ version: "1.2.0", body: NOTES, date: null }, onUpdate));

    const title = await screen.findByText("Moduo 1.2.0 is ready");
    const toastEl = title.closest("[data-sonner-toast]") as HTMLElement;
    const items = within(toastEl)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual(["Chat keeps your place", "Tasks remember your view"]);

    fireEvent.click(within(toastEl).getByRole("button", { name: "Update & restart" }));
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it("See what's new opens the next version's notes", async () => {
    render(
      <>
        <Toaster />
        <WhatsNewDialog releases={[]} />
      </>,
    );
    act(() => showUpdateToast({ version: "1.2.0", body: NOTES, date: null }, () => {}));
    fireEvent.click(await screen.findByRole("button", { name: "See what's new" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Notes open faster.")).toBeTruthy();
  });
});
