// The bottom bar's Search (CV-19): a module that has its own search surface
// claims the press (Chat opens Chat's Search); anywhere else it opens ⌘K.
// The newest claimant wins, and a module claims only while it is mounted.

type SearchHandler = () => boolean;

const handlers: SearchHandler[] = [];

/** Claim the bottom bar's Search while mounted; return true when handled. */
export function onSearchRequest(handler: SearchHandler): () => void {
  handlers.push(handler);
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
  };
}

/** Ask the mounted module to open its search; false when none did. */
export function requestModuleSearch(): boolean {
  for (let i = handlers.length - 1; i >= 0; i -= 1) {
    if (handlers[i]?.()) return true;
  }
  return false;
}
