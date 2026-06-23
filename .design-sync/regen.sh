#!/usr/bin/env bash
# Regenerate the design-sync generated inputs (reference storybook, compiled-css
# entry, tsc .d.ts tree). Run before the converter on every (re-)sync — this is
# cfg.buildCmd. Idempotent; safe to re-run. Adding/removing a *.stories.tsx also
# requires updating .design-sync/entry.tsx + cfg.titleMap by hand (see NOTES.md).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

MODS="ui/avatar ui/badge ui/button ui/calendar ui/card ui/command ui/complete-toggle ui/context-menu ui/date-field ui/dialog ui/dropdown-menu ui/empty-state ui/icon-button ui/icon ui/input ui/label ui/popover ui/property-row ui/radio-group ui/resizable ui/scroll-area ui/segmented-control ui/select ui/separator ui/sheet ui/sonner ui/switch ui/tabs ui/tag-input ui/textarea ui/toolbar ui/tooltip integrations-modal notification-center tag-chip tag-picker user-menu workspace-settings-modal workspace-switcher"

echo "[regen] 1/3 reference storybook -> .design-sync/sb-reference"
rm -rf .design-sync/sb-reference
./node_modules/.bin/storybook build -c .design-sync/sb-ref -o .design-sync/sb-reference >/dev/null 2>&1 || { echo "[regen] storybook build FAILED"; exit 1; }
test -s .design-sync/sb-reference/iframe.html || { echo "[regen] iframe.html missing"; exit 1; }

echo "[regen] 2/3 stable compiled css + dark-canvas override"
CSS=$(ls -S .design-sync/sb-reference/assets/*.css 2>/dev/null | head -1)
cp "$CSS" .design-sync/sb-reference/assets/_ds_compiled.css
cat >> .design-sync/sb-reference/assets/_ds_compiled.css <<'CSSEOF'

/* design-sync dark default canvas (overrides the preview template body{#fff}) */
html, body { background: var(--background) !important; color: var(--foreground); }
CSSEOF

echo "[regen] 3/3 tsc .d.ts tree -> .design-sync/ds-types (tsc may exit 2 on import.meta.env; emit still happens)"
rm -rf .design-sync/ds-types
./node_modules/.bin/tsc -p .design-sync/tsconfig.dts.json >/dev/null 2>&1
{ echo "// AUTO-GENERATED types index (re-exports the 39 core components)."
  for m in $MODS; do echo "export * from \"./components/$m\";"; done
} > .design-sync/ds-types/index.d.ts
N=$(find .design-sync/ds-types/components -name '*.d.ts' 2>/dev/null | wc -l | tr -d ' ')
echo "[regen] done — $N component .d.ts emitted"
