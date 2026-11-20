// May you copy this project or task (Duplicate, Save as template)? Copying
// needs Edit on the source (D15-11). Asked when a copy dialog opens; null
// while asking, and for any source but the one the answer was for, so a
// dialog never shows the last source's answer. The server decides again on
// the copy itself; an unanswerable question reads as yes and leaves it to it.

import { useEffect, useState } from "react";

import type { ModuoRuntime } from "../../../../lib/runtime.types";
import type { TemplateKind } from "../model";

export function useCopyAccess(
  runtime: ModuoRuntime | null,
  source: { kind: TemplateKind; id: string } | null,
): boolean | null {
  const key = source ? `${source.kind}:${source.id}` : null;
  const [answer, setAnswer] = useState<{ key: string; ok: boolean } | null>(null);
  const kind = source?.kind ?? null;
  const id = source?.id ?? null;
  useEffect(() => {
    if (!kind || !id) return;
    const asked = `${kind}:${id}`;
    const ask = runtime?.tasks.canCopyTemplateSource;
    if (!ask) {
      setAnswer({ key: asked, ok: true });
      return;
    }
    let live = true;
    ask({ kind, id })
      .then((ok) => live && setAnswer({ key: asked, ok }))
      .catch(() => live && setAnswer({ key: asked, ok: true }));
    return () => {
      live = false;
    };
  }, [runtime, kind, id]);
  return key !== null && answer?.key === key ? answer.ok : null;
}
