import { describe, expect, it } from "@rstest/core";

import { createTauriMailEngine } from "./runtime.tauri.mail-engine";
import type { MailEvent } from "./runtime.types.mail-engine";

describe("tauri mail engine", () => {
  it("maps calls to mail_* commands and fans one channel out to every listener", async () => {
    const calls: [string, unknown][] = [];
    let push: ((e: MailEvent) => void) | null = null;
    const engine = createTauriMailEngine(
      async <T>(cmd: string, args?: Record<string, unknown>) => {
        calls.push([cmd, args]);
        return [] as T;
      },
      (onMessage) => {
        push = onMessage;
        return "channel";
      },
    );
    await engine.applyOp({ kind: "done", threadIds: ["t1"] });
    const a: MailEvent[] = [];
    const b: MailEvent[] = [];
    const offA = engine.subscribe((e) => a.push(e));
    engine.subscribe((e) => b.push(e));
    expect(calls.filter(([c]) => c === "mail_subscribe")).toHaveLength(1);
    push!({ kind: "draft_changed", draftId: "d" });
    offA();
    push!({ kind: "draft_changed", draftId: "e" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(2);
    expect(calls[0]).toEqual(["mail_apply_op", { input: { kind: "done", threadIds: ["t1"] } }]);
  });
});
