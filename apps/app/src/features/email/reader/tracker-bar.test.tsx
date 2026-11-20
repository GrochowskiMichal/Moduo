import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { MailThread } from "@/lib/runtime.types.mail-engine";

import { message, oneThreadEngine, row } from "../testing/reader-kit";
import { MailReader } from "./mail-reader";
import { withDarkSurface } from "./sanitize";
import { TrackerBar } from "./tracker-bar";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

// One remote picture and two tracking pixels.
const HTML = `<p>Hello</p><img src="https://cdn.lumen.test/hero.png" alt="hero">
<img src="https://lumen.list-manage.com/track/open.php?u=1" width="1" height="1">
<img src="https://x.test/o.gif" style="width:1px;height:1px">`;

describe("tracker bar (specs/mail-v3.md §8, AC25)", () => {
  it("copy, Always remembers sender", async () => {
    let allowed = false;
    const setImageAllow = rs.fn(async (_address: string, allow: boolean) => {
      allowed = allow;
    });
    const thread = (): MailThread => ({
      row: row({ senders: [{ name: "Lumen", email: "news@lumen.test" }] }),
      imagesAllowed: allowed,
      messages: [
        message({ from: { name: "Lumen", email: "news@lumen.test" }, html: HTML, text: null }),
      ],
    });
    const engine = oneThreadEngine(thread, { setImageAllow });
    const behavior = { remoteImages: "block", trackerBlocking: true } as const;
    const ui = render(
      <TooltipProvider>
        <MailReader engine={engine} threadId="t1" version={0} behavior={behavior} />
      </TooltipProvider>,
    );
    await tick();
    const bar = screen.getByRole("status", { name: "Privacy" });
    expect(bar.textContent).toContain("2 trackers blocked · images off");
    expect(screen.getByText("2 trackers blocked").tagName).toBe("B");
    screen.getByRole("button", { name: "Load images" });

    fireEvent.click(screen.getByRole("button", { name: "Always load images from Lumen" }));
    await tick();
    expect(setImageAllow).toHaveBeenCalledWith("news@lumen.test", true);
    // Images load at once; trackers stay stripped, so the bar keeps only their count.
    expect(screen.getByRole("status", { name: "Privacy" }).textContent).not.toContain("images off");
    expect(screen.queryByRole("button", { name: "Load images" })).toBeNull();

    // Opened again later, the engine's answer (`imagesAllowed`) keeps them on.
    ui.rerender(
      <TooltipProvider>
        <MailReader engine={engine} threadId="t1" version={1} behavior={behavior} key="again" />
      </TooltipProvider>,
    );
    await tick();
    expect(screen.queryByText(/images off/)).toBeNull();
  });

  it("hidden when nothing was blocked; Original colours toggles in dark mode", () => {
    const onToggle = rs.fn();
    const ui = render(
      <TrackerBar trackers={0} imagesBlocked={0} senderName="Ana" onLoadImages={() => {}} />,
    );
    expect(ui.container.textContent).toBe("");
    ui.rerender(
      <TrackerBar
        trackers={1}
        imagesBlocked={0}
        senderName="Ana"
        onLoadImages={() => {}}
        colours={{ original: false, onToggle }}
      />,
    );
    expect(screen.getByRole("status", { name: "Privacy" }).textContent).toContain(
      "1 tracker blocked",
    );
    fireEvent.click(screen.getByRole("button", { name: "Original colours" }));
    expect(onToggle).toHaveBeenCalled();
    ui.rerender(
      <TrackerBar
        trackers={0}
        imagesBlocked={0}
        senderName="Ana"
        onLoadImages={() => {}}
        colours={{ original: true, onToggle }}
      />,
    );
    expect(screen.getByRole("button", { name: "Back to dark" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("the dark surface lands inside the frame's document", () => {
    const doc = "<html><body><p>x</p></body></html>";
    const dark = withDarkSurface(doc);
    expect(dark).toContain("invert(1) hue-rotate(180deg)");
    expect(dark.indexOf("<style>")).toBeLessThan(dark.lastIndexOf("</body>"));
  });
});
