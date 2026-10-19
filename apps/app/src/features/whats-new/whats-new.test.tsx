// REL-4 · AC8: after an update, "Updated to X · See what's new" once per
// version; the dialog groups the release's notes (New, Improved, Fixed) and
// earlier releases are one click away; Settings → About lists recent releases.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Toaster, toast } from "sonner";

import { currentPreferences, DEFAULT_PREFERENCES, updatePreferences } from "../../lib/preferences";
import { setDomainReconciledForTest } from "../../lib/prefs-sync";
import { AuthContext, type AuthContextValue } from "../../providers/auth-provider";
import { RELEASES_FIXTURE } from "./fixture";
import { ReleaseHistory } from "./release-history";
import {
  compareVersions,
  groupItems,
  parseReleases,
  SECURITY_LINE,
  whatsNewDecision,
} from "./releases";
import { WhatsNewDialog } from "./whats-new-dialog";
import { knownSince, WhatsNewOnLaunch } from "./whats-new-on-launch";
import { openWhatsNew, resetWhatsNewForTest } from "./whats-new-store";

const RELEASES = parseReleases(RELEASES_FIXTURE);
const [LATEST] = RELEASES;
const USER = "user-1";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
beforeEach(() => {
  localStorage.clear();
  updatePreferences({
    lastSeenVersion: null,
    tasksOnboarding: { ...DEFAULT_PREFERENCES.tasksOnboarding },
  });
  setDomainReconciledForTest("preferences", null);
  resetWhatsNewForTest();
});
afterEach(() => {
  toast.dismiss();
  cleanup();
});

function auth(): AuthContextValue {
  return {
    userId: USER,
    userEmail: null,
    accessToken: null,
    isSignedIn: true,
    loading: false,
    configError: null,
    runtime: null,
    planTier: "free",
    signOut: async () => {},
    refreshPlanTier: async () => {},
  };
}

function renderLaunch(version: string) {
  return render(
    <AuthContext.Provider value={auth()}>
      <Toaster />
      <WhatsNewOnLaunch version={version} releases={RELEASES} />
    </AuthContext.Provider>,
  );
}

describe("the release notes", () => {
  it("reads releases newest first, dropping a bad one alone", () => {
    const parsed = parseReleases({
      releases: [
        { version: "1.0.0", date: "2026-10-01", highlights: [], items: [] },
        { version: "1.2.0", date: "not a date", highlights: [], items: [] },
        {
          version: "1.1.0",
          date: "2026-10-18",
          highlights: ["A"],
          items: [
            { type: "new", text: "Kept" },
            { type: "bogus", text: "Dropped" },
          ],
        },
      ],
    });
    expect(parsed.map((r) => r.version)).toEqual(["1.1.0", "1.0.0"]);
    expect(parsed[0]?.items).toEqual([{ type: "new", text: "Kept" }]);
    expect(parseReleases(null)).toEqual([]);
  });

  it("groups New, Improved, Fixed in order, security as the one fixed line", () => {
    expect(groupItems(LATEST!)).toEqual([
      {
        key: "new",
        label: "New",
        items: [
          "Chat keeps your place in every conversation.",
          "Tasks remember the view you left.",
        ],
      },
      { key: "improved", label: "Improved", items: ["Notes open faster."] },
      {
        key: "fixed",
        label: "Fixed",
        items: ["Calendar events keep their time after a clock change.", SECURITY_LINE],
      },
    ]);
  });

  it("orders versions like SemVer", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBe(-1);
    expect(compareVersions("1.2.0-rc.3", "1.2.0")).toBe(-1);
    expect(compareVersions("1.2.0-rc.10", "1.2.0-rc.9")).toBe(1);
    expect(compareVersions("v1.1.0", "1.1.0")).toBe(0);
  });
});

