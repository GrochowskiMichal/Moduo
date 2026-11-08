// The app shell's skip link (specs/mail-improve.md §6, AC26): the first focusable element
// on a route that has one, visible on focus. On Email it reads "Skip to mail list" and
// lands on the selected row (else the list). Other modules can add theirs to SKIP_LINKS.

type SkipTarget = { label: string; target: string; focus: string[] };

/** Route prefix → where its skip link goes; the first matching focus selector wins. */
const SKIP_LINKS: Record<string, SkipTarget> = {
  "/email": {
    label: "Skip to mail list",
    target: "mail-list",
    focus: ['[aria-selected="true"][data-thread-id]', '[role="listbox"]'],
  },
};

export function skipLinkFor(pathname: string): SkipTarget | null {
  for (const [prefix, link] of Object.entries(SKIP_LINKS))
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return link;
  return null;
}

export function SkipLink({ pathname }: { pathname: string }) {
  const link = skipLinkFor(pathname);
  if (!link) return null;
  const go = (e: { preventDefault(): void }) => {
    e.preventDefault();
    const root = document.querySelector<HTMLElement>(`[data-skip-target="${link.target}"]`);
    if (!root) return;
    const hit =
      link.focus.reduce<HTMLElement | null>(
        (found, sel) => found ?? root.querySelector<HTMLElement>(sel),
        null,
      ) ?? root;
    if (!hit.hasAttribute("tabindex")) hit.tabIndex = -1;
    hit.focus();
  };
  return (
    // Not an <a href>: WebKit (Safari, the Mac app's WKWebView) leaves links out of the Tab
    // order unless the person turns on "Press Tab to highlight each item"; an element with
    // its own tab stop and the link role is reachable everywhere.
    <span
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter") go(e);
      }}
      className="sr-only rounded-md bg-background text-sm font-medium text-foreground shadow-lg focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-(--z-popover) focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Padding inside: `not-sr-only` resets the element's own. */}
      <span className="block px-3 py-2">{link.label}</span>
    </span>
  );
}
