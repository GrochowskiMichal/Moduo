import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import type { ModuoRuntime } from "../../../lib/runtime";
import {
  loadBrainstormDocument,
  saveBrainstormDocument,
  listBrainstorms,
  readStoredActiveBrainstorm,
} from "../storage/brainstorm-storage";
import {
  BRAINSTORM_SELECT_VIEW_EVENT,
  type BrainstormSelectViewDetail,
} from "./layout-events";
import { allTemplates, templateById } from "../templates";
import type { BrainstormDocument, BrainstormEdge, BrainstormEntry } from "../types";
import {
  LAYOUT_PANELS_APPLY_EVENT,
  dispatchLayoutPanelsSet,
  readFeaturePanelState,
  type LayoutPanelsApplyDetail,
} from "../../layout/panel-events";
import { visualByTemplateId } from "./visual-templates";
import { FrameworkPoster } from "./visual-templates/framework-poster";

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

type Props = {
  workspaceId: string;
  runtime: ModuoRuntime;
};

export function BrainstormWorkspace({ workspaceId, runtime }: Props) {
  const [selectedViewId, setSelectedViewId] = useState<string | null>(() => readStoredActiveBrainstorm(workspaceId));
  const [viewCount, setViewCount] = useState(0);
  const [entries, setEntries] = useState<BrainstormEntry[]>([]);
  const [edges, setEdges] = useState<BrainstormEdge[]>([]);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const isHydratingRef = useRef(false);
  const lastSavedRef = useRef("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const forceCloseRightPanel = (left: boolean) => {
      dispatchLayoutPanelsSet({ feature: "brainstorm", left, right: false });
    };
    const current = readFeaturePanelState("brainstorm");
    if (current.right) forceCloseRightPanel(current.left);
    const onPanelsApply = (event: Event) => {
      const detail = (event as CustomEvent<LayoutPanelsApplyDetail>).detail;
      if (!detail || detail.feature !== "brainstorm" || !detail.right) return;
      forceCloseRightPanel(detail.left);
    };
    window.addEventListener(LAYOUT_PANELS_APPLY_EVENT, onPanelsApply);
    return () => window.removeEventListener(LAYOUT_PANELS_APPLY_EVENT, onPanelsApply);
  }, []);

  const refreshViewCount = useCallback(async () => {
    const views = await listBrainstorms(runtime, workspaceId);
    setViewCount(views.length);
    setSelectedViewId((current) => {
      if (current && views.some((view) => view.id === current)) return current;
      const fallback = readStoredActiveBrainstorm(workspaceId);
      if (fallback && views.some((view) => view.id === fallback)) return fallback;
      return views[0]?.id ?? null;
    });
  }, [runtime, workspaceId]);

  useEffect(() => {
    void refreshViewCount();
  }, [refreshViewCount]);

  useEffect(() => {
    setSelectedViewId(readStoredActiveBrainstorm(workspaceId));
  }, [workspaceId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onSelect = (event: Event) => {
      const detail = (event as CustomEvent<BrainstormSelectViewDetail>).detail;
      setSelectedViewId(detail?.viewId ?? null);
      void refreshViewCount();
    };
    window.addEventListener(BRAINSTORM_SELECT_VIEW_EVENT, onSelect);
    return () => window.removeEventListener(BRAINSTORM_SELECT_VIEW_EVENT, onSelect);
  }, [refreshViewCount]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!selectedViewId) {
        isHydratingRef.current = true;
        setEntries([]);
        setEdges([]);
        setSelectedEntryId(null);
        lastSavedRef.current = "";
        isHydratingRef.current = false;
        setIsLoading(false);
        return;
      }
      setIsLoading(true);
      isHydratingRef.current = true;
      try {
        const doc = await loadBrainstormDocument(runtime, workspaceId, selectedViewId);
        if (!active) return;
        const nextEntries = Array.isArray(doc?.entries) ? doc.entries : [];
        const nextEdges = Array.isArray(doc?.edges) ? doc.edges : [];
        setEntries(nextEntries);
        setEdges(nextEdges);
        setSelectedEntryId(nextEntries[0]?.id ?? null);
        lastSavedRef.current = JSON.stringify({ entries: nextEntries, edges: nextEdges });
      } catch {
        if (!active) return;
        setEntries([]);
        setEdges([]);
      } finally {
        if (!active) return;
        isHydratingRef.current = false;
        setIsLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, selectedViewId]);

  useEffect(() => {
    if (!selectedViewId || isHydratingRef.current) return;
    const sig = JSON.stringify({ entries, edges });
    if (sig === lastSavedRef.current) return;
    const timer = window.setTimeout(() => {
      void saveBrainstormDocument(runtime, workspaceId, selectedViewId, {
        entries,
        edges,
        updatedAt: nowIso(),
      } satisfies BrainstormDocument).then(() => {
        lastSavedRef.current = sig;
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [runtime, workspaceId, selectedViewId, entries, edges]);

  const addEntry = useCallback(
    (templateId: string) => {
      const template = templateById.get(templateId);
      if (!template) return;
      const timestamp = nowIso();
      const fields: Record<string, string> = {};
      for (const field of template.fields) fields[field.key] = "";
      if (templateId === "swot") {
        for (const key of ["strengths", "weaknesses", "opportunities", "threats"] as const) {
          fields[key] = "• ";
          fields[`${key}_cards`] = JSON.stringify([{ id: `${key}-seed`, text: "" }]);
          fields[`${key}_value`] = "0";
          fields[`${key}_weight`] = "1";
        }
      }
      const entry: BrainstormEntry = {
        id: safeId(),
        templateId,
        name: template.name,
        fields,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      setEntries((prev) => prev.concat(entry));
      setSelectedEntryId(entry.id);
    },
    []
  );

  const updateSelectedEntryName = useCallback((value: string) => {
    if (!selectedEntryId) return;
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === selectedEntryId ? { ...entry, name: value, updatedAt: nowIso() } : entry
      )
    );
  }, [selectedEntryId]);

  const updateSelectedEntryField = useCallback((key: string, value: string) => {
    if (!selectedEntryId) return;
    setEntries((prev) =>
      prev.map((entry) =>
        entry.id === selectedEntryId
          ? { ...entry, fields: { ...entry.fields, [key]: value }, updatedAt: nowIso() }
          : entry
      )
    );
  }, [selectedEntryId]);

  const deleteEntry = useCallback((entryId: string) => {
    setEntries((prev) => prev.filter((entry) => entry.id !== entryId));
    setEdges((prev) => prev.filter((edge) => edge.source !== entryId && edge.target !== entryId));
    setSelectedEntryId((current) => (current === entryId ? null : current));
  }, []);

  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? entries[0] ?? null;
  const selectedTemplate = selectedEntry ? templateById.get(selectedEntry.templateId) ?? null : null;
  const Visual = selectedTemplate ? visualByTemplateId[selectedTemplate.id] : null;

  if (viewCount === 0) {
    return (
      <FeaturePanelsShell
        feature="brainstorm"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-[#d4d8e1]">
            <h2>No brainstorm sessions yet</h2>
            <p>Use the selector next to Brainstorm in the top nav to create your first session.</p>
          </div>
        }
      />
    );
  }

  if (!selectedViewId) {
    return (
      <FeaturePanelsShell
        feature="brainstorm"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-[#d4d8e1]">
            <h2>No session selected</h2>
            <p>Select a brainstorm session from the top nav dropdown.</p>
          </div>
        }
      />
    );
  }

  if (isLoading) {
    return (
      <FeaturePanelsShell
        feature="brainstorm"
        center={
          <div className="grid h-full place-content-center text-center text-[#a8a8a8]">
            <p>Loading brainstorm...</p>
          </div>
        }
      />
    );
  }

  const left = (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <div>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-[#666]">Templates</h3>
        <div className="grid max-h-[45%] gap-1.5 overflow-y-auto pr-1 custom-scrollbar">
          {allTemplates.map((template) => (
            <button
              key={template.id}
              type="button"
              className="group flex w-full items-center gap-2.5 rounded-xl border border-transparent px-2.5 py-2 text-left transition-all hover:border-[#2a2a2a] hover:bg-[#1a1a1a]"
              onClick={() => addEntry(template.id)}
            >
              <span className="shrink-0 text-[16px]">{template.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] font-medium text-[#d0d0d0]">{template.name}</div>
              </div>
              <Plus size={13} className="shrink-0 text-[#555] opacity-0 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      </div>

      {entries.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <h3 className="mb-3 shrink-0 text-[11px] font-semibold uppercase tracking-widest text-[#666]">
            Entries ({entries.length})
          </h3>
          <div className="grid min-h-0 flex-1 content-start gap-1 overflow-y-auto pr-1 custom-scrollbar">
            {entries.map((entry) => {
              const template = templateById.get(entry.templateId);
              const active = entry.id === selectedEntry?.id;
              return (
                <div
                  key={entry.id}
                  className={`group flex items-center gap-1.5 rounded-xl border p-1 transition-all ${
                    active
                      ? "border-[#2a2a2a] bg-gradient-to-r from-[#1c1c1c] to-[#121212]"
                      : "border-transparent hover:bg-[#161616]"
                  }`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
                    onClick={() => setSelectedEntryId(entry.id)}
                  >
                    <span className="shrink-0 text-[14px]">{template?.icon ?? "📝"}</span>
                    <span className={`flex-1 truncate text-[12px] font-medium ${active ? "text-[#fff]" : "text-[#9fa3ad]"}`}>
                      {entry.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rounded-md p-1 opacity-0 transition-all hover:bg-[#2a2a2a] group-hover:opacity-100"
                    onClick={() => {
                      if (window.confirm(`Delete "${entry.name}"?`)) deleteEntry(entry.id);
                    }}
                  >
                    <Trash2 size={12} className="text-[#888] hover:text-red-400" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );

  const center = selectedEntry && selectedTemplate ? (
    <div className="h-full min-h-0 overflow-y-auto custom-scrollbar">
      {Visual ? (
        <Visual
          entry={selectedEntry}
          template={selectedTemplate}
          onUpdateName={updateSelectedEntryName}
          onUpdateField={updateSelectedEntryField}
        />
      ) : (
        <FrameworkPoster
          entry={selectedEntry}
          template={selectedTemplate}
          onUpdateName={updateSelectedEntryName}
          onUpdateField={updateSelectedEntryField}
          style={{ mode: "orbit", accent: "#6366f1", panel: "#1f2434", glow: "rgba(99,102,241,.3)" }}
        />
      )}
    </div>
  ) : (
    <div className="grid h-full place-content-center gap-3 text-center">
      <div className="text-[40px]">🧠</div>
      <h2 className="text-[16px] font-medium text-[#d4d8e1]">
        {entries.length === 0 ? "Start your visual brainstorm" : "Select an entry"}
      </h2>
      <p className="max-w-[320px] text-[13px] text-[#777]">
        {entries.length === 0
          ? "Pick a template from the left panel. Each entry opens as a graphical framework poster."
          : "Choose an entry from the left panel to open its visual template."}
      </p>
    </div>
  );

  return <FeaturePanelsShell feature="brainstorm" left={left} center={center} />;
}
