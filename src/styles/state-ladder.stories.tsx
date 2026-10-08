// DS-1 — the state layer (tokens.css §5b) at token level, before any primitive
// adopts it (DS-2). Switch Theme, Shade, Accent and Density in the toolbar:
// hover, active and selected must stay distinct from each other on every
// surface. The "Before" column shows the legacy tokens that collapse into one
// grey on dark. Reference comp: .design/tasks-dogfood/ui-proposal.html.
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { cn } from "@/lib/utils";

const SURFACES = [
  { name: "Card", className: "bg-card", note: "panels, rails" },
  { name: "Background", className: "bg-background", note: "app canvas" },
  { name: "Popover", className: "bg-popover", note: "menus, dialogs" },
  { name: "Muted", className: "bg-muted", note: "input wells, tracks" },
] as const;

const STATES = [
  { name: "Rest", className: "" },
  { name: "Hover", className: "bg-state-hover" },
  { name: "Active · current page", className: "bg-state-active" },
  { name: "Selected", className: "bg-state-selected" },
  {
    name: "Selected + hairline",
    className: "bg-state-selected ring-1 ring-inset ring-state-selected",
  },
] as const;

const LEGACY_STATES = [
  { name: "Rest", className: "" },
  { name: "Hover · bg-accent", className: "bg-accent" },
  { name: "Active · bg-secondary", className: "bg-secondary" },
  { name: "Selected · --selected-bg", className: "bg-[var(--selected-bg)]" },
] as const;

function Row({ label, className }: { label: string; className: string }) {
  return (
    <div
      className={cn(
        "flex h-[var(--row-h)] items-center rounded-md px-2 text-base text-foreground",
        className,
      )}
    >
      {label}
    </div>
  );
}

function Panel({
  title,
  note,
  className,
  children,
}: {
  title: string;
  note: string;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn("flex flex-col gap-1 rounded-lg border border-hairline p-2", className)}>
      <header className="flex items-baseline justify-between px-2 pb-1">
        <h3 className="font-display text-sm font-medium text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground">{note}</span>
      </header>
      {children}
    </section>
  );
}

function InteractiveRows() {
  const [selected, setSelected] = useState("Plan the week");
  const items = ["Plan the week", "Review the widget PR", "Water plants", "Expense report"];
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          aria-pressed={item === selected}
          onClick={() => setSelected(item)}
          className={cn(
            "flex h-[var(--row-h)] items-center rounded-md px-2 text-left text-base text-foreground outline-none transition-colors duration-[var(--motion-fade)] focus-visible:ring-2 focus-visible:ring-ring",
            item === selected ? "bg-state-selected" : "hover:bg-state-hover active:bg-state-active",
          )}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

function RaisedPlate() {
  const [current, setCurrent] = useState("Board");
  return (
    <div className="inline-flex h-[var(--ctrl-h-sm)] items-center gap-0.5 rounded-md bg-muted p-0.5">
      {["List", "Board", "Timeline"].map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={view === current}
          onClick={() => setCurrent(view)}
          className={cn(
            "inline-flex h-full items-center rounded-sm px-2 font-display text-sm font-medium outline-none transition-colors duration-[var(--motion-fade)] focus-visible:ring-2 focus-visible:ring-ring",
            view === current
              ? "bg-control-raised text-foreground shadow-control-raised"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {view}
        </button>
      ))}
    </div>
  );
}

function ScrollBox({ label, className }: { label: string; className?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div
        className={cn("h-40 overflow-y-auto rounded-lg border border-hairline bg-card", className)}
      >
        {Array.from({ length: 24 }, (_, i) => `Row ${i + 1}`).map((row) => (
          <div key={row} className="flex h-[var(--row-h)] items-center px-3 text-base">
            {row}
          </div>
        ))}
      </div>
    </div>
  );
}

function StateLadder() {
  return (
    <div className="flex flex-col gap-8 bg-background p-6 text-foreground">
      <div className="grid grid-cols-5 gap-3">
        {SURFACES.map((surface) => (
          <Panel
            key={surface.name}
            title={surface.name}
            note={surface.note}
            className={surface.className}
          >
            {STATES.map((state) => (
              <Row key={state.name} label={state.name} className={state.className} />
            ))}
          </Panel>
        ))}
        <Panel title="Before" note="legacy, on card" className="bg-card">
          {LEGACY_STATES.map((state) => (
            <Row key={state.name} label={state.name} className={state.className} />
          ))}
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <Panel title="Live rows" note="hover, press, click" className="bg-card">
          <InteractiveRows />
        </Panel>
        <Panel title="Raised plate" note="segmented control in DS-2" className="bg-card">
          <div className="px-2 py-1">
            <RaisedPlate />
          </div>
        </Panel>
        <Panel title="Hairline vs border" note="divider and card edge" className="bg-card">
          <div className="flex flex-col gap-3 px-2 py-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-hairline" />
              <span>hairline</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border" />
              <span>border</span>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <ScrollBox label="Default: thin token scrollbar, no class" />
        <ScrollBox label=".pane-scroll: gutter reserved" className="pane-scroll" />
        <ScrollBox label=".no-scrollbar: opt-out" className="no-scrollbar" />
      </div>
    </div>
  );
}

const meta: Meta<typeof StateLadder> = {
  title: "Foundations/StateLadder",
  component: StateLadder,
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
