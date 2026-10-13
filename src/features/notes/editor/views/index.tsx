/**
 * The Notes editor's node views (NR-3 schema/view split). The live editor
 * calls `installNoteNodeViews()` once at module load; headless editors never
 * do, so their decorators stay null.
 */

import { installEntityRefView } from "../../../spine/editor/entity-ref-node";
import { registerNodeView } from "../../../spine/editor/node-views";
import { EmbedNode } from "../schema/embed-node";
import { PageRowNode } from "../schema/page-row-node";
import { EmbeddedMindmap } from "./embedded-mindmap";
import { PageRowView } from "./page-row-view";

export function installNoteNodeViews(): void {
  installEntityRefView();
  registerNodeView(PageRowNode.getType(), (node) => {
    const row = node as PageRowNode;
    return <PageRowView nodeKey={row.getKey()} noteId={row.__noteId} label={row.__label} />;
  });
  registerNodeView(EmbedNode.getType(), (node) => {
    const embed = node as EmbedNode;
    // The legacy "task" embed was removed with the old tasks model; persisted
    // task embeds import cleanly but render nothing.
    return embed.__kind === "mindmap" ? <EmbeddedMindmap mindmapId={embed.__itemId} /> : null;
  });
}
