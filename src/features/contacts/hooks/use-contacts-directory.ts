// Contacts directory data hook (block CO-2): one read of the people + companies
// bundle for the rail. Stale-while-revalidate isn't needed yet (one cheap
// indexed read); a reload re-fetches after a mutation.

import { useCallback, useEffect, useState } from "react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import type { ContactsModuleBundle } from "../model";

export type DirectoryStatus = "loading" | "ready" | "error";

const EMPTY: ContactsModuleBundle = { contacts: [], companies: [], fieldDefs: [] };

export function useContactsDirectory(runtime: ModuoRuntime | null, workspaceId: string | null) {
  const [bundle, setBundle] = useState<ContactsModuleBundle>(EMPTY);
  const [status, setStatus] = useState<DirectoryStatus>("loading");
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!runtime || !workspaceId) return;
    let active = true;
    setStatus("loading");
    void (async () => {
      try {
        const next = await runtime.contacts.list(workspaceId);
        if (active) {
          setBundle(next);
          setStatus("ready");
        }
      } catch {
        if (active) setStatus("error");
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, tick]);

  return { bundle, status, reload };
}
