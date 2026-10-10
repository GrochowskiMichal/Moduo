import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import {
  AlertTriangle,
  Ban,
  ChartNoAxesColumnIncreasing,
  Eye,
  EyeOff,
  Palette,
  Square,
  Type,
} from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { NODE_ICON_OPTIONS, resolveNodeIcon } from "./node-icons";
import type { MindmapNodeData, MindmapNode as MNode, NodePriority } from "./types";
import { PRIORITY_META } from "./types";

export type { MindmapNodeData };
export type MindmapNodeType = Node<MindmapNodeData, "mindmap">;

type Props = NodeProps<MNode>;
type NodeEditorPanel = "border" | "background" | "priority" | "text" | "icon" | "progress";

const DEFAULT_CONNECTOR = "#ffffff";

const HANDLE_POINTS = [
  { id: "top", position: Position.Top, style: { left: "50%" } },
  { id: "left", position: Position.Left, style: { top: "50%" } },
  { id: "right", position: Position.Right, style: { top: "50%" } },
  { id: "bottom", position: Position.Bottom, style: { left: "50%" } },
] as const;

function emitNodeUpdate(nodeId: string, key: keyof MindmapNodeData, value: any) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("moduo:mindmap:node-update", { detail: { nodeId, key, value } }),
  );
}

function PanelButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`nodrag grid h-7 w-7 place-items-center rounded-lg transition-all duration-200 hover:scale-105 ${
        active ? "bg-[#242424] text-[#f1f1f1]" : "bg-[#181818] text-[#cfcfcf]"
      }`}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

