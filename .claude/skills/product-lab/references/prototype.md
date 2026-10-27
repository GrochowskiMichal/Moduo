# Prototype runs: rendering the studio's artifact for the critic

`scripts/prototype.mjs` renders one single-file HTML prototype into a dossier the blind critic
reads exactly like a lab run. It needs no server, seed or sign-in: the prototype carries its own
fictional data.

```bash
node .claude/skills/product-lab/scripts/prototype.mjs <file.html> \
  --label notes-r1 --tokens apps/app/src/styles/tokens.css \
  --purpose "..." --users "..." --platform macos-desktop --theme dark
```

The last line printed is the dossier folder, `.lab/<run-id>/`.

## The contract a prototype keeps

1. **Critic mode.** Opened with `?critic=1`, the page shows only the product surface: no tabs,
   rationale, scorecard or notes. The script always opens it this way. Outside critic mode the
   page may show its tabs (`references/artifact.md` in the studio).
2. **Declared states.** It sets `window.studio` before the first paint finishes:

   ```js
   window.studio = {
     states: [
       { id: "default", label: "A normal day, 14 notes" },   // the first state is the default
       { id: "empty",   label: "First run, no notes yet" },
       // loading, error, offline, dense, long, search, editing, slash-menu, …
     ],
     set(id) { /* render that state; may return a promise */ },
   };
   ```

   Each `set(id)` must render the whole surface in that state, not just a fragment. Overlays
   (a menu, a palette, a dialog) are states too: open them in `set`.
3. **The house tokens, by name.** The prototype declares the project's own custom properties on
   `:root` (copied from the token files with their real values) and uses only them. That is what
   lets the `system` gate measure drift: pass the same token files with `--tokens`.
4. **Real interaction.** Buttons, rows and fields respond to hover, focus and click, so the focus
   walk and pointer pairs show real feedback. Keyboard shortcuts the design promises work.
5. **Self-contained.** One HTML file, inline CSS and JS, fonts the house uses (or the system
   fallback the tokens name). No network calls, so the render is the same every time.

## What it captures

| Output | What |
|---|---|
| `states/<id>.png`, `states/sheet.png` | every declared state at 1440x900 |
| `windows/<w>x<h>.png`, `windows/sheet.png` | the first state at 1024x700 to 1920x1080 |
| `themes/reduced-motion.png` | the first state with reduced motion |
| `focus/k-NN.png`, `focus/sheet.png` | 30 Tab presses (Chromium), with indicator detection |
| `hover/h-NN-{rest,hover}.png`, `hover/sheet.png` | up to 12 pointer targets |
| `tokens.json`, `tokens/drift-NN.png` | conformance against `--tokens` |
| `measurements.md`, `critic.md` | what the critic reads |
| `gates.json`, `dossier.md`, `summary.json` | for the studio only |

Gates for a prototype are `accessibility`, `states`, `reliability`, `layout`, `system` and
`pointer`. There are no journeys, latency or frame numbers: a prototype can't prove speed, so the
critic is told to leave Speed and feel unjudged.