describe("shows once per version", () => {
  const base = { running: "1.1.0", prefsReady: true, release: LATEST!, knownSince: null };

  it("waits for this session's preferences", () => {
    expect(whatsNewDecision({ ...base, lastSeen: "1.0.0", prefsReady: false })).toBe("wait");
  });

  it("shows after the version changes, then never again for it", () => {
    expect(whatsNewDecision({ ...base, lastSeen: "1.0.0" })).toBe("show");
    expect(whatsNewDecision({ ...base, lastSeen: "1.1.0" })).toBe("none");
  });

  it("never moves back: an older build stays quiet", () => {
    expect(whatsNewDecision({ ...base, running: "1.0.0", lastSeen: "1.1.0" })).toBe("none");
  });

  it("a version without notes is recorded quietly", () => {
    expect(whatsNewDecision({ ...base, lastSeen: "1.0.0", release: null })).toBe("mark");
  });

  it("with nothing recorded, only someone here before the release sees it", () => {
    expect(whatsNewDecision({ ...base, lastSeen: null })).toBe("mark");
    expect(whatsNewDecision({ ...base, lastSeen: null, knownSince: "2026-10-19T09:00:00Z" })).toBe(
      "mark",
    );
    expect(whatsNewDecision({ ...base, lastSeen: null, knownSince: "2026-10-02T09:00:00Z" })).toBe(
      "show",
    );
  });

  it("knows someone from the earliest stamp in their preferences", () => {
    expect(knownSince(currentPreferences())).toBeNull();
    updatePreferences({
      tasksOnboarding: {
        ...DEFAULT_PREFERENCES.tasksOnboarding,
        welcomeSeenAt: "2026-10-12T10:00:00Z",
        seeded: { ws: "2026-10-05T10:00:00Z" },
      },
    });
    expect(knownSince(currentPreferences())).toBe("2026-10-05T10:00:00Z");
  });

  it("toasts 'Updated to X' once, records it, and opens the dialog only on a click", async () => {
    updatePreferences({ lastSeenVersion: "1.0.0" });
    setDomainReconciledForTest("preferences", USER);
    const first = renderLaunch("1.1.0");

    expect(await screen.findByText("Updated to 1.1.0")).toBeTruthy();
    expect(currentPreferences().lastSeenVersion).toBe("1.1.0");
    // Never opens by itself.
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "See what's new" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Moduo 1.1.0 · 18 October 2026")).toBeTruthy();

    // A reload on the same version: no toast.
    act(() => toast.dismiss());
    first.unmount();
    renderLaunch("1.1.0");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText("Updated to 1.1.0")).toBeNull();
  });

  it("waits for the preferences read before deciding", async () => {
    updatePreferences({ lastSeenVersion: "1.0.0" });
    renderLaunch("1.1.0");
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText("Updated to 1.1.0")).toBeNull();
    expect(currentPreferences().lastSeenVersion).toBe("1.0.0");

    act(() => setDomainReconciledForTest("preferences", USER));
    expect(await screen.findByText("Updated to 1.1.0")).toBeTruthy();
  });
});

describe("the dialog", () => {
  it("groups the release's notes and opens earlier releases", async () => {
    render(<WhatsNewDialog releases={RELEASES} />);
    act(() => openWhatsNew({ version: "1.1.0" }));
    const dialog = await screen.findByRole("dialog");

    const groups = within(dialog)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(groups).toEqual(["New", "Improved", "Fixed", "Earlier releases"]);
    expect(within(dialog).getByText(SECURITY_LINE)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: /^1\.0\.0/ }));
    expect(within(dialog).getByText("Moduo 1.0.0 · 1 October 2026")).toBeTruthy();
    expect(within(dialog).getByText("Moduo for web, Mac and Windows.")).toBeTruthy();
    // And back to the newer one.
    fireEvent.click(within(dialog).getByRole("button", { name: /^1\.1\.0/ }));
    expect(within(dialog).getByText("Notes open faster.")).toBeTruthy();
  });

  it("links the full changelog on moduo.app", async () => {
    render(<WhatsNewDialog releases={RELEASES} />);
    act(() => openWhatsNew());
    const link = await screen.findByRole("link", { name: /Full changelog/ });
    expect(link.getAttribute("href")).toBe("https://moduo.app/changelog");
  });

  it("shows an upcoming release ahead of the bundled ones", async () => {
    render(<WhatsNewDialog releases={RELEASES} />);
    act(() =>
      openWhatsNew({
        upcoming: {
          version: "1.2.0",
          date: "2026-10-25",
          highlights: [],
          items: [{ type: "new", text: "Something new." }],
        },
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Moduo 1.2.0 · 25 October 2026")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: /^1\.1\.0/ })).toBeTruthy();
  });
});

describe("history in Settings → About", () => {
  it("lists recent releases, each opening What's new on its notes", async () => {
    render(
      <>
        <ReleaseHistory releases={RELEASES} />
        <WhatsNewDialog releases={RELEASES} />
      </>,
    );
    const rows = screen.getAllByRole("button").map((b) => b.textContent);
    expect(rows[0]).toContain("1.1.0");
    expect(rows[1]).toContain("1.0.0");
    fireEvent.click(screen.getByRole("button", { name: /^1\.0\.0/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Moduo 1.0.0 · 1 October 2026")).toBeTruthy();
  });
});
