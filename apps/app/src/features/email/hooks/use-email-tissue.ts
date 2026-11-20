// The cloud email tissue (AC15): the `email_refs` a person snoozed, set a
// follow-up on or linked, read through `runtime.email.listModule`. This is all
// the web shows of mail; the desktop inbox runs on the rebuilt engine (MR-16).

import { useEffect, useMemo, useState } from "react";

import type { EmailThreadRef, ModuoRuntime } from "../../../lib/runtime.types";
import { isAwaitingFollowUp } from "../refs";

export type EmailTissue = {
  loading: boolean;
  tissueRefs: EmailThreadRef[];
  snoozed: EmailThreadRef[];
  followUps: EmailThreadRef[];
};

export function useEmailTissue(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
): EmailTissue {
  const [tissueRefs, setTissueRefs] = useState<EmailThreadRef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!runtime || !workspaceId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    runtime.email
      .listModule(workspaceId)
      .then((bundle) => {
        if (active) setTissueRefs(bundle.refs ?? []);
      })
      .catch(() => {
        /* tissue is best-effort: degrades to empty */
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [runtime, workspaceId]);

  const snoozed = useMemo(() => tissueRefs.filter((r) => r.isSnoozed), [tissueRefs]);
  const followUps = useMemo(() => tissueRefs.filter(isAwaitingFollowUp), [tissueRefs]);
  return { loading, tissueRefs, snoozed, followUps };
}
