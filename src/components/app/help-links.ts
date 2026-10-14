// Where the top bar's Help menu points (tasks-v3 call 96: Help is there for the
// alpha and beta). Pure data and helpers, kept apart from the menu so the
// addresses and the report text are unit-testable. No React here.

import { APP_BUILD, APP_VERSION, IS_DESKTOP } from "../../features/settings/about";

/** The docs. moduo.app/docs falls through to the landing page until it's built. */
export const DOCS_URL = "https://moduo.app/docs";

/** Contact support (Maciej, 2026-10-10). The mailbox is new. */
export const SUPPORT_EMAIL = "support@moduo.app";

/** Bug reports go to the inbox the Terms already name for "something doesn't work". */
export const BUG_REPORT_EMAIL = "hello@moduo.app";

/** What a bug report carries besides the person's words. */
export type BugReportContext = {
  version: string;
  build: string;
  platform: "web" | "desktop";
  /** The route path only: no query string, so no ids or tokens leave the app. */
  page: string;
};

export function bugReportContext(page: string): BugReportContext {
  return {
    version: APP_VERSION,
    build: APP_BUILD,
    platform: IS_DESKTOP ? "desktop" : "web",
    page,
  };
}

/** "Moduo 1.4.0 (build a1b2c3d) · web · /tasks": the line shown under the form. */
export function describeBugReportContext(ctx: BugReportContext): string {
  return `Moduo ${ctx.version} (build ${ctx.build}) · ${ctx.platform} · ${ctx.page}`;
}

/** The report's body: what happened, then the attached context. */
export function formatBugReport(description: string, ctx: BugReportContext): string {
  return [
    description.trim(),
    "",
    "--",
    `Moduo ${ctx.version} (build ${ctx.build})`,
    `Platform: ${ctx.platform}`,
    `Page: ${ctx.page}`,
  ].join("\n");
}

const SUBJECT_MAX = 60;

/** "Bug: The timer froze after…": the first line, cut to fit a subject. */
export function bugReportSubject(description: string): string {
  const firstLine = description.trim().split("\n")[0]?.trim() ?? "";
  if (!firstLine) return "Bug report";
  // Cut by code point: half an emoji would make encodeURIComponent throw.
  const chars = Array.from(firstLine);
  const cut =
    chars.length > SUBJECT_MAX ? `${chars.slice(0, SUBJECT_MAX).join("").trimEnd()}…` : firstLine;
  return `Bug: ${cut}`;
}

/** A `mailto:` link with an encoded subject and optional body. */
export function mailtoUrl(to: string, subject: string, body?: string): string {
  const params = [`subject=${encodeURIComponent(subject)}`];
  if (body) params.push(`body=${encodeURIComponent(body)}`);
  return `mailto:${to}?${params.join("&")}`;
}
