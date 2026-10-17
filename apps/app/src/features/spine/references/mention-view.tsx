// A host's own drawing for the references it understands better than the
// registry does (CV-7b): chat's composer draws a `person` reference as
// "@Name" from its member list, which the spine's registry doesn't hold.
// Additive: with no provider (Tasks, Notes, email), every reference draws as
// the Reference primitive, exactly as before.

import { createContext, type ReactNode, useContext } from "react";

/** Draw a reference itself (return a node), or leave it to the primitive (null). */
export type ReferenceViewOverride = (type: string, id: string) => ReactNode | null;

const ReferenceViewOverrideContext = createContext<ReferenceViewOverride | null>(null);

export const ReferenceViewOverrideProvider = ReferenceViewOverrideContext.Provider;

/** The host's override, if any (inside an editor's decorators). */
export function useReferenceViewOverride(): ReferenceViewOverride | null {
  return useContext(ReferenceViewOverrideContext);
}
