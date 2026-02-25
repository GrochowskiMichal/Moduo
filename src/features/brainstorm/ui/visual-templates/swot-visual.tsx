import {
  DndContext,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS as DndCSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TemplateVisualProps } from "./template-visual-props";

type QuadrantKey = "strengths" | "weaknesses" | "opportunities" | "threats";
type SwotCard = { id: string; text: string };
type SwotColumns = Record<QuadrantKey, SwotCard[]>;

const QUADRANTS: { key: QuadrantKey; label: string; tone: string; accent: string }[] = [
  {
    key: "strengths",
    label: "Strengths",
    tone: "border-[#262626] bg-[#111111]",
    accent: "bg-emerald-400",
  },
  {
    key: "weaknesses",
    label: "Weaknesses",
    tone: "border-[#262626] bg-[#111111]",
    accent: "bg-rose-400",
  },
  {
    key: "opportunities",
    label: "Opportunities",
    tone: "border-[#262626] bg-[#111111]",
    accent: "bg-sky-400",
  },
  {
    key: "threats",
    label: "Threats",
    tone: "border-[#262626] bg-[#111111]",
    accent: "bg-amber-300",
  },
];

function readNumber(raw: string | undefined, fallback: number) {
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function createCardId(key: QuadrantKey) {
  return `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function parseCards(raw: string | undefined, key: QuadrantKey, bulletText: string): SwotCard[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const cards = parsed
          .map((item, index) => {
            const id = typeof item === "object" && item && "id" in item ? String((item as any).id) : `${key}-legacy-${index}`;
            const text = typeof item === "object" && item && "text" in item ? String((item as any).text ?? "") : "";
            return { id, text };
          })
          .filter((item) => item.id);
        if (cards.length > 0) return cards;
      }
    } catch {
      // Fallback to bullet parsing below
    }
  }

  const lines = (bulletText || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[•\-*]\s*/, "").trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [{ id: `${key}-legacy-0`, text: "" }];
  return lines.map((line, index) => ({ id: `${key}-legacy-${index}`, text: line }));
}

function ensureAtLeastOne(cards: SwotCard[], key: QuadrantKey): SwotCard[] {
  return cards.length > 0 ? cards : [{ id: createCardId(key), text: "" }];
}

function toBulletText(cards: SwotCard[]) {
  if (cards.length === 0) return "• ";
  return cards.map((card) => `• ${card.text}`).join("\n");
}

function findCardLocation(columns: SwotColumns, cardId: string): { key: QuadrantKey; index: number } | null {
  for (const quadrant of QUADRANTS) {
    const index = columns[quadrant.key].findIndex((card) => card.id === cardId);
    if (index >= 0) return { key: quadrant.key, index };
  }
  return null;
}

function SortableCard({
  card,
  onChange,
  onRemove,
  onSubmit,
  onEmptyBackspace,
}: {
  card: SwotCard;
  onChange: (text: string) => void;
  onRemove: () => void;
  onSubmit: () => void;
  onEmptyBackspace: () => void;
}) {
  const sortable = useSortable({ id: card.id });
  const style = {
    transform: DndCSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };

  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`group rounded-xl border border-[#2c2c2c] bg-[#141414] p-2.5 shadow-sm transition-colors hover:border-[#3a3a3a] ${
        sortable.isDragging ? "opacity-70" : ""
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <button
          type="button"
          {...sortable.attributes}
          {...sortable.listeners}
          className="cursor-grab rounded-lg p-1.5 text-[#9aa2b2] hover:bg-[#1a1a1a] active:cursor-grabbing"
          aria-label="Drag card"
        >
          <GripVertical size={14} />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg p-1.5 text-[#9aa2b2] opacity-0 transition-opacity hover:bg-[#1a1a1a] hover:text-red-300 group-hover:opacity-100"
          aria-label="Delete card"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <textarea
        value={card.text}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            onSubmit();
          }
          if (event.key === "Backspace" && !card.text.trim()) {
            onEmptyBackspace();
          }
        }}
        placeholder="Bullet point"
        rows={2}
        id={`swot-card-${card.id}`}
        data-swot-card={card.id}
        className="min-h-[46px] w-full resize-none bg-transparent text-[13px] font-medium leading-relaxed text-[#e6e6e6] outline-none placeholder:text-[#666]"
      />
    </div>
  );
}

