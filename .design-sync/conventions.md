# Moduo design system — how to build with it

Moduo is a **dark-first** product UI. Components are real compiled React from
`window.ModuoDS.*`; you style your own layout glue with **Tailwind v4 semantic
tokens** (no hardcoded colors). The dark canvas is the default — the app
background is pure black and surfaces step up from there.

## Setup / wrapping

- **Dark canvas is automatic.** `:root` defines the dark tokens and the bundled
  `styles.css` sets `body { background: var(--background); color: var(--foreground) }`.
  Don't add a `.dark` class or a theme toggle — just build on the default surface.
- **Wrap tooltip-bearing UI in a provider.** Any component that shows a tooltip
  (`IconButton` with a label, `SegmentedControl`, `Toolbar`, and `Tooltip` itself)
  must sit inside a single `<TooltipProvider>` near the root, or the tooltip throws
  "must be used within `TooltipProvider`". One provider at the top of the tree covers
  the whole app:

  ```jsx
  const { TooltipProvider, Button, Card, CardHeader, CardTitle, CardContent } = window.ModuoDS;
  <TooltipProvider>
    <main className="min-h-screen bg-background text-foreground p-8">
      <Card className="max-w-md">
        <CardHeader><CardTitle>Weekly review</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">3 notes pending</p>
          <Button>Start review</Button>
        </CardContent>
      </Card>
    </main>
  </TooltipProvider>
  ```
- Overlay components (`Dialog`, `Sheet`, `Popover`, `DropdownMenu`, `ContextMenu`,
  `Command`, `Tooltip`, `Select`) are **trigger + content** compounds — render the
  trigger inline and let them open on interaction (don't force an `open` prop unless
  you want a controlled, always-open state).

## Styling idiom — semantic tokens only

Style layout glue with these Tailwind utility families (all backed by `var(--*)`
tokens; never use raw hex or arbitrary color values):

| Need | Class |
| --- | --- |
| App background | `bg-background` |
| Panel / card / raised surface | `bg-card` |
| Popover / menu surface | `bg-popover` |
| Input well | `bg-muted` |
| Row hover fill | `hover:bg-accent` |
| Primary action | `bg-primary text-primary-foreground` (the brand pink) |
| Secondary action | `bg-secondary text-secondary-foreground` |
| Destructive action | `bg-destructive text-destructive-foreground` |
| Default text | `text-foreground` |
| Secondary / caption text | `text-muted-foreground` |
| Hairline border | `border border-border` |
| Focus ring | `focus-visible:ring-2 focus-visible:ring-ring` |
| Status | `text-success` · `bg-warning` · `text-info` (pair with an icon/label, never color alone) |
| Display heading | `font-display` |
| Body | default (`font-sans` → Geist) |
| Code / shortcuts | `font-mono` (Geist Mono) |
| Card rounding | `rounded-lg` · controls `rounded-md` · dialogs `rounded-xl` |

The brand display font is **Pilat Extended** (`font-display`); it is a licensed
font the host app installs locally, so it falls back to the body stack if absent —
prefer it for large headings but don't depend on it for body copy.

## Where the truth lives

- **Styling:** read the bound `styles.css` and its `@import` of `_ds_bundle.css`
  (the full compiled token set + utilities) before inventing class names.
- **Per component:** each `components/<group>/<Name>/<Name>.prompt.md` (usage) and
  `<Name>.d.ts` (`<Name>Props` — the real prop contract). Compose compounds from
  their sub-exports (e.g. `Card` + `CardHeader`/`CardContent`, `DropdownMenu` +
  `DropdownMenuTrigger`/`DropdownMenuItem`) — all are on `window.ModuoDS`.
