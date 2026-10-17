// The motion foundations (tasks-v3 call 81, SH-1; DESIGN_RULES R6): the four
// shared patterns in global.css, each with a replay. Switch "Motion" to Reduced
// to see every pattern fall back to opacity alone, the same as the OS setting
// or Settings → Preferences. tests/visual/motion.spec.ts reads these stories.
import type { Meta, StoryObj } from "@storybook/react";
import { FileText, Info, ListTree, Plus, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";

type MotionSetting = "system" | "reduced" | "full";

/** Pins `data-motion` on <html> while the story is open, like Settings does. */
function useMotionSetting(setting: MotionSetting) {
  useEffect(() => {
    const root = document.documentElement;
    if (setting === "system") root.removeAttribute("data-motion");
    else root.setAttribute("data-motion", setting);
    return () => root.removeAttribute("data-motion");
  }, [setting]);
}

function Section({
  title,
  note,
  onReplay,
  children,
}: {
  title: string;
  note: string;
  onReplay?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="font-display text-base font-medium text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{note}</p>
        </div>
        {onReplay ? (
          <Button variant="ghost" size="sm" onClick={onReplay}>
            <RotateCcw aria-hidden />
            Replay
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function PanelPattern() {
  const [run, setRun] = useState(0);
  return (
    <Section
      title="1 · Panel"
      note="Slides in from the side and fades, on the slow duration."
      onReplay={() => setRun((n) => n + 1)}
    >
      <div className="flex h-32 gap-2 overflow-hidden rounded-md bg-background p-2">
        <div
          key={`l${run}`}
          data-side="left"
          data-testid="motion-panel-left"
          className="motion-panel w-24 rounded-md border border-border bg-card"
        />
        <div className="flex-1 rounded-md border border-border bg-card" />
        <div
          key={`r${run}`}
          data-testid="motion-panel"
          className="motion-panel w-32 rounded-md border border-border bg-card"
        />
      </div>
    </Section>
  );
}

function PopoverPattern() {
  return (
    <Section
      title="2 · Popover"
      note="Menus, popovers, selects and dialogs grow from where they were opened."
    >
      <div className="flex gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              Open a menu
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" data-testid="motion-pop">
            <DropdownMenuItem>
              <Info aria-hidden />
              Details
            </DropdownMenuItem>
            <DropdownMenuItem>
              <FileText aria-hidden />
              Notes
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              Open a popover
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="text-sm text-muted-foreground">
            It grows from its trigger's corner.
          </PopoverContent>
        </Popover>
      </div>
    </Section>
  );
}

function RowPattern() {
  const [rows, setRows] = useState<Array<{ id: number; leaving: boolean }>>([
    { id: 1, leaving: false },
    { id: 2, leaving: false },
  ]);
  const [next, setNext] = useState(3);
  return (
    <Section
      title="3 · Row"
      note="A row opens its height and fades in when added, and closes when removed."
    >
      <div className="flex flex-col">
        {rows.map((row) => (
          <div
            key={row.id}
            data-testid="motion-row"
            data-leaving={row.leaving ? "" : undefined}
            className="motion-row"
            onAnimationEnd={(event) => {
              // Remove on the fade's end: the height half can finish first.
              if (row.leaving && event.animationName === "motion-fade-out") {
                setRows((all) => all.filter((r) => r.id !== row.id));
              }
            }}
          >
            <div>
              <div className="flex h-[var(--row-h)] items-center gap-2 px-2 text-base text-foreground">
                <span className="flex-1">Row {row.id}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setRows((all) =>
                      all.map((r) => (r.id === row.id ? { ...r, leaving: true } : r)),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setRows((all) => [...all, { id: next, leaving: false }]);
            setNext((n) => n + 1);
          }}
        >
          <Plus aria-hidden />
          Add a row
        </Button>
      </div>
    </Section>
  );
}

const VIEWS = [
  { value: "details", label: "Details", icon: Info, text: "The selected item's properties." },
  { value: "outline", label: "Outline", icon: ListTree, text: "The document's headings." },
] as const;

function ViewPattern() {
  const [view, setView] = useState<(typeof VIEWS)[number]["value"]>("details");
  const active = VIEWS.find((v) => v.value === view) ?? VIEWS[0];
  return (
    <Section title="4 · View" note="Switching views crossfades, on the slow duration.">
      <SegmentedControl
        size="sm"
        aria-label="View"
        value={view}
        onValueChange={(v) => setView(v as typeof view)}
        items={VIEWS.map((v) => ({ value: v.value, label: v.label }))}
      />
      <div
        key={active.value}
        data-testid="motion-view"
        className="motion-view flex h-20 items-center gap-2 rounded-md bg-background px-3 text-sm text-muted-foreground"
      >
        <active.icon className="size-icon-sm" aria-hidden />
        {active.text}
      </div>
    </Section>
  );
}

function MotionFoundations({ motion }: { motion: MotionSetting }) {
  const [setting, setSetting] = useState<MotionSetting>(motion);
  useMotionSetting(setting);
  return (
    <div className="flex max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="font-display text-sm text-muted-foreground">Motion</span>
        <SegmentedControl
          size="sm"
          aria-label="Motion"
          value={setting}
          onValueChange={(v) => setSetting(v as MotionSetting)}
          items={[
            { value: "system", label: "System" },
            { value: "reduced", label: "Reduced" },
            { value: "full", label: "Full" },
          ]}
        />
      </div>
      <PanelPattern />
      <PopoverPattern />
      <RowPattern />
      <ViewPattern />
    </div>
  );
}

const meta: Meta<typeof MotionFoundations> = {
  title: "Foundations/Motion",
  component: MotionFoundations,
  args: { motion: "system" },
};
export default meta;

type Story = StoryObj<typeof MotionFoundations>;

/** Follows the OS setting, like the app with Motion → System. */
export const Default: Story = {};

/** Settings → Preferences → Motion → Reduced: every pattern is a plain fade. */
export const Reduced: Story = { args: { motion: "reduced" } };
