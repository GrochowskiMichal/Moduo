// After a deploy, a tab opened on an older build may ask for a hashed chunk the
// host no longer has (the last 3 builds stay served; older ones go). Instead of
// a blank page or the error screen, reload once, quietly, to get the new build.
// The guard lives in sessionStorage, so it holds across that reload: a second
// missing chunk in the same tab session shows the error as before, never a loop.

const RELOADED_KEY = "moduo:chunk-reload";

/** Rspack's chunk loader errors, plus the browsers' native dynamic-import failures. */
export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message, code } = error as { name?: unknown; message?: unknown; code?: unknown };
  if (name === "ChunkLoadError" || code === "CSS_CHUNK_LOAD_FAILED") return true;
  if (typeof message !== "string") return false;
  return (
    /^Loading (CSS )?chunk \S+ failed/.test(message) ||
    message.startsWith("Failed to fetch dynamically imported module") ||
    message.startsWith("error loading dynamically imported module") ||
    message.startsWith("Importing a module script failed")
  );
}

type Deps = {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  reload: () => void;
};

function defaultDeps(): Deps {
  let storage: Deps["storage"] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Storage blocked: never reload, since we couldn't stop a loop.
  }
  return { storage, reload: () => window.location.reload() };
}

/** Reloads the page for a chunk-load error, at most once per tab session. True when it reloaded. */
export function reloadOnceForChunkError(error: unknown, deps: Deps = defaultDeps()): boolean {
  if (!isChunkLoadError(error) || !deps.storage) return false;
  try {
    if (deps.storage.getItem(RELOADED_KEY)) return false;
    deps.storage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    return false;
  }
  deps.reload();
  return true;
}

/** Catch chunk errors nothing else handled (unawaited imports, preloads). Returns the uninstall. */
export function installChunkReload(target: Window = window, deps?: Deps): () => void {
  const onRejection = (event: PromiseRejectionEvent) => {
    if (reloadOnceForChunkError(event.reason, deps)) event.preventDefault();
  };
  const onError = (event: ErrorEvent) => {
    if (reloadOnceForChunkError(event.error, deps)) event.preventDefault();
  };
  target.addEventListener("unhandledrejection", onRejection);
  target.addEventListener("error", onError);
  return () => {
    target.removeEventListener("unhandledrejection", onRejection);
    target.removeEventListener("error", onError);
  };
}
