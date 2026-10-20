// The unified TanStack Devtools panel (specs/tanstack-spine.md, TS-1). main.tsx
// imports this file only when NODE_ENV is "development", so production builds
// drop it; collection, Pacer and Hotkeys panels plug in here as those land.
import { TanStackDevtools } from "@tanstack/react-devtools";

export default function TanStackDevtoolsPanel() {
  return <TanStackDevtools plugins={[]} />;
}
