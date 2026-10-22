/**
 * NR-6 AC11, the meta-line source: the hook names the agent from its
 * activity row, offers Undo while the session holds a step, and drops the
 * mark once the agent's change is undone.
 */

import { describe, expect, it } from "@rstest/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as Y from "yjs";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { NOTES_DOC_ROOT } from "../editor/doc-markdown";
import { AgentOrigin, createAgentUndo } from "../sync/agent-origin";
import type { NotesSyncEngineV2 } from "../sync/engine-v2";
import { useAgentEdit } from "./use-agent-edit";

function setup() {
  const doc = new Y.Doc();
  const root = doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  const undo = createAgentUndo(doc);
  const engine = { agentUndo: () => undo } as unknown as NotesSyncEngineV2;
  const at = new Date(Date.now() - 60_000).toISOString();
  const runtime = {
    tasks: {
      listActivity: async () => [
        { op: "notes.agent_edit", actorLabel: "Research bot", createdAt: at },
      ],
    },
  } as unknown as ModuoRuntime;
  const agentWrite = () =>
    doc.transact(
      () => root.insert(root.length, [new Y.XmlElement("paragraph")]),
      new AgentOrigin("k1"),
    );
  return { engine, runtime, agentWrite, at };
}

describe("useAgentEdit", () => {
  it("names the agent from activity, offers Undo after a live write, and clears on Undo", async () => {
    const { engine, runtime, agentWrite } = setup();
    const { result } = renderHook(() =>
      useAgentEdit({ runtime, engine, workspaceId: "ws1", noteId: "n1" }),
    );
    await waitFor(() => expect(result.current.agentEdit?.label).toBe("Research bot"));
    expect(result.current.canUndo).toBe(false);

    act(() => agentWrite());
    await waitFor(() => expect(result.current.canUndo).toBe(true));
    expect(result.current.agentEdit?.label).toBe("Research bot");

    act(() => result.current.undo());
    await waitFor(() => expect(result.current.canUndo).toBe(false));
    expect(result.current.agentEdit).toBeNull();
  });

  it("renders without an activity reader (Storybook's fake runtime)", async () => {
    const { engine } = setup();
    const { result } = renderHook(() =>
      useAgentEdit({ runtime: {} as ModuoRuntime, engine, workspaceId: "ws1", noteId: "n1" }),
    );
    await waitFor(() => expect(result.current.canUndo).toBe(false));
    expect(result.current.agentEdit).toBeNull();
  });
});
