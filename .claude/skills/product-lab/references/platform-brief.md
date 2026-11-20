# Platform briefs (critic-facing)

The lab copies the section matching `platform` in `lab.config.mjs` into `critic.md`. Each brief
tells a reviewer which conventions to check and which differences are correct for the platform,
so it doesn't score them as defects. House style (sentence case or title case, a dark primary
theme, a single typeface) is the product's choice, never a platform defect.

## macos-desktop

A Mac productivity app is judged against the macOS Human Interface Guidelines.

- **Menu bar:** menus in order App, File, Edit, Format, View, app-specific menus, Window, Help. A
  View and a Window menu exist even when small. Menu-bar items stay listed and are disabled when
  unavailable, not hidden. Every app command also appears in some menu.
- **Standard shortcuts:** ⌘, opens settings; ⌘Z and ⇧⌘Z undo and redo; Esc cancels the current
  action; ⌘W closes, ⌘Q quits. Standard shortcuts are never repurposed.
- **Undo:** multi-level, labelled ("Undo Move"), and shows its result (scrolls to the change).
  Undo is preferred over "are you sure" confirmations.
- **Context menus:** on every main entity, consistent across the app, short, one submenu level.
  They hide unavailable items (unlike the menu bar) and don't show shortcuts.
- **Keyboard:** every core task can be done without a pointer; Full Keyboard Access works; tab
  order runs leading to trailing, then top to bottom. Custom shortcuts exist for frequent
  commands and the UI shows them.
- **Focus:** never moves without the user doing something. The focus indicator is visible and
  consistent.
- **Windows:** resize fluidly from the minimum size; no critical action only in a bottom bar;
  inactive windows look different. Large displays show more content with fewer nested levels and
  less modality.
- **Motion:** none on frequent or keyboard-triggered actions (menus and ⌘Tab open instantly);
  people can cancel motion; reduced motion is honoured.
- **Settings:** few, with sensible defaults; task options live with the task, not in settings.
- **In a web-proxy run** native menus, the title bar and window chrome are not captured. Their
  absence from the frames is not a defect; list them under "cannot judge".

## windows-desktop

- Menus or a command bar expose every command; Alt shows access keys; F10 reaches the menu.
- Ctrl shortcuts (Ctrl+Z, Ctrl+Y or Ctrl+Shift+Z, Ctrl+, often for settings), Esc cancels, F2
  renames, Delete deletes, Enter opens.
- Right-click context menus on every main entity; Shift+F10 opens them from the keyboard.
- Tab and arrow-key navigation through every control; visible focus rectangles.
- Windows snap and resize; the app keeps working at 125 to 200% display scaling.
- Title-bar buttons on the right; dialogs put the confirming button first (OK, Cancel).

## web

- The URL reflects where the user is: views, filters and open items survive reload and can be
  shared; Back returns to the previous view.
- Links are real links: open in a new tab with ⌘/Ctrl-click; buttons are buttons.
- Browser shortcuts stay intact (⌘/Ctrl+F, ⌘/Ctrl+L, ⌘/Ctrl+T); app shortcuts avoid them or ask
  before capturing them.
- Forms: Enter submits a single field, ⌘/Ctrl+Enter submits a text area; the browser can fill
  passwords and addresses; nothing typed is lost on navigation.
- Works at 200% zoom and at narrow window widths without horizontal scrolling of the page.
- Keyboard: every control reachable by Tab, a skip link to the main content, Esc closes overlays.
- Offline or slow network shows a state, not a frozen page.

## web-mobile

- Touch targets at least 44 by 44 points; nothing depends on hover.
- Thumb reach: primary actions in the lower half; no critical action only at the top corners.
- The on-screen keyboard never covers the focused field; inputs use the right keyboard type.
- Safe areas respected (notch, home indicator); the page never scrolls sideways.
- Native gestures intact: back swipe, pull to refresh where expected, pinch zoom on content.
- Text stays readable at the system's larger text sizes.
- Copy fits touch: "tap", never "click" or "hover".
