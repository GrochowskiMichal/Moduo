# Chat v1 visual audit against the Tasks v3 north star

> Raw research report from the Chat re-plan, 2026-10-13. Nothing here is decided.

*Work in progress: sections are being filled in as measurements come in.*

Base: `t/maciej/chat-replan` @ b33922a6. Storybook 10.6 on :6016, 1440 × 900, dark (default shade, mono accent, comfortable density) unless a row says otherwise. Contrast is WCAG 2.x, measured in the page: every colour is resolved through a canvas (so `oklch()` and `color-mix()` resolve the way the browser paints them), translucent fills are composited from the root down, and opacity is multiplied up the ancestor chain. The harness is in the session scratchpad (`harness.js`), not in the repo.

Rendered from stories: `Features/Chat/Workspace` → Conversation, WithThread, WithDetails, Locked. Read from code only (no story): the App/bot author, failed and deleted messages, inline edit, the Search panel, the dialogs (create channel, people picker, browse, ⌘J switcher), the emoji picker, the page-level empty and error states, and the bottom bar.

Caveat: the story frame is not the real shell. It draws its own `rounded-xl border bg-card` panes (`chat.stories.tsx:210–335`), so the bottom bar, the shell's panel toggles and the shell's pane widths are not in the shots. The page (`src/routes/pages/chat-page.tsx`) was read for those.
