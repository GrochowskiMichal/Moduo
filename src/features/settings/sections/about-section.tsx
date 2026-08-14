import { Eyebrow } from "../../../components/ui/eyebrow";
import { useAuth } from "../../../providers/auth-provider";
import {
  ABOUT_LINKS,
  ABOUT_RUNTIME_LINE,
  ABOUT_STORAGE_LINE,
  ABOUT_TAGLINE,
  IS_DESKTOP,
  versionLabel,
} from "../about";
import { SettingsSectionShell } from "./section-shell";

export function AboutSection() {
  const { runtime } = useAuth();

  const openExternal = (href: string) => (event: React.MouseEvent<HTMLAnchorElement>) => {
    // Desktop must hand off to the system browser (a webview target=_blank
    // won't); web routes through the same helper (window.open with noopener).
    if (runtime) {
      event.preventDefault();
      void runtime.window.openExternalUrl(href);
    }
  };

  return (
    <SettingsSectionShell title="About" description="Moduo — a cloud-first workspace.">
      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-lg text-foreground">moduo</h3>
        <p className="mt-1 text-sm text-muted-foreground">{ABOUT_TAGLINE}</p>

        <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <Eyebrow as="dt">Version</Eyebrow>
            <dd className="mt-1 text-foreground">{versionLabel()}</dd>
            {IS_DESKTOP ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Updates install when you download the latest build.
              </p>
            ) : null}
          </div>
          <div>
            <Eyebrow as="dt">Storage</Eyebrow>
            <dd className="mt-1 text-foreground">{ABOUT_STORAGE_LINE}</dd>
          </div>
          <div>
            <Eyebrow as="dt">Runtime</Eyebrow>
            <dd className="mt-1 text-foreground">{ABOUT_RUNTIME_LINE}</dd>
          </div>
        </dl>

        <nav
          aria-label="About links"
          className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border pt-4"
        >
          {ABOUT_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openExternal(link.href)}
              className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card rounded-sm"
            >
              {link.label}
            </a>
          ))}
        </nav>
      </section>
    </SettingsSectionShell>
  );
}
