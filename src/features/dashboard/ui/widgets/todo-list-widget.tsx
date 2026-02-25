import type { WidgetConfig, TodoListItem } from "../../types";
import { WidgetShell } from "./widget-shell";

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeItems(items: TodoListItem[] | undefined): TodoListItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item.id === "string")
    .map((item) => ({
      id: item.id,
      text: typeof item.text === "string" ? item.text : "",
      done: !!item.done,
    }));
}

type Props = {
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function TodoListWidget({ config, isLocked, onUpdateConfig }: Props) {
  const title = (config.todoListTitle ?? "").trim() || "To-do List";
  const items = normalizeItems(config.todoListItems);

  const updateItems = (next: TodoListItem[]) => onUpdateConfig({ todoListItems: next });

  const toggleItem = (id: string) => {
    if (!isLocked) return;
    updateItems(items.map((item) => (item.id === id ? { ...item, done: !item.done } : item)));
  };

  const addItem = () => {
    if (isLocked) return;
    updateItems([...items, { id: safeId(), text: "New item", done: false }]);
  };

  const removeItem = (id: string) => {
    if (isLocked) return;
    updateItems(items.filter((item) => item.id !== id));
  };

  const updateItemText = (id: string, text: string) => {
    if (isLocked) return;
    updateItems(items.map((item) => (item.id === id ? { ...item, text } : item)));
  };

  return (
    <WidgetShell config={config} title={title}>
      {!isLocked ? (
        <div className="flex h-full min-h-0 flex-col gap-2 px-3 py-3">
          <input
            type="text"
            value={config.todoListTitle ?? ""}
            onChange={(event) => onUpdateConfig({ todoListTitle: event.target.value })}
            placeholder="Title"
            className="w-full rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#cfcfcf] outline-none"
          />

          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {items.length === 0 ? <p className="text-[11px] text-[#7f7f7f]">No items yet.</p> : null}
            {items.map((item) => (
              <div key={item.id} className="mb-2 flex items-center gap-2">
                <input
                  type="text"
                  value={item.text}
                  onChange={(event) => updateItemText(item.id, event.target.value)}
                  className="min-w-0 flex-1 rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#d8d8d8] outline-none"
                />
                <button
                  type="button"
                  className="rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1 text-[11px] text-[#cfcfcf] hover:bg-[#1b1b1b]"
                  onClick={() => removeItem(item.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <button
            type="button"
            className="rounded border border-[#2b2b2b] bg-[#151515] px-2.5 py-1.5 text-[11px] text-[#d8d8d8] hover:bg-[#1b1b1b]"
            onClick={addItem}
          >
            + Add item
          </button>
        </div>
      ) : (
        <div className="flex h-full min-h-0 flex-col px-3 py-3">
          <p className="mb-2 truncate text-[11px] text-[#8f8f8f]">{title}</p>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {items.length === 0 ? <p className="text-[12px] text-[#7f7f7f]">No items.</p> : null}
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="mb-0.5 flex w-full items-center gap-1 rounded-md px-0.5 py-0.5 text-left"
                onClick={() => toggleItem(item.id)}
              >
                <span className={`grid h-4 w-4 place-items-center rounded-sm border text-[10px] ${item.done ? "border-[#4a4a4a] bg-[#1b1b1b] text-[#d0d0d0]" : "border-[#3a3a3a] text-[#777777]"}`}>
                  {item.done ? "✓" : ""}
                </span>
                <span className={`min-w-0 flex-1 truncate text-[12px] ${item.done ? "text-[#B2B2B2]/50 line-through" : "text-[#d8d8d8]"}`}>
                  {item.text || "Untitled item"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
