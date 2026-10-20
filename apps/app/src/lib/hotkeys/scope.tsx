import { getHotkeyManager, HotkeysProvider } from "@tanstack/react-hotkeys";
import { type ReactNode, useEffect } from "react";

import { SCOPE_PARENT, type HotkeyScope as Scope } from "./registry";

/**
 * Turns a hotkey scope on while mounted (and `enabled`). Routes wrap their page
 * in one; surfaces, the right panel and modals nest one inside, so the library
 * ranks them by nesting: a panel's Escape beats its page's, a page's `?` beats
 * the global sheet.
 */
export function HotkeyScope({
  scope,
  enabled = true,
  children,
}: {
  scope: Exclude<Scope, "global">;
  enabled?: boolean;
  children: ReactNode;
}) {
  return (
    <HotkeysProvider scope={scope} enabled={enabled}>
      {children}
    </HotkeysProvider>
  );
}

/**
 * A route component with its hotkey scope on (route-tree.tsx). Keeps a lazy
 * route component's `preload`, so the router can still warm it up.
 */
export function withHotkeyScope<P extends object>(
  scope: Exclude<Scope, "global">,
  Component: (props: P) => ReactNode,
): (props: P) => ReactNode {
  function Scoped(props: P) {
    return (
      <HotkeyScope scope={scope}>
        <Component {...props} />
      </HotkeyScope>
    );
  }
  Scoped.displayName = `HotkeyScope(${scope})`;
  const preload = (Component as { preload?: unknown }).preload;
  return preload ? Object.assign(Scoped, { preload }) : Scoped;
}

/**
 * `HotkeyScope` for a hook with no element of its own (Catch up's screen
 * hook): turns the scope on while `enabled`, nested in its registry parent.
 */
export function useHotkeyScope(scope: Exclude<Scope, "global">, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const parent = SCOPE_PARENT[scope];
    return getHotkeyManager().activateScope(scope, {
      parent: parent === "global" ? undefined : parent,
    });
  }, [scope, enabled]);
}
