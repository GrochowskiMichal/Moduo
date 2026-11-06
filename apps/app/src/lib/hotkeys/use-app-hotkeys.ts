import { getHotkeyManager, type HotkeyChord as Hotkey } from "@tanstack/hotkeys";
import { type UseHotkeyDefinition, useHotkeys } from "@tanstack/react-hotkeys";
import { useCallback, useSyncExternalStore } from "react";

import {
  CHORD_TIMEOUT_MS,
  type HotkeyBinding,
  type HotkeyDef,
  type HotkeyId,
  HOTKEYS,
  type HotkeyScope,
  isSequenceKey,
  keysFor,
} from "./registry";

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
 * One library registration for a key or a chord. A chord is a library sequence
 * with a 1 s window (decision 15): while its first key waits, the second key is
 * the chord's alone, and a slow or different second key drops it and acts
 * normally. Its first key is skipped in fields unless the binding says
 * `inInputs`, so typing "g" never arms it.
 */
function bindingDefinition(
  key: HotkeyBinding,
  def: HotkeyDef,
  ctx: {
    callback: (event: KeyboardEvent) => void;
    enabled: boolean;
    isMac: boolean;
    id: string;
  },
): UseHotkeyDefinition {
  const options = {
    scope: def.scope,
    enabled: ctx.enabled,
    // Resolve Mod the way the shortcut sheet labels it.
    platform: ctx.isMac ? ("mac" as const) : ("windows" as const),
    meta: { name: def.label, description: ctx.id, group: def.scope },
  };
  if (isSequenceKey(key)) {
    return {
      hotkey: [...key],
      callback: ctx.callback,
      options: { ...options, timeout: CHORD_TIMEOUT_MS, ignoreInputs: !def.inInputs },
    };
  }
  return { hotkey: key as Hotkey, callback: ctx.callback, options };
}

/** The first steps of a chord waiting for its second key in `scope` ("g"), or null. */
function pendingChord(scope: HotkeyScope): string | null {
  const now = Date.now();
  for (const reg of getHotkeyManager().registrations.state.values()) {
    if (reg.kind !== "sequence" || reg.options.scope !== scope) continue;
    if (reg.currentIndex === 0 || reg.options.enabled === false) continue;
    if (now - reg.lastKeyTime > (reg.options.timeout ?? CHORD_TIMEOUT_MS)) continue;
    return reg.hotkey
      .slice(0, reg.currentIndex)
      .map((step) => step.toLowerCase())
      .join("");
  }
  return null;
}

/**
 * The chord waiting for its second key in a scope, for a hint ("g…"); null
 * once it resolves, drops after `CHORD_TIMEOUT_MS`, or another key cancels it.
 */
export function useChordPending(scope: HotkeyScope): string | null {
  const subscribe = useCallback((onChange: () => void) => {
    const sub = getHotkeyManager().registrations.subscribe(() => onChange());
    return () => sub.unsubscribe();
  }, []);
  const read = () => pendingChord(scope);
  return useSyncExternalStore(subscribe, read, read);
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
      definitions.push(
        bindingDefinition(key, def, {
          callback: (event) => {
            runHotkey(def, handler, event);
          },
          enabled,
          isMac,
          id,
        }),
      );
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
