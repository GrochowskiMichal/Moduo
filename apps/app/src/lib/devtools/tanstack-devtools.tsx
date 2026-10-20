// The unified TanStack Devtools panel (specs/tanstack-spine.md, TS-1). main.tsx
// imports this file only when NODE_ENV is "development", so production builds
// drop it; collection, Pacer and Hotkeys panels plug in here as those land.
// Hotkeys (TS-6): every live registration, its scope and which scopes are on.
import { TanStackDevtools } from "@tanstack/react-devtools";
import { hotkeysDevtoolsPlugin } from "@tanstack/react-hotkeys-devtools";

const plugins = [hotkeysDevtoolsPlugin()];

export default function TanStackDevtoolsPanel() {
  // Middle-left: the bottom corners hold the toaster (bottom-right) and the
  // bottom bar's panel toggles; the top-left holds the workspace switcher.
  return <TanStackDevtools plugins={plugins} config={{ position: "middle-left" }} />;
}
