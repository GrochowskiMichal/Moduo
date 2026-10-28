// The offer card (CALR-19, specs/calendar-rethink.md AC34): the picks so far,
// the message as it will be copied, "Hold them on your calendar until one is
// picked (48 hours)", Copy link (⌘C) and Copy as text (⇧⌘C), and Release holds
// once the offer holds times.
process.env.TZ = "Europe/Warsaw";

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { OfferCard, type OfferCardProps } from "./offer-card";

const TUE_0900 = new Date("2026-11-03T08:00:00.000Z").getTime();
const WED_1000 = new Date("2026-11-04T09:00:00.000Z").getTime();
const HOLD = "Hold them on your calendar until one is picked (48 hours)";

function props(over: Partial<OfferCardProps> = {}): OfferCardProps {
  return {
    title: "Intro call",
    durationMinutes: 30,
    timeZone: "Europe/Warsaw",
    picks: [WED_1000, TUE_0900],
    url: null,
    hold: true,
    onHoldChange: rs.fn(),
    onCopyLink: rs.fn(),
    onCopyText: rs.fn(),
    ...over,
  };
}

afterEach(() => cleanup());

describe("OfferCard (AC34)", () => {
  it("lists the picks in time order and the message as it will be copied", () => {
    render(<OfferCard {...props()} />);
    const tue = screen.getAllByText(/Tue 3 Nov, 09:00–09:30/);
    const wed = screen.getAllByText(/Wed 4 Nov, 10:00–10:30/);
    expect(tue.length).toBeGreaterThan(0);
    expect(wed.length).toBeGreaterThan(0);
    expect(tue[0]!.compareDocumentPosition(wed[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText(/Would one of these work\?/)).toBeTruthy();
    expect(screen.getAllByText(/Warsaw time/).length).toBeGreaterThan(0);
  });

  it("names the meeting it offers", () => {
    render(<OfferCard {...props()} />);
    expect(screen.getAllByText(/Intro call/).length).toBeGreaterThan(0);
  });

  it("holds by default and says for how long; the box toggles it", () => {
    const onHoldChange = rs.fn();
    render(<OfferCard {...props({ onHoldChange })} />);
    const box = screen.getByRole("checkbox", { name: HOLD });
    expect(box.getAttribute("aria-checked") === "true" || (box as HTMLInputElement).checked).toBe(true);
    fireEvent.click(box);
    expect(onHoldChange).toHaveBeenCalledWith(false);
  });

  it("copies the link and the text through its buttons", () => {
    const onCopyLink = rs.fn();
    const onCopyText = rs.fn();
    render(<OfferCard {...props({ onCopyLink, onCopyText })} />);
    fireEvent.click(screen.getByRole("button", { name: /Copy link/ }));
    fireEvent.click(screen.getByRole("button", { name: /Copy as text/ }));
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    expect(onCopyText).toHaveBeenCalledTimes(1);
  });

  it("can't copy before a time is picked", () => {
    const onCopyLink = rs.fn();
    render(<OfferCard {...props({ picks: [], onCopyLink })} />);
    const copy = screen.getByRole("button", { name: /Copy link/ }) as HTMLButtonElement;
    expect(copy.disabled || copy.getAttribute("aria-disabled") === "true").toBe(true);
    fireEvent.click(copy);
    expect(onCopyLink).not.toHaveBeenCalled();
  });

  it("once made, shows its link and keeps the hold choice it was made with", () => {
    render(<OfferCard {...props({ url: "https://moduo.app/book/r/intro-4kq7xzt2" })} />);
    expect(screen.getAllByText(/moduo\.app\/book\/r\/intro-4kq7xzt2/).length).toBeGreaterThan(0);
    const box = screen.getByRole("checkbox", { name: HOLD }) as HTMLInputElement;
    expect(box.disabled || box.getAttribute("aria-disabled") === "true" || box.hasAttribute("data-disabled")).toBe(true);
  });

  it("offers Release holds only when it holds times", () => {
    const onRelease = rs.fn();
    const { rerender } = render(<OfferCard {...props()} />);
    expect(screen.queryByRole("button", { name: /Release holds/ })).toBeNull();
    rerender(<OfferCard {...props({ url: "https://moduo.app/book/r/x", onRelease })} />);
    fireEvent.click(screen.getByRole("button", { name: /Release holds/ }));
    expect(onRelease).toHaveBeenCalledTimes(1);
  });
});
