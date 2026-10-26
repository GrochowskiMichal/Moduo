// Fixed shapes: nothing here may be reported.
export function getCloudPrefs(userId: string) {
  return cache.read(`prefs:${userId}`, () => runtime.preferences.get()).then(
    (prefs) => (prefs ? { kind: "row", prefs } : { kind: "none" }),
    (error: unknown) => ({ kind: "error", error }),
  );
}

export function readOutbox(owner: string) {
  try {
    return JSON.parse(localStorage.getItem(owner) ?? "[]");
  } catch (error) {
    throw new Error(`outbox unreadable for ${owner}`, { cause: error });
  }
}

export function dispose(collection: { cleanup(): Promise<void> }) {
  // Fire-and-forget cleanup: nothing reads the result as data.
  collection.cleanup().catch(() => undefined);
  collection.cleanup().catch(() => {});
}
