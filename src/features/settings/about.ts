// Pure data + helpers for Settings → About (DF-19i). Kept separate from the
// section component so the copy/links are unit-testable (AC12) and so the
// version/build define lookup lives in one place (also read by Diagnostics,
// DF-19g). No React here.

/** App version — baked from package.json at build time; "0.0.0" in tests/dev. */
export const APP_VERSION: string = (import.meta.env.MODUO_VERSION as string | undefined) ?? "0.0.0";

/** Build id — short git SHA at build time (or a CI-injected value); "dev" otherwise. */
export const APP_BUILD: string = (import.meta.env.MODUO_BUILD as string | undefined) ?? "dev";

/** Desktop (Tauri) shell vs the web build — drives the "check for updates" hint. */
export const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const ABOUT_TAGLINE =
  "Notes, tasks, calendar, email, and contacts — synced across web and desktop, in one window.";

/** One-line storage truth (cloud-first). Surfaced under Storage in About. */
export const ABOUT_STORAGE_LINE = "Cloud sync (Supabase)";

/** Runtime line surfaced under Runtime in About. */
export const ABOUT_RUNTIME_LINE = "Web & desktop (Tauri 2) · React 19";

export type AboutLink = { label: string; href: string; kind: "changelog" | "legal" | "support" };

/**
 * External links shown at the bottom of About. All point at the canonical
 * marketing domain (moduo.app) so they stay correct as the pages fill in.
 */
export const ABOUT_LINKS: AboutLink[] = [
  { label: "What's new", href: "https://moduo.app/changelog", kind: "changelog" },
  { label: "Privacy", href: "https://moduo.app/privacy", kind: "legal" },
  { label: "Terms", href: "https://moduo.app/terms", kind: "legal" },
  { label: "Support", href: "https://moduo.app/support", kind: "support" },
];

/** "1.0.0 · build a1b2c3d" — the compact version string shown in About. */
export function versionLabel(version: string = APP_VERSION, build: string = APP_BUILD): string {
  return `${version} · build ${build}`;
}
