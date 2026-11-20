// Fixed shapes: nothing here may be reported.
import { invoke } from "@tauri-apps/api/core";
import type { Window } from "@tauri-apps/api/window";

export async function currentWindow(): Promise<Window> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

export const call = invoke;
