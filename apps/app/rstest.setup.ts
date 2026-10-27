// Global test setup. Adds jest-dom matchers (toBeInTheDocument, toHaveClass, …)
// so future component-render tests get them without a per-file import.

import { expect } from "@rstest/core";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";

expect.extend(jestDomMatchers);

// jsdom has no object URLs, and since jsdom 30 Node's own `URL.createObjectURL`
// shows through instead, which rejects jsdom's File and Blob. Stand in a
// browser-like one for every jsdom test: any blob gets a fresh `blob:` URL. Don't
// stub it per file (a `URL.createObjectURL ??= …` guard no longer fires).
if (typeof window !== "undefined") {
  let next = 0;
  URL.createObjectURL = () => `blob:test/${++next}`;
  URL.revokeObjectURL = () => {};
}
