import { SettingsSectionShell } from "./section-shell";

export function AboutSection() {
  return (
    <SettingsSectionShell title="About" description="Moduo — a local-first workspace.">
      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-lg text-foreground">moduo</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Notes, mindmaps, tasks, and email — running on your machine, in one window.
        </p>
        <dl className="mt-5 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Storage</dt>
            <dd className="mt-1 text-foreground">Local Redb vault</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Runtime</dt>
            <dd className="mt-1 text-foreground">Tauri 2 · React 19</dd>
          </div>
        </dl>
      </section>
    </SettingsSectionShell>
  );
}
