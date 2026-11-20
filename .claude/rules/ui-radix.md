---
paths: ["apps/app/src/**/*.tsx", "apps/app/src/lib/hotkeys/**"]
incident: "The Tasks row menu's Schedule…, Set due date…, Move to bucket… and Rename silently did nothing for months: the closing Radix menu took focus back from what it opened (2026-10)"
expires: 2027-01-31
---

# Radix, cmdk, focus and keys

Compiled from the UI gotchas (HV-14b). Most of these are invisible to jsdom: check focus in a real browser.

## Menus, dialogs and popovers
- A menu item that opens something taking focus (a popover, an editor, a dialog) only records the action in `onSelect`; the content's `onCloseAutoFocus` calls `event.preventDefault()` and runs it. The closing menu otherwise returns focus to its trigger ~100 ms later and the new surface dismisses or commits itself.
- A Dialog or Popover opened without its Trigger (a menu item, a shortcut, state) drops focus on `<body>` when it closes. Pass `useReturnFocus(open)` (`apps/app/src/hooks/use-return-focus.ts`) or an `onCloseAutoFocus` that focuses something sensible (`apps/app/src/components/ui/nav-row.tsx` `restoreNavFocus`). First check `document.activeElement`: a non-modal popover closed by clicking into a field already has focus there.
- A search dialog a key opens and unmounts on close (`{open ? <Dialog … /> : null}`) can drop focus on the body: remember the opener and give focus back (`apps/app/src/features/tasks/ui/use-bulk-actions.tsx`). The kit's `CommandDialog` keeps its sr-only title on the page while closed, so mount search dialogs only while open.
- Radix's Esc dismiss runs on a document capture listener, before your input's `onKeyDown`, and `onOpenChange(false)` can't tell Esc from click-away. Use `onEscapeKeyDown` (with `preventDefault()`) and `onPointerDownOutside`; keep `onOpenChange` as a discard fallback.
- A popover can call `onOpenChange(false)` twice for one close, the second time with the previous render's handlers: take a pending value from a ref once (`apps/app/src/components/ui/date-field.tsx` `useDateDraft`).
- A `DateField` inside another popover loses its clicks (its content is portaled, so the outer one dismisses): render the panel in place with `useDateDraft({ …, open: true })` + `DatePickerPanel`.
- A popover whose first control is tooltip-wrapped opens that tooltip on every open: `onOpenAutoFocus` → `preventDefault()` and focus the content. A Dialog that auto-focuses a tooltip-wrapped button on a story's first render crashes Storybook ("Should not already be working"): same fix (`apps/app/src/features/attachments/ui/attachment-viewer.tsx`).
- A closing popover's `onCloseAutoFocus` that refocuses an editor steals focus from a popover that just opened: refocus only when focus isn't already in another popper.
- A modal Dialog sets `pointer-events: none` on `<body>`: a menu portalled over it needs `z-(--z-popover)` and `pointer-events-auto`; a new modal surface that isn't `DialogContent` needs its guard for `[data-sonner-toaster]` presses (`apps/app/src/components/ui/dialog.tsx`).
- The List's grid takes focus back on every button click inside it; a menu trigger must carry `aria-haspopup` (Radix sets it) or its non-modal menu closes the moment it opens.
- `overflow: hidden` is still a scroll container that focus and `scrollIntoView` scroll; off-screen content is `inert` (moving focus out yourself when it goes inert), and a box that must never move is `overflow: clip` on both axes.

## Radix and the DOM
- A Trigger or Anchor with `asChild` overwrites the child's `data-state` and `data-slot`. Style a tooltip-wrapped item on ARIA (`aria-checked:`, `aria-selected:`, `aria-expanded:`), never `data-[state=on]:`; a primitive under a trigger sets its own `data-*` after `{...props}`, and a test on a selector asserts it matched something.
- A Tooltip is never `data-state="open"`: it is `delayed-open` or `instant-open`.
- A floating surface is portaled to `<body>` and takes `<html>`'s `data-density`: a story mounting it inside a density wrapper passes `container`.
- `NavRow` spreads extra props onto its outer `div`, not the button: an `aria-label` there names nothing.
- A Radix ToggleGroup item inside a TooltipTrigger doesn't switch on `element.click()`; Select and DropdownMenu act on pointer events, not clicks.

## cmdk
- A palette mixing server results with cmdk items runs `shouldFilter={false}` and filters its static items itself; the shared `CommandDialog` forwards cmdk props only through `commandProps` (`apps/app/src/components/ui/command.tsx`).
- cmdk's default search scores an item's `value` too, so an id-like value matches letters of the id: pass a `filter` over `keywords` (`defaultFilter` from `cmdk`) and put every label in `keywords`.
- cmdk writes `role="option"` after your props and names its input through `<Command label>`, which beats `aria-label`. In tests query items by `option`, the input by placeholder; give an item split across spans an explicit `aria-label`.
- `CommandGroup heading` is styled only inside `CommandDialog`.

## Keys and events
- App shortcuts are registry entries (`apps/app/src/lib/hotkeys/registry.ts`) bound with `useAppHotkeys`; a page overrides a global key by binding it in its own scope (`overrides: true`), never by listener order. Only the narrowest scope fires, so a handler returning `false` doesn't fall through: gate with `enabled`. A new route needs `withHotkeyScope` in `apps/app/src/app/router/route-tree.tsx`.
- A `?` matcher accepts `key === "?"` and `shiftKey && key === "/"`.
- React bubbles keydown and pointer events out of portals along the React tree: a list or canvas handler checks `event.currentTarget.contains(event.target)` (or `scroller.contains`) and bails on modified keys it doesn't bind (`apps/app/src/features/tasks/ui/list-keys.ts` `listKeyActionFor`).
- A native `keydown` listener on an element runs before React's handlers for that event; to run after React, listen on `window` and check `root.contains(event.target)` (`apps/app/src/components/app/right-panel.tsx`).
- A container with `role="button"` and its own Enter/Space handler swallows keyboard activation of nested buttons: check `e.target === e.currentTarget`, or don't make it a button.
- A Toolbar is one tab stop with roving focus (`apps/app/src/components/ui/toolbar.tsx` `useRovingFocus`); a list or grid handler around one bails on `target.closest('[role="toolbar"]')`. Radix moves focus in a `setTimeout`: await a tick before asserting.
- A script's `focus()` on a fresh load matches `:focus-visible` in Chrome: mark it quiet (`data-quiet-focus`) and drop the mark on the first real key or blur, guarding the blur with `document.hasFocus()`.
- `<input type="datetime-local">` fires `change` per segment edit: keep a draft and commit on blur or Enter.
- Sonner hands focus back when its last toast leaves.

## Screen readers
- `sr-only` text inside a button starts with ", " or it runs into the visible label ("Marketing5 open").
- An avatar beside the name is `aria-hidden`, or its initials join the row's accessible name.
