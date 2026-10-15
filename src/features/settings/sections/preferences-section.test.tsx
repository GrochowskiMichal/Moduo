// TX-8 · Settings → Preferences → Email (specs/transactional-email.md AC40, AC42):
// three switches with the right defaults, each saved through its own RPC.
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = rs.hoisted(() => {
  const preferences = {
    getEmailPrefs: rs.fn(),
    setEmailPrefs: rs.fn(),
    setBuildUpdates: rs.fn(),
  };
  return {
    preferences,
    // One runtime for the whole run, like AuthProvider's.
    auth: { runtime: { preferences }, userId: "u-me" },
    toast: rs.fn(),
  };
});

rs.mock("../../../providers/auth-provider", () => ({ useAuth: () => mocks.auth }));
rs.mock("sonner", () => ({ toast: mocks.toast }));

import { EmailGroup } from "./preferences-section";

const DEFAULTS = { bookings: true, trialBilling: true, buildUpdates: false };

const switchFor = (name: string) => screen.getByRole("switch", { name: `${name} emails` });
const isOn = (name: string) => switchFor(name).getAttribute("aria-checked") === "true";

beforeEach(() => {
  mocks.preferences.getEmailPrefs.mockReset();
  mocks.preferences.setEmailPrefs.mockReset();
  mocks.preferences.setBuildUpdates.mockReset();
  mocks.toast.mockReset();
});
afterEach(() => cleanup());

describe("EmailGroup", () => {
  it("shows Bookings and Trial on, Build updates off, by default (AC40)", async () => {
    mocks.preferences.getEmailPrefs.mockResolvedValue(DEFAULTS);
    render(<EmailGroup />);

    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.getByText("When someone books or cancels on your links.")).toBeTruthy();
    expect(screen.getByText("About once a month.")).toBeTruthy();
    await waitFor(() => expect(switchFor("Bookings").hasAttribute("disabled")).toBe(false));
    expect(isOn("Bookings")).toBe(true);
    expect(isOn("Trial and billing reminders")).toBe(true);
    expect(isOn("Build updates")).toBe(false);
  });

  it("shows what the server has, and keeps the switches still until it answers", async () => {
    let answer: (value: unknown) => void = () => {};
    mocks.preferences.getEmailPrefs.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<EmailGroup />);
    expect(switchFor("Bookings").hasAttribute("disabled")).toBe(true);

    answer({ bookings: false, trialBilling: true, buildUpdates: true });
    await waitFor(() => expect(isOn("Bookings")).toBe(false));
    expect(isOn("Build updates")).toBe(true);
  });

  it("saves one switch at a time, naming only that one (AC40)", async () => {
    const user = userEvent.setup();
    mocks.preferences.getEmailPrefs.mockResolvedValue(DEFAULTS);
    mocks.preferences.setEmailPrefs.mockResolvedValue({ bookings: false, trialBilling: true });
    render(<EmailGroup />);
    await waitFor(() => expect(switchFor("Bookings").hasAttribute("disabled")).toBe(false));

    await user.click(switchFor("Bookings"));

    expect(mocks.preferences.setEmailPrefs).toHaveBeenCalledWith({ bookings: false });
    await waitFor(() => expect(isOn("Bookings")).toBe(false));
    expect(isOn("Trial and billing reminders")).toBe(true);

    mocks.preferences.setEmailPrefs.mockResolvedValue({ bookings: false, trialBilling: false });
    await user.click(switchFor("Trial and billing reminders"));
    expect(mocks.preferences.setEmailPrefs).toHaveBeenLastCalledWith({ trialBilling: false });
  });

  it("turns Build updates on and off through the subscription RPC (AC42)", async () => {
    const user = userEvent.setup();
    mocks.preferences.getEmailPrefs.mockResolvedValue(DEFAULTS);
    mocks.preferences.setBuildUpdates.mockImplementation(async (on: boolean) => on);
    render(<EmailGroup />);
    await waitFor(() => expect(switchFor("Build updates").hasAttribute("disabled")).toBe(false));

    await user.click(switchFor("Build updates"));
    expect(mocks.preferences.setBuildUpdates).toHaveBeenCalledWith(true);
    await waitFor(() => expect(isOn("Build updates")).toBe(true));
    expect(mocks.preferences.setEmailPrefs).not.toHaveBeenCalled();

    await user.click(switchFor("Build updates"));
    expect(mocks.preferences.setBuildUpdates).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(isOn("Build updates")).toBe(false));
  });

  it("puts a switch back and says so when saving fails", async () => {
    const user = userEvent.setup();
    mocks.preferences.getEmailPrefs.mockResolvedValue(DEFAULTS);
    mocks.preferences.setBuildUpdates.mockRejectedValue(
      new Error("Confirm your email address first."),
    );
    render(<EmailGroup />);
    await waitFor(() => expect(switchFor("Build updates").hasAttribute("disabled")).toBe(false));

    await user.click(switchFor("Build updates"));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(isOn("Build updates")).toBe(false);
  });

  it("stays hidden when the switches can't be read, rather than showing wrong ones", async () => {
    mocks.preferences.getEmailPrefs.mockRejectedValue(new Error("offline"));
    const { container } = render(<EmailGroup />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });

  it("says why Build updates can't be turned on for an unconfirmed address", async () => {
    const user = userEvent.setup();
    mocks.preferences.getEmailPrefs.mockResolvedValue(DEFAULTS);
    mocks.preferences.setBuildUpdates.mockRejectedValue(
      new Error("Confirm your email address before turning on build updates."),
    );
    render(<EmailGroup />);
    await waitFor(() => expect(switchFor("Build updates").hasAttribute("disabled")).toBe(false));
    await user.click(switchFor("Build updates"));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        "Confirm your email address before turning on build updates.",
      ),
    );
  });

  it("stays hidden before the server has the switches", async () => {
    mocks.preferences.getEmailPrefs.mockResolvedValue(null);
    const { container } = render(<EmailGroup />);
    await waitFor(() => expect(container.textContent).toBe(""));
  });
});
