import type { RefObject } from "react";
import {
  EDGE_SHAPE_OPTIONS,
  normalizeHexColor,
  type EdgeMenuPanel,
  type EdgeMenuState,
} from "./edge-style";
import type { EdgePattern, EdgeStyle, MindmapEdgeData } from "./types";

type EdgeStyleMenuProps = {
  menu: EdgeMenuState;
  edgeData: MindmapEdgeData;
  colorDraft: string;
  menuRef: RefObject<HTMLDivElement | null>;
  onTogglePanel: (panel: Exclude<EdgeMenuPanel, null>) => void;
  onUpdateLabel: (label: string) => void;
  onSetColorDraft: (color: string) => void;
  onApplyColor: (color: string, withHistory?: boolean) => void;
  onApplyShape: (style: EdgeStyle) => void;
  onApplyPattern: (pattern: EdgePattern) => void;
  onApplyAnimation: (animated: boolean) => void;
};

const LINE_PATTERN_OPTIONS: Array<{ value: EdgePattern; icon: string; label: string }> = [
  { value: "solid", icon: "-", label: "Solid" },
  { value: "dashed", icon: "╌", label: "Dashed" },
  { value: "dotted", icon: "⋯", label: "Dotted" },
];

export function EdgeStyleMenu({
  menu,
  edgeData,
  colorDraft,
  menuRef,
  onTogglePanel,
  onUpdateLabel,
  onSetColorDraft,
  onApplyColor,
  onApplyShape,
  onApplyPattern,
  onApplyAnimation,
}: EdgeStyleMenuProps) {
  return (
    <div
      ref={menuRef}
      className="fixed z-40 w-[min(220px,calc(100vw-24px))] rounded-xl border border-[#2a2a2a] bg-[#141414]/95 p-2 shadow-2xl backdrop-blur-xl"
      style={{ left: menu.x, top: menu.y }}
      role="dialog"
      aria-label="Connection style menu"
    >
      <div className="flex items-center gap-1">
        <button
          onClick={() => onTogglePanel("text")}
          className={`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${
            menu.panel === "text" ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
          }`}
          aria-label="Edit connection text"
        >
          T
        </button>
        <button
          onClick={() => onTogglePanel("color")}
          className={`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${
            menu.panel === "color" ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
          }`}
          aria-label="Edit connection color"
        >
          ◉
        </button>
        <button
          onClick={() => onTogglePanel("shape")}
          className={`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${
            menu.panel === "shape" ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
          }`}
          aria-label="Edit connection style"
        >
          ∿
        </button>
        <button
          onClick={() => onTogglePanel("line")}
          className={`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${
            menu.panel === "line" ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
          }`}
          aria-label="Edit connection line pattern"
        >
          ╌
        </button>
        <button
          onClick={() => onApplyAnimation(!edgeData.animated)}
          className={`h-8 w-10 rounded-lg text-[13px] font-semibold transition-all duration-200 hover:scale-105 ${
            edgeData.animated ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
          }`}
          aria-label={edgeData.animated ? "Disable connection animation" : "Enable connection animation"}
        >
          ◍
        </button>
      </div>

      <div className={`overflow-hidden transition-all duration-200 ease-out ${menu.panel ? "mt-2 max-h-20 opacity-100" : "max-h-0 opacity-0"}`}>
        {menu.panel === "text" ? (
          <input
            value={edgeData.label}
            onChange={(event) => onUpdateLabel(event.target.value)}
            className="h-8 w-[204px] rounded-lg border border-[#2f2f2f] bg-[#1a1a1a] px-2 text-[12px] text-[#d7d7d7] outline-none focus:border-[#666]"
            placeholder="Connection text..."
          />
        ) : null}

        {menu.panel === "color" ? (
          <div className="grid gap-1">
            <input
              value={colorDraft}
              onChange={(event) => {
                const nextValue = event.target.value;
                onSetColorDraft(nextValue);
                const next = normalizeHexColor(nextValue);
                if (next) onApplyColor(next, false);
              }}
              onBlur={() => {
                const next = normalizeHexColor(colorDraft);
                if (next) {
                  onApplyColor(next, true);
                  onSetColorDraft(next);
                  return;
                }
                onSetColorDraft(edgeData.color);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  onSetColorDraft(edgeData.color);
                  event.currentTarget.blur();
                }
              }}
              className="h-8 w-full rounded-lg border border-[#2f2f2f] bg-[#1a1a1a] px-2 font-mono text-[12px] text-[#d7d7d7] outline-none focus:border-[#666]"
              placeholder="#ffffff"
              maxLength={7}
              aria-label="Connection color hex"
            />
          </div>
        ) : null}

        {menu.panel === "shape" ? (
          <div className="grid grid-cols-4 gap-1">
            {EDGE_SHAPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`flex items-center justify-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-all duration-200 hover:scale-[1.03] ${
                  edgeData.style === option.value ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
                }`}
                onClick={() => onApplyShape(option.value)}
                aria-label={`Set connection style ${option.label}`}
              >
                <span className="animate-pulse text-[13px]">{option.icon}</span>
              </button>
            ))}
          </div>
        ) : null}

        {menu.panel === "line" ? (
          <div className="grid grid-cols-3 gap-1">
            {LINE_PATTERN_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={`flex items-center justify-center rounded-md px-2 py-1.5 text-[11px] font-medium transition-all duration-200 hover:scale-[1.03] ${
                  edgeData.pattern === option.value ? "bg-[#262626] text-[#f1f1f1]" : "bg-[#1a1a1a] text-[#cfcfcf]"
                }`}
                onClick={() => onApplyPattern(option.value)}
                aria-label={`Set connection line ${option.label}`}
              >
                <span className="text-[14px]">{option.icon}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
