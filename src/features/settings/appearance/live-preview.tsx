import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";

export function AppearanceLivePreview() {
  return (
    <aside
      aria-label="Appearance preview"
      className="flex flex-col rounded-lg border border-border bg-card p-6"
    >
      <header className="flex items-center justify-between gap-3">
        <h3 className="font-display text-sm text-foreground">Live preview</h3>
        <span className="text-xs text-muted-foreground">Updates instantly</span>
      </header>

      <div className="mt-4 flex flex-col gap-4 rounded-md border border-border bg-background p-5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Notes</span>
          <span aria-hidden>/</span>
          <span>How surfaces feel</span>
        </div>

        <h4 className="font-display text-2xl text-foreground">A quiet instrument</h4>

        <p className="text-sm leading-relaxed text-foreground">
          Body text reads cleanly against the canvas. Headings carry the display font; paragraphs
          stay calm. The accent colour shows up where you act, not where you read.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge>focus</Badge>
          <Badge variant="secondary">reading</Badge>
          <Badge variant="outline">tagged</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Primary action</Button>
          <Button size="sm" variant="outline">
            Secondary
          </Button>
          <Button size="sm" variant="ghost">
            Quiet
          </Button>
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        Every appearance axis applies through the cascade — no reload, no flash.
      </p>
    </aside>
  );
}
