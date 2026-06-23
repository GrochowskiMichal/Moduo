# design-sync notes — Moduo design system

This repo is a **Tauri/React application**, not a published component library, so the
sync uses several non-default mechanisms. Read this before re-syncing.

## Shape & target

- Shape: **storybook** (`.storybook/main.ts` at repo root). Project: **Moduo Design System**
  (`projectId` in config.json). Synced scope = the **design-system core (~39)**: the 32
  `src/components/ui/*` primitives + 7 shared chrome components directly under
  `src/components/*`. App-feature components (dashboard widgets, mindmap, notes, email,
  app shell — `src/features/**`, `src/components/app/**`, `src/components/auth/**`) are
  **intentionally excluded** (live data, Tauri, Yjs, XYFlow — not static, not DS parts).

## Why the bespoke setup (the load-bearing pieces)

- **No component-library dist.** The bundle is built from a hand-authored barrel
  `.design-sync/entry.tsx` (explicit named re-exports of every storied component +
  `AuthContext`/`WorkspaceContext`). `cfg.entry` points at it. `export *` does NOT work —
  esbuild emits a runtime `__reExport` that's invisible to the metafile, so the export
  scan reads 0 symbols. Use **explicit** `export { A, B } from "@/components/..."`.
- **No shipped `.d.ts`.** `exportedNames` reads a types tree; this app ships none. We
  generate one with `tsc` into `.design-sync/ds-types/` (config `tsconfig.dts.json`) and
  point `package.json` `"types"` at `.design-sync/ds-types/index.d.ts`. That single
  `types` field is the ONLY edit outside `.design-sync/`. tsc exits 2 (unrelated
  `import.meta.env` typing in lib files) but still emits all component `.d.ts` — that's fine.
- **titleMap is required.** Story titles are kebab leaves (`Components/ui/button`);
  `titleParts` does EXACT (not fuzzy) matching against PascalCase exports, so every title
  needs a `cfg.titleMap` entry (`button`→`Button`, `sonner`→`Toaster`,
  `resizable`→`ResizablePanelGroup`, etc.).

## Scoped Storybook configs

- `.design-sync/sb-config/` — used by the converter for the **decorator bundle**. Its
  `preview.tsx` is providers-only (NO css/font imports — the converter's decorator esbuild
  has no `.woff2` loader, so a `global.css` import breaks it).
- `.design-sync/sb-ref/` — used to **build the reference oracle** (`sb-reference/`). Its
  `preview.tsx` adds `global.css` + fonts then re-exports sb-config's. Build with:
  `storybook build -c .design-sync/sb-ref -o .design-sync/sb-reference`.