function NoneIconButton({
  onClick,
  active,
  label,
}: {
  onClick: () => void;
  active: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`nodrag grid h-6 w-6 place-items-center text-[#ef4444] transition-opacity ${active ? "opacity-100" : "opacity-80 hover:opacity-100"}`}
      aria-label={label}
      title={label}
    >
      <Ban size={11} />
    </button>
  );
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (!/^#([0-9a-fA-F]{6})$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export const MindmapCustomNode = memo(function MindmapCustomNode({ data, selected, id }: Props) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [panel, setPanel] = useState<NodeEditorPanel | null>(null);
  const [borderColorDraft, setBorderColorDraft] = useState(data.borderColor || "");
  const [bgColorDraft, setBgColorDraft] = useState(data.bgColor || "");
  const [textColorDraft, setTextColorDraft] = useState(data.textColor || "");
  const [tagInput, setTagInput] = useState("");
  const [tagInputOpen, setTagInputOpen] = useState(false);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const progressTrackRef = useRef<HTMLDivElement | null>(null);

  const isRoot = data.depth === 0;
  const priority = PRIORITY_META[data.priority] || PRIORITY_META.none;
  const rootScale = isRoot
    ? "min-w-[280px] max-w-[400px]"
    : data.depth === 1
      ? "min-w-[220px] max-w-[320px]"
      : "min-w-[180px] max-w-[280px]";
  const titleSize = isRoot ? "text-[18px]" : data.depth === 1 ? "text-[14px]" : "text-[13px]";
  const padding = isRoot ? "p-5" : "p-3.5";
  const bgColor = data.bgColor || "#141414";
  const borderColor = data.borderColor || "";
  const hasBorder = borderColor !== "";
  const connectorColor = hasBorder ? borderColor : DEFAULT_CONNECTOR;
  const textColor = data.textColor || "#f3f4f6";
  const progressVisible =
    typeof data.progressVisible === "boolean" ? data.progressVisible : data.progress > 0;
  const showProgress = progressVisible;
  const TitleIcon = resolveNodeIcon(data.icon);

  useEffect(() => {
    if (!selected) {
      setEditorOpen(false);
      setPanel(null);
      setTagInput("");
      setTagInputOpen(false);
    }
  }, [selected]);

  useEffect(() => {
    setBorderColorDraft(data.borderColor || "");
  }, [data.borderColor, id]);

  useEffect(() => {
    setBgColorDraft(data.bgColor || "");
  }, [data.bgColor, id]);

  useEffect(() => {
    setTextColorDraft(data.textColor || "");
  }, [data.textColor, id]);

  useEffect(() => {
    if (!editorOpen || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setEditorOpen(false);
        setPanel(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorOpen]);

  const update = useCallback(
    (key: keyof MindmapNodeData, value: any) => {
      emitNodeUpdate(id, key, value);
    },
    [id],
  );

  const updateProgressFromClientX = useCallback(
    (clientX: number) => {
      const track = progressTrackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const snapped = Math.round((ratio * 100) / 5) * 5;
      update("progress", Math.max(0, Math.min(100, snapped)));
    },
    [update],
  );

  const addTag = useCallback(
    (value: string) => {
      const tag = value.trim().toLowerCase();
      if (!tag || data.tags.includes(tag)) return false;
      update("tags", [...data.tags, tag]);
      return true;
    },
    [data.tags, update],
  );

  const removeTag = useCallback(
    (tag: string) =>
      update(
        "tags",
        data.tags.filter((item) => item !== tag),
      ),
    [data.tags, update],
  );

  const submitTagInput = useCallback(() => {
    if (tagInput.trim() && addTag(tagInput)) {
      setTagInput("");
    }
    setTagInputOpen(false);
  }, [addTag, tagInput]);

  const cancelTagInput = useCallback(() => {
    setTagInput("");
    setTagInputOpen(false);
  }, []);

  useEffect(() => {
    if (tagInputOpen) tagInputRef.current?.focus();
  }, [tagInputOpen]);

  const togglePanel = useCallback((next: NodeEditorPanel) => {
    setPanel((current) => (current === next ? null : next));
  }, []);

  const handleModifierClick = useCallback((event: React.MouseEvent) => {
    if (!event.metaKey && !event.ctrlKey) return;
    setEditorOpen(true);
    setPanel(null);
  }, []);

  return (
    <div
      className={`group relative ${rootScale} rounded-2xl shadow-[0_10px_24px_rgba(0,0,0,0.38),0_2px_6px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-250 hover:shadow-[0_16px_34px_rgba(0,0,0,0.5),0_4px_10px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)] ${selected ? "ring-1 ring-[#f1f1f1]/45" : ""}`}
      style={{
        background: bgColor,
        borderWidth: hasBorder ? (isRoot ? 2 : 1.5) : 0,
        borderStyle: "solid",
        borderColor: `${borderColor}60`,
      }}
      onClick={handleModifierClick}
      role="treeitem"
      aria-selected={selected}
      aria-label={data.label}
    >
      {HANDLE_POINTS.map((point) => (
        <Handle
          key={`target-${point.id}`}
          type="target"
          id={`${point.id}-target`}
          position={point.position}
          className="mindmap-handle-dot !h-px !w-px !border-0 !bg-transparent"
          style={{ ...point.style, "--dot-color": connectorColor, "--dot-border": bgColor } as any}
        />
      ))}

      <div className={padding}>
        {editorOpen ? (
          <div className="mb-2 flex items-center gap-1">
            <PanelButton
              active={panel === "border"}
              onClick={() => togglePanel("border")}
              label="Border"
            >
              <Square size={13} />
            </PanelButton>
            <PanelButton
              active={panel === "background"}
              onClick={() => togglePanel("background")}
              label="Background"
            >
              <Palette size={13} />
            </PanelButton>
            <PanelButton
              active={panel === "priority"}
              onClick={() => togglePanel("priority")}
              label="Priority"
            >
              <AlertTriangle size={13} />
            </PanelButton>
            <PanelButton active={panel === "text"} onClick={() => togglePanel("text")} label="Text">
              <Type size={13} />
            </PanelButton>
            <PanelButton
              active={panel === "progress"}
              onClick={() => togglePanel("progress")}
              label="Progress"
            >
              <ChartNoAxesColumnIncreasing size={13} />
            </PanelButton>
          </div>
        ) : null}

        {editorOpen && panel === "border" ? (
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={borderColorDraft}
              onChange={(event) => {
                const nextValue = event.target.value;
                setBorderColorDraft(nextValue);
                if (nextValue.trim() === "") {
                  update("borderColor", "");
                  return;
                }
                const next = normalizeHexColor(nextValue);
                if (next) update("borderColor", next);
              }}
              onBlur={() => {
                const next = normalizeHexColor(borderColorDraft);
                if (next) {
                  update("borderColor", next);
                  setBorderColorDraft(next);
                  return;
                }
                setBorderColorDraft(data.borderColor || "");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.currentTarget as HTMLInputElement).blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setBorderColorDraft(data.borderColor || "");
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
              className="nodrag h-8 min-w-0 flex-1 rounded-lg border border-[#2f2f2f] bg-[#1a1a1a] px-2 font-mono text-[12px] text-[#d7d7d7] outline-none focus:border-[#666]"
              placeholder="#ffffff"
              maxLength={7}
              aria-label="Node border color hex"
            />
          </div>
        ) : null}

        {editorOpen && panel === "background" ? (
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={bgColorDraft}
              onChange={(event) => {
                const nextValue = event.target.value;
                setBgColorDraft(nextValue);
                if (nextValue.trim() === "") {
                  update("bgColor", "");
                  return;
                }
                const next = normalizeHexColor(nextValue);
                if (next) update("bgColor", next);
              }}
              onBlur={() => {
                const next = normalizeHexColor(bgColorDraft);
                if (next) {
                  update("bgColor", next);
                  setBgColorDraft(next);
                  return;
                }
                setBgColorDraft(data.bgColor || "");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.currentTarget as HTMLInputElement).blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setBgColorDraft(data.bgColor || "");
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
              className="nodrag h-8 min-w-0 flex-1 rounded-lg border border-[#2f2f2f] bg-[#1a1a1a] px-2 font-mono text-[12px] text-[#d7d7d7] outline-none focus:border-[#666]"
              placeholder="#141414"
              maxLength={7}
              aria-label="Node background color hex"
            />
          </div>
        ) : null}

        {editorOpen && panel === "priority" ? (
          <div className="mb-2 flex flex-wrap gap-1">
            <NoneIconButton
              onClick={() => update("priority", "none")}
              active={data.priority === "none"}
              label="No priority"
            />
            {(["none", "low", "medium", "high", "critical"] as NodePriority[]).map((key) => {
              if (key === "none") return null;
              const val = PRIORITY_META[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => update("priority", key)}
                  className="nodrag rounded-lg px-2 py-1 text-[10px] font-bold transition-all"
                  style={
                    data.priority === key
                      ? { background: "#262626", border: "1px solid #666", color: val.color }
                      : { background: "#181818", border: "1px solid transparent", color: val.color }
                  }
                >
                  {`${val.badge} ${val.label}`}
                </button>
              );
            })}
          </div>
        ) : null}

        {editorOpen && panel === "text" ? (
          <div className="mb-2 flex items-center gap-2">
            <input
              type="text"
              value={textColorDraft}
              onChange={(event) => {
                const nextValue = event.target.value;
                setTextColorDraft(nextValue);
                if (nextValue.trim() === "") {
                  update("textColor", "");
                  return;
                }
                const next = normalizeHexColor(nextValue);
                if (next) update("textColor", next);
              }}
              onBlur={() => {
                const next = normalizeHexColor(textColorDraft);
                if (next) {
                  update("textColor", next);
                  setTextColorDraft(next);
                  return;
                }
                setTextColorDraft(data.textColor || "");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  (event.currentTarget as HTMLInputElement).blur();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setTextColorDraft(data.textColor || "");
                  (event.currentTarget as HTMLInputElement).blur();
                }
              }}
              className="nodrag h-8 min-w-0 flex-1 rounded-lg border border-[#2f2f2f] bg-[#1a1a1a] px-2 font-mono text-[12px] text-[#d7d7d7] outline-none focus:border-[#666]"
              placeholder="#f3f4f6"
              maxLength={7}
              aria-label="Node text color hex"
            />
          </div>
        ) : null}

        {editorOpen && panel === "icon" ? (
          <div className="mb-2 flex flex-wrap gap-1">
            <NoneIconButton
              onClick={() => update("icon", "")}
              active={!data.icon}
              label="No icon"
            />
            {NODE_ICON_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => update("icon", option.key)}
                className={`nodrag grid place-items-center rounded-lg p-1.5 transition-all ${
                  data.icon === option.key
                    ? "bg-[#262626] ring-1 ring-[#666] text-[#f0f3fb]"
                    : "bg-[#181818] text-[#a3a3a3] hover:bg-[#202020]"
                }`}
                aria-label={`Set icon ${option.label}`}
              >
                <option.Icon size={14} />
              </button>
            ))}
          </div>
        ) : null}

        <div className="mb-1.5 flex items-start gap-2">
          <button
            type="button"
            onClick={editorOpen ? () => togglePanel("icon") : undefined}
            className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center text-[#d8dfcc] ${
              editorOpen ? "nodrag rounded-lg border border-[#3a3a3a] bg-[#181818]" : ""
            }`}
            aria-label={editorOpen ? "Edit icon" : undefined}
          >
            <TitleIcon size={14} />
          </button>
          <div className="min-w-0 flex-1">
            {editorOpen ? (
              <>
                <input
                  className={`nodrag ${titleSize} h-8 w-full border-0 bg-transparent px-0 text-[12px] font-bold outline-none`}
                  style={{ color: textColor }}
                  value={data.label}
                  onChange={(event) => update("label", event.target.value)}
                  placeholder="Title"
                />
                <textarea
                  className="nodrag mt-1.5 w-full resize-none border-0 bg-transparent px-0 py-0 text-[12px] text-[#d7ddcc] outline-none"
                  rows={3}
                  value={data.description}
                  onChange={(event) => update("description", event.target.value)}
                  placeholder="Description"
                />
                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
                  {data.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-1 rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[11px] text-[#a3a3a3]"
                    >
                      <span>#{tag}</span>
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="border-0 bg-transparent p-0 text-[11px] leading-none text-[#7c8494]"
                        aria-label={`Remove tag ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {tagInputOpen ? (
                    <div className="inline-flex items-center gap-1 rounded-full bg-[#181818] px-2 py-0.5 text-[11px] text-[#cfcfcf]">
                      <span>#</span>
                      <input
                        ref={tagInputRef}
                        className="w-20 bg-transparent text-[11px] text-[#cfcfcf] outline-none"
                        value={tagInput}
                        onChange={(event) => setTagInput(event.target.value)}
                        onBlur={submitTagInput}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            submitTagInput();
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            cancelTagInput();
                          }
                        }}
                        placeholder="tag"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-full bg-[#181818] px-2 py-0.5 text-[11px] text-[#cfcfcf]"
                      onClick={() => setTagInputOpen(true)}
                    >
                      + Tag
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="mt-0.5 flex items-center gap-2">
                  <h3
                    className={`${titleSize} font-bold leading-snug`}
                    style={{ color: textColor }}
                  >
                    {data.label || "Untitled"}
                  </h3>
                  {data.priority !== "none" ? (
                    <span
                      className="shrink-0 text-[15px] font-bold leading-none"
                      style={{ color: priority.color }}
                      aria-label={`Priority: ${priority.label}`}
                    >
                      {priority.badge}
                    </span>
                  ) : null}
                </div>
                {data.description ? (
                  <p className="mt-1.5 line-clamp-2 text-[11px] font-medium leading-relaxed text-[#b8b8b8]">
                    {data.description}
                  </p>
                ) : null}
                {data.tags?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {data.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-[#ffffff08] px-1.5 py-0.5 text-[9px] font-semibold text-[#c7c7c7]"
                      >
                        #{tag}
                      </span>
                    ))}
                    {data.tags.length > 3 ? (
                      <span className="text-[9px] text-[#9d9d9d]">+{data.tags.length - 3}</span>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        {showProgress || (editorOpen && panel === "progress") ? (
          <div
            className="mt-2.5"
            role="progressbar"
            aria-valuenow={data.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[9px] font-medium text-[#8a8a8a]">Progress</span>
              <div className="flex items-center gap-2">
                {editorOpen && panel === "progress" ? (
                  <button
                    type="button"
                    onClick={() => update("progressVisible", !progressVisible)}
                    className="nodrag grid h-5 w-5 place-items-center text-[#b8b8b8] transition-colors hover:text-[#ececec]"
                    aria-label={progressVisible ? "Hide progress bar" : "Show progress bar"}
                    title={progressVisible ? "Hide progress bar" : "Show progress bar"}
                  >
                    {progressVisible ? <Eye size={11} /> : <EyeOff size={11} />}
                  </button>
                ) : null}
                <span className="text-[9px] font-bold text-[#9a9a9a]">{data.progress}%</span>
              </div>
            </div>
            <div
              ref={progressTrackRef}
              className={`relative h-1 w-full overflow-hidden rounded-full bg-[#ffffff10] ${editorOpen && panel === "progress" ? "nodrag cursor-pointer" : ""}`}
              onMouseDown={
                editorOpen && panel === "progress"
                  ? (event) => {
                      event.preventDefault();
                      updateProgressFromClientX(event.clientX);
                      const onMove = (moveEvent: MouseEvent) =>
                        updateProgressFromClientX(moveEvent.clientX);
                      const onUp = () => {
                        window.removeEventListener("mousemove", onMove);
                        window.removeEventListener("mouseup", onUp);
                      };
                      window.addEventListener("mousemove", onMove);
                      window.addEventListener("mouseup", onUp);
                    }
                  : undefined
              }
              aria-label={editorOpen && panel === "progress" ? "Node progress" : undefined}
            >
              <div
                className="h-full rounded-full transition-all duration-150 ease-out"
                style={{
                  width: `${data.progress}%`,
                  background:
                    data.progress === 100
                      ? "linear-gradient(90deg, #22c55e, #4ade80)"
                      : `linear-gradient(90deg, ${connectorColor}, ${connectorColor}80)`,
                }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {HANDLE_POINTS.map((point) => (
        <Handle
          key={`source-${point.id}`}
          type="source"
          id={`${point.id}-source`}
          position={point.position}
          className="mindmap-handle-dot !h-px !w-px !border-0 !bg-transparent"
          style={{ ...point.style, "--dot-color": connectorColor, "--dot-border": bgColor } as any}
        />
      ))}
    </div>
  );
});
