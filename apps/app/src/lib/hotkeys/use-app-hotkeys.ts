import type { HotkeyChord as Hotkey } from "@tanstack/hotkeys";
import { type UseHotkeyDefinition, useHotkeys } from "@tanstack/react-hotkeys";

import { type HotkeyDef, type HotkeyId, HOTKEYS, keysFor } from "./registry";

/**
 * A binding's handler. Return `false` when the key isn't yours this time (a
 * dialog is over the page, no row is selected): the event is left alone. Any
 * other return claims it (`preventDefault`).
 *
 * A declined key does NOT fall through to a wider scope's binding on the same
 * key: the narrower scope already won. Gate a binding that only applies some
 * of the time with `enabled` instead (registry.ts's `overrides` rule keeps the
 * shadowing visible).
 */
export type HotkeyHandler = (event: KeyboardEvent) => boolean | undefined | void;

export type AppHotkeyHandlers = Partial<Record<HotkeyId, HotkeyHandler>>;

/** Whether a keydown came from somewhere that keeps its own keys (a field, a Lexical editor). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  // jsdom has no isContentEditable; a Lexical root is `contenteditable="true"`.
  return !!target.closest('[contenteditable]:not([contenteditable="false"])');
}

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.platform?.toLowerCase().includes("mac") ?? false;
}

/**
 * The guard every app hotkey runs before its handler, in this order: a key a
 * handler nearer the target already claimed (`defaultPrevented`: a React
 * `onKeyDown`, a Radix menu) is never ours; a key typed into a field or an
 * editor is the field's unless the binding says `inInputs`.
 */
export function runHotkey(def: HotkeyDef, handler: HotkeyHandler, event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return false;
  if (!def.inInputs && isTypingTarget(event.target)) return false;
  if (handler(event) === false) return false;
  event.preventDefault();
  return true;
}

/**
 * Binds registry hotkeys for as long as the component is mounted. Every binding
 * listens on `document` in the bubble phase, so it runs after the React tree's
 * own handlers (React delegates to the root, below `document`), and the scope
 * from the registry decides which binding wins a shared key.
 */
export function useAppHotkeys(
  handlers: AppHotkeyHandlers,
  options: {
    enabled?: boolean;
    /** Overrides the registry's `inInputs` for this call site (Chat's panel keys). */
    inInputs?: boolean;
  } = {},
) {
  const enabled = options.enabled ?? true;
  const isMac = isMacPlatform();
  const definitions: UseHotkeyDefinition[] = [];
  for (const [id, handler] of Object.entries(handlers) as [HotkeyId, HotkeyHandler | undefined][]) {
    if (!handler) continue;
    const registered: HotkeyDef = HOTKEYS[id];
    const def: HotkeyDef =
      options.inInputs === undefined ? registered : { ...registered, inInputs: options.inInputs };
    for (const key of keysFor(def, isMac)) {
      definitions.push({
        hotkey: key as Hotkey,
        callback: (event) => {
          runHotkey(def, handler, event);
        },
        options: {
          scope: def.scope,
          enabled,
          // Resolve Mod the way the shortcut sheet labels it.
          platform: isMac ? "mac" : "windows",
          meta: { name: def.label, description: id, group: def.scope },
        },
      });
    }
  }
  useHotkeys(definitions, {
    // The registry and `runHotkey` own these decisions; the library only matches
    // keys and picks the winning scope.
    ignoreInputs: false,
    preventDefault: false,
    stopPropagation: false,
    // The same key in two scopes is deliberate; one scope's duplicates fail
    // registry.test.ts instead.
    conflictBehavior: "allow",
  });
}