- Both `main.ts` alias `@`→`src` (the repo's own `.storybook/main.ts` aliases `@`→repo
  root, which is buggy — `@/lib/utils` wouldn't resolve under strict rollup) and
  `moduo2.0`→`.design-sync/entry.tsx`.

## [GENERAL] fixes baked into config / scoped configs

- **Decorator router removed.** The real preview wraps every story in a TanStack
  `RouterProvider` (memory history). None of the 39 core components use the router, and
  re-bundling it outside Storybook made every story render as an undefined element
  ("…SafeFragment" = the router's internal shell). The decorator now renders the story
  directly inside Auth/Workspace/Tooltip providers.
- **No JSX fragments in decorators.** The converter's decorator-bundle React shim leaves
  `Fragment` undefined, so `<>{children}</>` renders as an invalid element. `AppearanceSync`
  returns `children` directly.
- **Context identity.** The decorator imports `AuthContext`/`WorkspaceContext`/
  `TooltipProvider` from `"moduo2.0"` (→ `window.ModuoDS` via the converter dsShim; → the
  barrel via the vite alias) so the providers are the SAME instances the bundled components
  read. Importing them from `@/` source paths makes separate instances →
  "useWorkspace/Tooltip must be used within Provider".
- **Dark canvas.** The DS is dark by default (`:root --background` = pure black). The
  converter's preview template appends an inline `body{background:#fff}` after the
  stylesheet link, so without an override the cards render white and outline/ghost
  variants vanish. We append `html,body{background:var(--background)!important;color:var(--foreground)}`
  to the compiled css entry (see regen).
- **CSS.** Tailwind v4 has no static stylesheet; we use the **storybook-compiled** css as
  `cfg.cssEntry`. After each reference build, copy the hashed `sb-reference/assets/preview-*.css`
  to a stable `_ds_compiled.css` (same dir, so relative font urls resolve) and append the
  dark-canvas rule. (Regen automates this.)

## Fonts (accepted state — verified, not rationalized)

- **Shipping:** Geist Sans (body, latin), Geist Mono (code, latin via `cfg.extraFonts`),
  plus latin Fraunces/Inter/Nunito/Equity-from-storybook.
- **`Pilat Extended` (display) cannot ship** — its `@font-face` in `global.css` is
  `local()`-only (a licensed font the app expects installed locally; there is no file in
  the repo to bundle). Falls back to the body stack. The reference falls back too. Accepted.
- `[FONT_MISSING]` list (`Cambria`, `Palatino Linotype`, `Book Antiqua`, `Inter_400Regular`,
  `name`, `JetBrains Mono`, `Pilat`) = serif/mono fallback-stack entries, a junk
  `.font-[name]` arbitrary class, and local-only Pilat. None are shippable primaries.
- `[FONT_DANGLING]` = non-latin subsets (cyrillic/vietnamese) + the `%20`-encoded Equity
  Sans urls. Non-critical for an English UI; the working copies ship via `fonts/fonts.css`.

## Owned previews + skips (the 2 modals)

- `IntegrationsModal` and `WorkspaceSettingsModal` take a `visible` prop and the repo's
  stories render them with `visible` undefined → the Dialog stays closed → the reference
  renders EMPTY (`sb-error: no storybook root content`). We:
  - author owned previews (`.design-sync/previews/<Name>.tsx`) that render the modal OPEN
    (`<Modal visible onClose={()=>{}} />`), export named `Primary` to pair with the story;
  - `cfg.overrides.<Name>.cardMode: "single"` + a viewport (modal portal containment);
  - `cfg.overrides.<Name>.skip: ["<story-id>"]` so the compare doesn't sb-error on the
    empty reference. The owned-preview card still ships (verified ~40KB renders, on-brand).
  These owned previews are graded by judgment (the reference can't render them), not by a
  side-by-side match. If the modal API changes (`visible`/`onClose`), update the previews.
- `cardMode: "column"` is set on Card, Command, EmptyState, ScrollArea, Tabs, Textarea —
  their stories are wider than a grid cell (`[GRID_OVERFLOW]`), so column mode keeps each
  story full-width in the product card. Presentation-only; grades carry.

## Known caps / warns (triaged — not new on re-sync)

- **Input**: 7 stories, compare caps at 6 (`[STORY_CAP]`). The 6 graded match, so Input is
  verified-by-upload in full; the 7th tail story is untested. Raise with `--max-stories 7`
  only if that tail variant matters.
- `[RENDER_THIN] variants render identically` may fire in `package-validate` for simple
  single-look primitives (Separator, Label, etc.) — the authoritative oracle is `compare.mjs`
  vs Storybook, where they grade match. Non-blocking.

## Re-sync risks (watch-list)

- **`.design-sync/ds-types/` and `sb-reference/` are generated** (gitignored). A re-sync
  MUST regenerate them before the converter — run `.design-sync/regen.sh` (= `cfg.buildCmd`):
  it rebuilds the reference storybook, restamps `_ds_compiled.css` (+ dark-canvas append),
  and regenerates the tsc `.d.ts` tree. Skipping it → 0 components / `[SYNC_STALE]` / a
  stale-fonts css.
- **`package.json` `"types"` field** is load-bearing for discovery. If removed, components
  drop to 0.
- The mock Auth/Workspace context values in `sb-config/preview.tsx` are hand-written to the
  context value types; if those types change upstream, the mock may need updating (only
  matters for the 5 chrome components that read them).
- Story set changes: add/remove a `*.stories.tsx` under `ui/` or `components/*` → update
  `entry.tsx` (barrel), `titleMap`, and the `tsconfig.dts.json` include list. The regen
  script does NOT auto-discover new stories.
