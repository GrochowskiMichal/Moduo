import { MiniMap } from "@xyflow/react";
import type { ThemePreset } from "../types";

type Props = {
  theme: ThemePreset;
};

export function MindmapMiniMap({ theme }: Props) {
  return (
    <MiniMap
      nodeColor={(node) => {
        if (node.data?.depth === 0) return theme.rootBorder;
        if (node.data?.depth === 1) return theme.branchBorder;
        return theme.leafBorder;
      }}
      maskColor={`${theme.canvasBg}dd`}
      className="absolute bottom-5 right-4 m-0 overflow-hidden rounded-xl shadow-[0_10px_24px_rgba(0,0,0,0.38),0_2px_6px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)]"
      style={{
        position: "absolute",
        bottom: 20,
        right: 16,
        background: `${theme.canvasBg}ee`,
        width: 180,
        height: 110,
      }}
      pannable
      zoomable
      ariaLabel="Mindmap overview mini-map"
    />
  );
}
