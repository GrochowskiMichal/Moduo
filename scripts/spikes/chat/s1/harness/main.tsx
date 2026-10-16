// CV-0 spike 1 harness entry (its own Rsbuild entry, see ../rsbuild.config.ts;
// nothing in src/ mounts it). Query: ?lib=tanstack|legend &engine=<name>
// &auto=1 (run every scenario) &only=a,b &configs=x,y &collect=<url>
// Without auto=1 it is the manual page (buttons; prepends when you scroll
// near the top, like a real stream).

import ReactDOM from "react-dom/client";
import "../../../../../src/global.css";
import "./harness.css";
import { App, control, initialState } from "./app";
import { run } from "./runner";

const q = new URLSearchParams(location.search);
const list = (name: string) => q.get(name)?.split(",").filter(Boolean) ?? null;
const auto = q.get("auto") === "1";
const libs = list("libs") ?? [q.get("lib") ?? "tanstack"];
const start = initialState(libs[0] as string);
if (auto) start.status = "starting";

document.documentElement.dataset.theme = "dark";
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App start={start} />);

async function main() {
  await control.waitApi();
  if (auto) {
    const engine = q.get("engine") ?? ("__TAURI_INTERNALS__" in window ? "wkwebview" : "unknown");
    await run({
      engine,
      libs,
      only: list("only"),
      repeat: Number(q.get("repeat") ?? 1),
      configs: list("configs"),
      collect: q.get("collect"),
    });
    return;
  }
  // Manual: load the next 50 older messages when the reader nears the top.
  let loading = false;
  let attached: HTMLElement | null = null;
  const onScroll = () => {
    const sc = attached;
    const s = control.state();
    if (!sc || loading || s.lo === 0 || sc.scrollTop > 600) return;
    loading = true;
    setTimeout(() => {
      control.set((st) => ({ lo: Math.max(0, st.lo - 50) }));
      loading = false;
    }, 60);
  };
  setInterval(() => {
    const sc = control.api()?.scroller() ?? null;
    if (sc === attached) return;
    attached?.removeEventListener("scroll", onScroll);
    attached = sc;
    sc?.addEventListener("scroll", onScroll, { passive: true });
  }, 300);
}

void main();
