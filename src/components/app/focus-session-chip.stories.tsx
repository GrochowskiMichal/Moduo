import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useEffect, useState } from "react";

import {
  __resetFocusEngineForTest,
  attachFocusUser,
  bindFocusTask,
  FOCUS_STORAGE_PREFIX,
  registerFocusFlushSink,
  startFocus,
  stopFocus,
  toggleFocusRunning,
} from "../../features/focus/engine";
import { FocusSessionChip } from "./focus-session-chip";

const STORY_WORKSPACE = "ws-storybook";

function clearStoredSession() {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(FOCUS_STORAGE_PREFIX)) localStorage.removeItem(key);
  }
}

/** Puts the app-level focus engine in a known state for one story. */
function FocusFixture({
  setup,
  children,
}: {
  setup: () => undefined | (() => void);
  children: ReactNode;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    clearStoredSession();
    __resetFocusEngineForTest({ alert: () => {} });
    attachFocusUser("storybook");
    bindFocusTask({
      id: "t1",
      title: "Write the onboarding spec",
      bucketName: "Inbox",
      workspaceId: STORY_WORKSPACE,
    });
    const undo = setup();
    setReady(true);
    return () => {
      undo?.();
      bindFocusTask(null);
      attachFocusUser(null);
      clearStoredSession();
    };
  }, [setup]);
  // Sits where the top bar puts it: right-aligned in a container, left of Help.
  return ready ? <div className="@container flex justify-end p-4">{children}</div> : null;
}

const meta: Meta<typeof FocusSessionChip> = {
  title: "Components/app/focus-session-chip",
  component: FocusSessionChip,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

const running = () => {
  startFocus();
  return undefined;
};
const paused = () => {
  startFocus();
  toggleFocusRunning();
  return undefined;
};
const notSaved = () => {
  // Saves fail; stop after a couple of tracked seconds so there's time to save.
  const unregister = registerFocusFlushSink(STORY_WORKSPACE, () => Promise.resolve(false));
  startFocus();
  const timer = window.setTimeout(stopFocus, 2000);
  return () => {
    window.clearTimeout(timer);
    unregister();
  };
};

/** A running session: the clock and a small dot. Hover for pause; click opens Focus. */
export const Running: Story = {
  render: () => (
    <FocusFixture setup={running}>
      <FocusSessionChip />
    </FocusFixture>
  ),
};

/** Paused: the pause sign replaces the dot, and hovering offers resume. */
export const Paused: Story = {
  render: () => (
    <FocusFixture setup={paused}>
      <FocusSessionChip />
    </FocusFixture>
  ),
};

/** Stopped while a save is still retrying (F1-7). Nothing is lost. */
export const NotSavedYet: Story = {
  render: () => (
    <FocusFixture setup={notSaved}>
      <FocusSessionChip />
    </FocusFixture>
  ),
};
