# Interaction: models, signatures, keyboard and platform

## Interaction models (concept territories)

Each concept in Phase 2 comes from a different model. The model decides the core loop, so two
concepts from the same model are one concept twice.

| Model | Core loop | Strong when | Fails the 100th-use test when |
|---|---|---|---|
| Command-first | Summon a command menu, type, act | Many actions, expert users, keyboard work | Commands are not discoverable from the main interface |
| Direct manipulation | Point at the thing, drag, edit in place | Spatial or ordered data, quick rearranging | Every edit needs a pointer, or drags have no keyboard alternative |
| Inline and progressive | Start simple, reveal detail where the person is | Mixed novice and expert use, forms, settings | Disclosure hides what experts need every time |
| Spatial | Place items on a canvas or board; position means something | Planning, mapping, visual thinking | Navigation costs grow with content |
| Timeline | Time is the axis: days, weeks, history | Scheduling, activity, review | Dense days become unreadable |
| Conversational | Ask in words, get a result to accept or edit | Fuzzy intent, one-off tasks | Repeated jobs need retyping instead of a control |

## Signature interactions as method

A signature is the one interaction that makes a surface feel authored. Learn the method from
known ones; never copy the idea.

| Example | The method behind it |
|---|---|
| Things' Magic Plus: drag the add button to where the new item belongs | Merge two steps (create, place) into one gesture that uses position as data |
| Linear's ⌘K: every action from one box, with its shortcut shown | One entry point that also teaches the faster path |
| Superhuman's split inbox: the inbox pre-sorted into streams you set | Move a decision people make 100 times a day into one they make once |

To find yours: take the most frequent job from PRODUCT.md, count its steps, and look for two
steps that can become one, or a repeated decision that can be made once.

## Keyboard map

- Every journey completes with the keyboard alone. Tab order follows reading order.
- Focus is visible at every stop, trapped inside dialogs, and returned to the trigger on close.
  Never move focus without the person's action.
- Shortcuts only for the most frequent commands. Single keys only where no text input has
  focus. Show each shortcut in menus, tooltips and the command menu, so the faster path is
  learned by use.
- Respect platform shortcuts; never repurpose a standard one (⌘Z, ⌘C, ⌘F, ⌘W, Esc).
- Arrow keys move within lists, grids and menus; Enter opens or confirms; Esc cancels or closes
  one layer at a time.

## Command menu

One menu for actions and navigation. It opens with no animation, accepts typing at once, ranks
recent and contextual actions first, shows each action's shortcut, and acts on the current
selection. Everything in it is also reachable in the main interface.

## Undo over confirm

- Reversible actions happen at once and offer Undo (⌘Z on desktop, a toast with Undo for a few
  seconds on web). No confirmation dialog.
- Confirm only what cannot be undone, and name the thing in the confirmation ("Delete 3 tasks").
- Undo restores the exact previous state and brings the restored item into view.

## Optimistic UI with visible rollback

- Apply the change locally within one frame and send the write in the background.
- On failure, revert visibly, keep the person's input, and say what failed with a retry.
- Show sync state calmly: saved, saving, offline with queued changes. Never block typing on a
  network round trip.

## Platform conventions

### macOS desktop (HIG checklist)

- Menus in order: App, File, Edit, Format, View, app menus, Window, Help. Items stay present and
  are disabled when unavailable. Show and hide items reflect state ("Show sidebar" or "Hide
  sidebar").
- ⌘, opens settings; settings are few, restore the last pane, and task options live in the task,
  not in settings.
- Undo and Redo at the top of Edit with ⌘Z and ⇧⌘Z, labelled with the action ("Undo move").
- Context menus: short, relevant, consistent across the app; hide unavailable items; every item
  also exists in the main interface; no shortcuts shown in them.
- Drag and drop: an alternative path exists; multi-item drag; drop targets say whether they
  accept; drops can be undone.
- Windows resize fluidly down to the minimum size; nothing critical sits in a bottom bar; the
  window keeps its size and position between launches.
- Full Keyboard Access works; focus appearance matches the platform.

### Web app

- Links are real links: modifier-click and middle-click open new tabs; the URL reflects state
  that someone would want to share or return to.
- Back and forward work through views; refresh keeps the place.
- Hit targets at least 24 px; hover never carries the only path to an action.
- Shortcuts use platform symbols and avoid browser-reserved keys.

## Done when

The concept card names the model, the signature, and the shortest keyboard path, and the
keyboard map covers every action in the surface's journeys.
