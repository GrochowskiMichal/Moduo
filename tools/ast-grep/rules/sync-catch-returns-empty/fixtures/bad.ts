// Pre-fix shapes: every `@flag` line must be reported.
export function getCloudPrefs(userId: string) {
  // @flag
  return cache.read(`prefs:${userId}`, () => runtime.preferences.get()).catch(() => null);
}

export function readOutbox(owner: string) {
  try {
    return JSON.parse(localStorage.getItem(owner) ?? "[]");
    // @flag
  } catch {
    return [];
  }
}

export async function loadQueued(owner: string) {
  // @flag
  const queued = await readDocOutbox(owner).catch(() => {
    return [];
  });
  return queued;
}