function QuadrantColumn({
  keyName,
  label,
  tone,
  accent,
  cards,
  onAdd,
  onAddAfter,
  onCardChange,
  onCardRemove,
}: {
  keyName: QuadrantKey;
  label: string;
  tone: string;
  accent: string;
  cards: SwotCard[];
  onAdd: () => void;
  onAddAfter: (cardId: string) => void;
  onCardChange: (cardId: string, text: string) => void;
  onCardRemove: (cardId: string) => void;
}) {
  const droppable = useDroppable({ id: `column:${keyName}` });

  return (
    <div
      ref={droppable.setNodeRef}
      className={`flex min-h-0 flex-col rounded-2xl border p-3 md:p-4 ${tone} ${
        droppable.isOver ? "ring-1 ring-white/15" : ""
      } md:h-[420px] xl:h-[480px]`}
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${accent}`} aria-hidden="true" />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-bold uppercase tracking-widest text-[#d4d4d4]">{label}</div>
            <div className="text-[11px] text-[#777]">{cards.filter((card) => card.text.trim()).length} items</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2 py-1 text-[12px] font-bold text-[#d0d0d0] transition-colors hover:border-[#444] hover:bg-[#1a1a1a]"
          aria-label={`Add ${label} item`}
        >
          <Plus size={14} className="text-[#999]" />
          Add
        </button>
      </div>

      <SortableContext items={cards.map((card) => card.id)} strategy={verticalListSortingStrategy}>
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5 custom-scrollbar">
          <div className="grid content-start gap-2">
            {cards.map((card) => (
              <SortableCard
                key={card.id}
                card={card}
                onChange={(text) => onCardChange(card.id, text)}
                onRemove={() => onCardRemove(card.id)}
                onSubmit={() => onAddAfter(card.id)}
                onEmptyBackspace={() => {
                  if (cards.length <= 1) return;
                  onCardRemove(card.id);
                }}
              />
            ))}
          </div>
        </div>
      </SortableContext>
    </div>
  );
}

export function SwotVisual({ template, entry, onUpdateName, onUpdateField }: TemplateVisualProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [showScoring, setShowScoring] = useState(false);
  const pendingFocusIdRef = useRef<string | null>(null);

  const columns = useMemo<SwotColumns>(() => {
    const next = {} as SwotColumns;
    for (const quadrant of QUADRANTS) {
      next[quadrant.key] = parseCards(entry.fields[`${quadrant.key}_cards`], quadrant.key, entry.fields[quadrant.key] ?? "");
    }
    return next;
  }, [entry.fields]);

  const stats = QUADRANTS.map((quadrant) => {
    const value = readNumber(entry.fields[`${quadrant.key}_value`], 0);
    const weight = readNumber(entry.fields[`${quadrant.key}_weight`], 1);
    return { ...quadrant, value, weight, score: value * weight };
  });
  const totalScore = stats.reduce((sum, stat) => sum + stat.score, 0);

  const persistColumns = (next: SwotColumns, changedKeys?: QuadrantKey[]) => {
    const keys = changedKeys ?? QUADRANTS.map((quadrant) => quadrant.key);
    for (const key of keys) {
      const cards = ensureAtLeastOne(next[key], key);
      onUpdateField(`${key}_cards`, JSON.stringify(cards));
      onUpdateField(key, toBulletText(cards));
    }
  };

  useEffect(() => {
    const cardId = pendingFocusIdRef.current;
    if (!cardId) return;
    pendingFocusIdRef.current = null;
    window.requestAnimationFrame(() => {
      const element = document.getElementById(`swot-card-${cardId}`) as HTMLTextAreaElement | null;
      element?.focus();
      if (element) element.selectionStart = element.selectionEnd = element.value.length;
    });
  }, [columns]);

  const onAddCard = (key: QuadrantKey) => {
    const id = createCardId(key);
    pendingFocusIdRef.current = id;
    const next: SwotColumns = {
      ...columns,
      [key]: [...columns[key], { id, text: "" }],
    };
    persistColumns(next, [key]);
  };

  const onAddCardAfter = (key: QuadrantKey, afterId: string) => {
    const id = createCardId(key);
    pendingFocusIdRef.current = id;
    const cards = [...columns[key]];
    const index = cards.findIndex((card) => card.id === afterId);
    cards.splice(index >= 0 ? index + 1 : cards.length, 0, { id, text: "" });
    persistColumns({ ...columns, [key]: cards }, [key]);
  };

  const onCardChange = (key: QuadrantKey, cardId: string, text: string) => {
    const next: SwotColumns = {
      ...columns,
      [key]: columns[key].map((card) => (card.id === cardId ? { ...card, text } : card)),
    };
    persistColumns(next, [key]);
  };

  const onCardRemove = (key: QuadrantKey, cardId: string) => {
    const filtered = columns[key].filter((card) => card.id !== cardId);
    const next: SwotColumns = {
      ...columns,
      [key]: ensureAtLeastOne(filtered, key),
    };
    persistColumns(next, [key]);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) return;

    const source = findCardLocation(columns, activeId);
    if (!source) return;

    const targetColumn: QuadrantKey | null = overId.startsWith("column:")
      ? (overId.replace("column:", "") as QuadrantKey)
      : findCardLocation(columns, overId)?.key ?? null;
    if (!targetColumn) return;

    const next: SwotColumns = {
      strengths: [...columns.strengths],
      weaknesses: [...columns.weaknesses],
      opportunities: [...columns.opportunities],
      threats: [...columns.threats],
    };

    if (source.key === targetColumn) {
      const sourceCards = next[source.key];
      const overLoc = overId.startsWith("column:") ? null : findCardLocation(columns, overId);
      const targetIndex = overLoc ? overLoc.index : sourceCards.length - 1;
      if (targetIndex === source.index) return;
      next[source.key] = arrayMove(sourceCards, source.index, targetIndex);
      persistColumns(next, [source.key]);
    } else {
      const sourceCards = next[source.key];
      const [moved] = sourceCards.splice(source.index, 1);
      if (!moved) return;
      const targetCards = next[targetColumn];
      const overLoc = overId.startsWith("column:") ? null : findCardLocation(columns, overId);
      const targetIndex = overLoc ? overLoc.index : targetCards.length;
      targetCards.splice(targetIndex, 0, moved);
      next[source.key] = ensureAtLeastOne(sourceCards, source.key);
      next[targetColumn] = ensureAtLeastOne(targetCards, targetColumn);
      persistColumns(next, [source.key, targetColumn]);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1260px] pb-6">
      <div className="mb-5 flex items-start gap-4">
        <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-[#2a2a2a] bg-[#141414] text-[22px]">
          {template.icon}
        </div>
        <div className="min-w-0 flex-1">
          <input
            value={entry.name}
            onChange={(event) => onUpdateName(event.target.value)}
            className="w-full bg-transparent text-[24px] font-semibold leading-tight text-[#f2f2f2] outline-none"
            placeholder={template.name}
          />
          <p className="mt-1 max-w-[840px] text-[13px] leading-relaxed text-[#8b8b8b]">{template.description}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <div
              className="inline-flex items-center gap-2 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2.5 py-1.5 text-[12px] font-bold text-[#d0d0d0]"
              style={{ boxShadow: `0 0 0 1px ${template.color}22 inset` }}
              aria-label={`Total score ${totalScore.toFixed(1)}`}
            >
              <span className="text-[#777]">Score</span>
              <span className="tabular-nums text-[#f2f2f2]">{totalScore.toFixed(1)}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowScoring((prev) => !prev)}
              className="rounded-lg border border-[#2c2c2c] bg-[#151515] px-2.5 py-1.5 text-[12px] font-bold text-[#d0d0d0] transition-colors hover:border-[#444] hover:bg-[#1a1a1a]"
            >
              {showScoring ? "Hide scoring" : "Scoring"}
            </button>
            <div className="text-[12px] text-[#666]">
              Enter adds a bullet · Shift+Enter newline · drag between quadrants
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 rounded-2xl border border-[#262626] bg-[#0d0d0d] p-4 md:p-5">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#666]">Subject</div>
            <input
              value={entry.fields.subject ?? ""}
              onChange={(event) => onUpdateField("subject", event.target.value)}
              placeholder="What are you analyzing?"
              className="mt-1 w-full rounded-xl border border-[#2c2c2c] bg-[#151515] px-3 py-2 text-[13px] font-medium text-[#e0e0e0] outline-none transition-colors hover:border-[#444] focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20"
            />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#666]">Action items</div>
            <textarea
              value={entry.fields.action_items ?? ""}
              onChange={(event) => onUpdateField("action_items", event.target.value)}
              rows={2}
              placeholder="Strategic actions based on the analysis..."
              className="mt-1 w-full resize-y rounded-xl border border-[#2c2c2c] bg-[#151515] px-3 py-2 text-[13px] font-medium leading-relaxed text-[#e0e0e0] outline-none transition-colors hover:border-[#444] focus:border-indigo-500/40 focus:ring-1 focus:ring-indigo-500/20 custom-scrollbar placeholder:text-[#666]"
            />
          </div>
        </div>

        {showScoring ? (
          <div className="mt-4 rounded-xl border border-[#262626] bg-[#101010] p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-widest text-[#666]">Scoring</div>
            <div className="grid gap-2 md:grid-cols-2">
              {stats.map((stat) => (
                <div
                  key={stat.key}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[#262626] bg-[#111111] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${stat.accent}`} aria-hidden="true" />
                      <div className="truncate text-[12px] font-bold text-[#d4d4d4]">{stat.label}</div>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#777]">
                      Score <span className="tabular-nums font-bold text-[#d0d0d0]">{stat.score.toFixed(1)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <label className="text-[11px] font-bold text-[#777]">
                      V
                      <input
                        type="number"
                        value={entry.fields[`${stat.key}_value`] ?? "0"}
                        onChange={(event) => onUpdateField(`${stat.key}_value`, event.target.value)}
                        className="ml-1 w-14 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2 py-1 text-[12px] font-bold text-[#e0e0e0] outline-none transition-colors hover:border-[#444] focus:border-[#555]"
                      />
                    </label>
                    <label className="text-[11px] font-bold text-[#777]">
                      W
                      <input
                        type="number"
                        step="0.1"
                        value={entry.fields[`${stat.key}_weight`] ?? "1"}
                        onChange={(event) => onUpdateField(`${stat.key}_weight`, event.target.value)}
                        className="ml-1 w-14 rounded-lg border border-[#2c2c2c] bg-[#151515] px-2 py-1 text-[12px] font-bold text-[#e0e0e0] outline-none transition-colors hover:border-[#444] focus:border-[#555]"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="grid gap-3 md:grid-cols-2 md:auto-rows-fr">
          {QUADRANTS.map((quadrant) => (
            <QuadrantColumn
              key={quadrant.key}
              keyName={quadrant.key}
              label={quadrant.label}
              tone={quadrant.tone}
              accent={quadrant.accent}
              cards={columns[quadrant.key]}
              onAdd={() => onAddCard(quadrant.key)}
              onAddAfter={(cardId) => onAddCardAfter(quadrant.key, cardId)}
              onCardChange={(cardId, text) => onCardChange(quadrant.key, cardId, text)}
              onCardRemove={(cardId) => onCardRemove(quadrant.key, cardId)}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
