import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

const DEFAULT_GOAL_ML = 2000;
const QUICK_ADD_L = [0.1, 0.25, 0.5, 1];

function dayKeyLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function clampGoal(value: number | undefined): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return DEFAULT_GOAL_ML;
  return Math.min(6000, Math.max(500, Math.round(next)));
}

function parseLitersInput(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

type Props = {
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function HydrationWidget({ config, isLocked, onUpdateConfig }: Props) {
  const today = dayKeyLocal();
  const goalMl = clampGoal(config.hydrationGoalMl);
  const consumedMl = config.hydrationLastDate === today ? Math.max(0, Math.round(config.hydrationConsumedMl ?? 0)) : 0;
  const remainingMl = Math.max(0, goalMl - consumedMl);
  const progressPct = Math.min(100, Math.round((consumedMl / goalMl) * 100));
  const [goalInput, setGoalInput] = useState(() => String((goalMl / 1000).toFixed(2)).replace(/\.?0+$/, ""));
  const parsedGoalL = parseLitersInput(goalInput);
  const draftGoalMl = parsedGoalL == null ? null : clampGoal(Math.round(parsedGoalL * 1000));
  const isGoalSet = draftGoalMl != null && draftGoalMl === goalMl;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    setGoalInput(String((goalMl / 1000).toFixed(2)).replace(/\.?0+$/, ""));
  }, [goalMl]);

  useEffect(() => {
    if (config.hydrationLastDate === today) return;
    onUpdateConfig({ hydrationLastDate: today, hydrationConsumedMl: 0 });
  }, [config.hydrationLastDate, onUpdateConfig, today]);

  useEffect(() => {
    if (!rootRef.current || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  const addWater = (amountL: number) => {
    const amountMl = Math.round(amountL * 1000);
    onUpdateConfig({
      hydrationLastDate: today,
      hydrationConsumedMl: Math.max(0, consumedMl + amountMl),
    });
  };

  return (
    <WidgetShell config={config} title="Hydration">
      {!isLocked ? (
        <div ref={rootRef} className="flex h-full min-h-0 items-center justify-center px-3 py-3">
          <div className={`flex w-full ${size.width > 340 ? "max-w-[380px] items-center" : "max-w-[320px] flex-col"} justify-center gap-2`}>
            <input
              type="text"
              inputMode="decimal"
              value={goalInput}
              placeholder="Goal in liters (e.g. 3.5 or 3,5)"
              onChange={(event) => setGoalInput(event.target.value)}
              className="min-w-[150px] flex-1 rounded border border-[#2b2b2b] bg-[#141414] px-2 py-1.5 text-[12px] text-[#cfcfcf] outline-none selection:bg-[#24553a] selection:text-[#e7fff2]"
            />
            <button
              type="button"
              disabled={draftGoalMl == null}
              onClick={() => {
                if (draftGoalMl == null) return;
                onUpdateConfig({ hydrationGoalMl: draftGoalMl });
              }}
              className={`rounded border px-3 py-1.5 text-[11px] ${
                draftGoalMl != null
                  ? isGoalSet
                    ? "border-[#24553a] bg-[#163324] text-[#9fe2bc]"
                    : "border-[#2b2b2b] bg-[#141414] text-[#d8d8d8] hover:bg-[#1b1b1b]"
                  : "cursor-not-allowed border-[#232323] bg-[#121212] text-[#666666]"
              }`}
            >
              {isGoalSet ? "Set ✓" : "Set"}
            </button>
          </div>
        </div>
      ) : (
      <div ref={rootRef} className="flex h-full min-h-0 flex-1 flex-col justify-start px-3 py-3">
        <p className="text-[11px] text-[#8f8f8f]">Today</p>
        <p className={`mt-1 font-semibold leading-none text-[#e8f4ff] ${size.width < 260 ? "text-[18px]" : size.width < 360 ? "text-[20px]" : "text-[22px]"}`}>
          {(consumedMl / 1000).toFixed(2).replace(/\.?0+$/, "")} L
        </p>
        <p className="mt-1 text-[11px] text-[#7f7f7f]">
          {remainingMl > 0
            ? `${(remainingMl / 1000).toFixed(2).replace(/\.?0+$/, "")} L remaining`
            : "Daily goal reached"}
        </p>

        <div className="mt-3 h-2 w-full rounded bg-[#1e1e1e]">
          <motion.div
            className="relative h-full overflow-hidden rounded"
            animate={{
              width: `${progressPct}%`,
              backgroundPositionX: ["0%", "100%", "0%"],
              clipPath: [
                "polygon(0% 8%, 10% 14%, 20% 10%, 32% 20%, 45% 12%, 58% 22%, 72% 14%, 84% 20%, 94% 12%, 100% 16%, 100% 100%, 0% 100%)",
                "polygon(0% 18%, 12% 12%, 24% 18%, 36% 10%, 50% 22%, 64% 12%, 76% 20%, 88% 10%, 96% 16%, 100% 12%, 100% 100%, 0% 100%)",
                "polygon(0% 10%, 12% 18%, 26% 12%, 38% 22%, 52% 12%, 66% 20%, 80% 10%, 92% 18%, 98% 12%, 100% 16%, 100% 100%, 0% 100%)",
                "polygon(0% 8%, 10% 14%, 20% 10%, 32% 20%, 45% 12%, 58% 22%, 72% 14%, 84% 20%, 94% 12%, 100% 16%, 100% 100%, 0% 100%)",
              ],
            }}
            transition={{ type: "spring", stiffness: 130, damping: 20, mass: 0.55 }}
            style={{
              background:
                "linear-gradient(100deg, rgba(132,205,255,0.72) 0%, rgba(168,224,255,0.74) 35%, rgba(93,174,255,0.68) 60%, rgba(69,150,240,0.72) 100%)",
              backgroundSize: "180% 100%",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.22), 0 0 8px rgba(96,175,255,0.25)",
            }}
            transition={{
              width: { type: "spring", stiffness: 130, damping: 20, mass: 0.55 },
              backgroundPositionX: { duration: 10.5, ease: "linear", repeat: Infinity },
              clipPath: { duration: 6.2, ease: "easeInOut", repeat: Infinity },
            }}
          />
        </div>
        <p className="mt-1 text-[10px] text-[#656565]">
          {progressPct}% of {(goalMl / 1000).toFixed(2).replace(/\.?0+$/, "")} L
        </p>

          <div
            className="mt-4 grid gap-2"
            style={{ gridTemplateColumns: `repeat(${size.width < 300 ? 2 : 4}, minmax(0, 1fr))` }}
          >
            {QUICK_ADD_L.map((amount) => (
              <button
                key={amount}
                onClick={() => addWater(amount)}
                className={`rounded-md border border-[#2b2b2b] bg-[#151515] px-2.5 ${size.height < 210 ? "py-0.5" : "py-1"} text-[11px] text-[#d3d3d3] hover:bg-[#1a1a1a]`}
              >
                +{amount} L
              </button>
            ))}
          </div>
      </div>
      )}
    </WidgetShell>
  );
}
