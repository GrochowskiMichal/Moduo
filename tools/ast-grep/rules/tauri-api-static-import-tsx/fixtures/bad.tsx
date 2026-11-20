// Pre-fix shapes: every `@flag` line must be reported.
// @flag
import { getCurrentWindow } from "@tauri-apps/api/window";
// @flag
import { listen } from "@tauri-apps/api/event";

export const win = () => getCurrentWindow();
export const on = listen;
