// The stage: you in the middle (seen from above), every sound a dot around you.
// Drag a dot to move the sound: around you changes where it comes from, in and
// out changes how near it is (nearer is louder, brighter and drier). Click a dot
// to tune it in a card beside it. Keys work on a focused dot: arrows move it,
// + and − change its volume, Delete removes it, Escape closes its card.

import { Headphones, Move } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { Eyebrow } from "@/components/ui/eyebrow";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import { binauralBeat, pointSound, type PointSoundId } from "../catalog";
import {
  type BinauralLayer,
  directionName,
  distanceT,
  distanceWord,
  formatMeters,
  fromStageXY,
  metersFor,
  R_MIN,
  type Scene,
  toStageXY,
  type Voice,
} from "../model";
import { HeadFigure } from "./head-figure";
import { NOISE_SWATCH, SOUND_ICONS } from "./sound-icons";

export type Selection = PointSoundId | "binaural" | null;
export type StageSize = "S" | "M" | "L";

const NODE_PX: Record<StageSize, number> = { S: 32, M: 36, L: 44 };
const RINGS = [0.5, 0.75, 1];

/** Where things sit on the stage, in px: its centre, the outer ring, a dot's size. */
interface Geo {
  cx: number;
  cy: number;
  R: number;
  node: number;
  w: number;
  h: number;
}

export interface StageProps {
  scene: Scene;
  size: StageSize;
  playing: boolean;
  solo: PointSoundId | null;
  selected: Selection;
  onSelect: (s: Selection) => void;
  /** Live while dragging or nudging; `done` marks the end of a gesture. */
  onMove: (id: PointSoundId, angle: number, radius: number, done: boolean) => void;
  onVolumeStep: (id: PointSoundId, delta: number) => void;
  onRemove: (id: PointSoundId) => void;
  /** The tuning card for the selected sound. */
  card: ReactNode;
  /** Show the "drag a sound" hint (until the first move). */
  coach: boolean;
  className?: string;
}

export function Stage(props: StageProps) {
  const { scene, size, selected, onSelect, className } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const box = useBoxSize(boxRef);
  const node = NODE_PX[size];
  const geo: Geo = {
    cx: box.w / 2,
    cy: box.h / 2,
    R: Math.max(0, Math.min(box.w, box.h) / 2 - node / 2 - 6),
    node,
    w: box.w,
    h: box.h,
  };
  const drag = useNodeDrag(boxRef, geo, props);

  return (
    <div
      ref={boxRef}
      data-no-drag
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
      className={cn(
        "soundspace-stage relative touch-none overflow-hidden rounded-lg ring-1 ring-hairline ring-inset",
        className,
      )}
    >
      {geo.R > 20 ? (
        <>
          <Backdrop geo={geo} showLabels={size !== "S"} />
          {scene.binaural ? (
            <BinauralHalo layer={scene.binaural} geo={geo} quiet={!props.playing || !!props.solo} />
          ) : null}
          <HeadFigure
            className={cn("pointer-events-none absolute", isEmptyScene(scene) && "opacity-70")}
            style={{
              left: geo.cx - geo.R * 0.67,
              top: geo.cy - geo.R * 0.67,
              width: geo.R * 1.34,
              height: geo.R * 1.34,
            }}
          />
          {scene.binaural ? (
            <HeadButton
              layer={scene.binaural}
              geo={geo}
              onClick={() => onSelect(selected === "binaural" ? null : "binaural")}
            />
          ) : null}
          {drag.dragged ? <DragGuide voice={drag.dragged} geo={geo} /> : null}
          {scene.voices.map((v) => (
            <VoiceDot
              key={v.id}
              voice={v}
              geo={geo}
              size={size}
              selected={selected === v.id}
              dragging={drag.dragging === v.id}
              muted={!!props.solo && props.solo !== v.id}
              playing={props.playing}
              handlers={drag.handlersFor(v)}
            />
          ))}
          <SelectionCard
            anchor={anchorFor(selected, scene, geo)}
            open={!drag.dragging}
            geo={geo}
            onClose={() => onSelect(null)}
          >
            {props.card}
          </SelectionCard>
          <StageHints
            scene={scene}
            size={size}
            coach={props.coach && !drag.dragging && !selected}
            showHeadphones={!!scene.binaural && size !== "S" && !selected}
          />
        </>
      ) : null}
    </div>
  );
}

function isEmptyScene(scene: Scene) {
  return scene.voices.length === 0 && !scene.binaural;
}

function useBoxSize(ref: RefObject<HTMLDivElement | null>) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return box;
}

type KeyAction =
  | { kind: "move"; angle: number; radius: number }
  | { kind: "volume"; delta: number }
  | { kind: "remove" }
  | { kind: "close" };

/** What a key does to a focused dot (Shift moves three times as far). */
function keyAction(key: string, shift: boolean, v: Voice): KeyAction | null {
  const step = shift ? 3 : 1;
  switch (key) {
    case "ArrowLeft":
      return { kind: "move", angle: v.angle - 10 * step, radius: v.radius };
    case "ArrowRight":
      return { kind: "move", angle: v.angle + 10 * step, radius: v.radius };
    case "ArrowUp":
      return { kind: "move", angle: v.angle, radius: v.radius - 0.05 * step };
    case "ArrowDown":
      return { kind: "move", angle: v.angle, radius: v.radius + 0.05 * step };
    case "+":
    case "=":
      return { kind: "volume", delta: 0.05 };
    case "-":
      return { kind: "volume", delta: -0.05 };
    case "Delete":
    case "Backspace":
      return { kind: "remove" };
    case "Escape":
      return { kind: "close" };
    default:
      return null;
  }
}

interface DotHandlers {
  onPointerDown: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * Press, drag and release on a dot. A press that moves under 3 px is a click
 * (opens or closes the card); past that it drags. The drag ends on pointerup,
 * pointercancel, or a move that arrives with no button held.
 */
function useNodeDrag(boxRef: RefObject<HTMLDivElement | null>, geo: Geo, props: StageProps) {
  const { scene, selected, onSelect, onMove, onVolumeStep, onRemove } = props;
  const [dragging, setDragging] = useState<PointSoundId | null>(null);
  const press = useRef<{ id: PointSoundId; x: number; y: number; moved: boolean } | null>(null);

  const pointFromEvent = (e: PointerEvent) => {
    const rect = boxRef.current!.getBoundingClientRect();
    return fromStageXY(e.clientX - rect.left - geo.cx, e.clientY - rect.top - geo.cy, geo.R);
  };

  const release = (id: PointSoundId, e: PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p || p.id !== id) return;
    if (!p.moved) {
      onSelect(selected === id ? null : id);
      return;
    }
    const at = pointFromEvent(e);
    setDragging(null);
    onMove(id, at.angle, at.radius, true);
  };

  const handlersFor = (v: Voice): DotHandlers => ({
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      press.current = { id: v.id, x: e.clientX, y: e.clientY, moved: false };
    },
    onPointerMove: (e) => {
      const p = press.current;
      if (!p || p.id !== v.id) return;
      if (e.buttons === 0) return release(v.id, e);
      if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 3) return;
      if (!p.moved) {
        p.moved = true;
        setDragging(v.id);
        onSelect(null);
      }
      const at = pointFromEvent(e);
      onMove(v.id, at.angle, at.radius, false);
    },
    onPointerUp: (e) => release(v.id, e),
    onPointerCancel: () => {
      press.current = null;
      setDragging(null);
    },
    onKeyDown: (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const action = keyAction(e.key, e.shiftKey, v);
      if (!action || (action.kind === "close" && selected !== v.id)) return;
      e.preventDefault();
      if (action.kind === "move") onMove(v.id, action.angle, action.radius, true);
      else if (action.kind === "volume") onVolumeStep(v.id, action.delta);
      else if (action.kind === "remove") onRemove(v.id);
      else onSelect(null);
    },
  });

  const dragged = dragging ? scene.voices.find((v) => v.id === dragging) : undefined;
  return { dragging, dragged, handlersFor };
}

/** The crosshair, the distance rings (with their distances) and "Front". */
function Backdrop({ geo, showLabels }: { geo: Geo; showLabels: boolean }) {
  const { cx, cy, R } = geo;
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 h-px bg-hairline"
        style={{ top: cy }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-px bg-hairline"
        style={{ left: cx }}
      />
      {RINGS.map((r) => (
        <div key={r} aria-hidden>
          <div
            className="pointer-events-none absolute rounded-full border border-dashed border-foreground/10"
            style={{ left: cx - r * R, top: cy - r * R, width: 2 * r * R, height: 2 * r * R }}
          />
          {showLabels ? (
            <span
              className="pointer-events-none absolute text-2xs tabular-nums text-subtle-foreground"
              // Down the right diagonal, clear of the crosshair and of each other.
              style={{ left: cx + r * R * 0.71 + 3, top: cy + r * R * 0.71 - 4 }}
            >
              {formatMeters(metersFor(r))}
            </span>
          ) : null}
        </div>
      ))}
      <Eyebrow
        aria-hidden
        className="pointer-events-none absolute top-2 -translate-x-1/2 text-subtle-foreground"
        style={{ left: cx }}
      >
        Front
      </Eyebrow>
    </>
  );
}

/** Binaural beats sit inside your head: a pulse round it at the beat's pace, not a dot. */
function BinauralHalo({ layer, geo, quiet }: { layer: BinauralLayer; geo: Geo; quiet: boolean }) {
  const d = geo.R * 0.62;
  const still = quiet || !layer.on;
  const beat = `${(2.6 - Math.log2(binauralBeat(layer.id).beatHz) * 0.32).toFixed(2)}s`;
  return (
    <>
      {[false, true].map((late) => (
        <div
          key={String(late)}
          aria-hidden
          className={cn(
            "pointer-events-none absolute rounded-full border border-foreground/30",
            still ? "opacity-20" : cn("soundspace-halo", late && "soundspace-halo--late"),
          )}
          style={
            {
              left: geo.cx - d / 2,
              top: geo.cy - d / 2 - geo.R * 0.03,
              width: d,
              height: d,
              "--ss-beat": beat,
            } as CSSProperties
          }
        />
      ))}
    </>
  );
}

function HeadButton({
  layer,
  geo,
  onClick,
}: {
  layer: BinauralLayer;
  geo: Geo;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${binauralBeat(layer.id).name}, inside your head. Open its card`}
      onClick={onClick}
      className="absolute rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{
        left: geo.cx - geo.R * 0.17,
        top: geo.cy - geo.R * 0.2,
        width: geo.R * 0.34,
        height: geo.R * 0.36,
      }}
    />
  );
}

function VoiceDot({
  voice: v,
  geo,
  size,
  selected,
  dragging,
  muted,
  playing,
  handlers,
}: {
  voice: Voice;
  geo: Geo;
  size: StageSize;
  selected: boolean;
  dragging: boolean;
  muted: boolean;
  playing: boolean;
  handlers: DotHandlers;
}) {
  const p = toStageXY(v.angle, v.radius, geo.R);
  const k = distanceT(v.radius);
  const name = pointSound(v.id).name;
  return (
    <div
      className={cn(
        "soundspace-pop absolute",
        selected || dragging ? "z-20" : "z-10",
        muted && "opacity-30",
      )}
      style={
        {
          left: geo.cx + p.x - geo.node / 2,
          top: geo.cy + p.y - geo.node / 2,
          width: geo.node,
          height: geo.node,
          "--ss-amp": (v.volume * (1.15 - k * 0.6)).toFixed(2),
        } as CSSProperties
      }
    >
      <div
        className={cn(
          "group/node relative size-full",
          v.wander && v.on && !dragging && "soundspace-wander",
        )}
      >
        {playing && v.on && !muted ? <Ripples /> : null}
        <button
          type="button"
          data-soundspace-node
          aria-label={`${name}, ${directionName(v.angle)}, ${formatMeters(metersFor(v.radius))}, volume ${Math.round(v.volume * 100)}%`}
          aria-expanded={selected}
          {...handlers}
          className={cn(
            "absolute inset-1 grid cursor-grab place-items-center rounded-full bg-popover text-foreground shadow-md ring-1 ring-hairline outline-none",
            "transition-[transform,filter] duration-(--motion-base) ease-(--ease-spring) hover:brightness-125",
            "focus-visible:ring-2 focus-visible:ring-ring/50",
            selected && "ring-foreground",
            dragging && "scale-110 cursor-grabbing brightness-125",
            !v.on && "text-subtle-foreground",
          )}
          // Farther sounds draw a little smaller and dimmer.
          style={{
            scale: dragging ? undefined : String(1.06 - k * 0.2),
            opacity: v.on ? 1 - k * 0.3 : 0.55,
          }}
        >
          <DotIcon id={v.id} large={size === "L"} />
        </button>
        <LevelArc volume={v.volume} on={v.on} />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute top-full left-1/2 mt-0.5 -translate-x-1/2 whitespace-nowrap text-2xs text-muted-foreground opacity-0 transition-opacity duration-(--motion-fade)",
            !dragging && "group-hover/node:opacity-100",
            selected && "opacity-100",
          )}
        >
          {name}
        </span>
      </div>
    </div>
  );
}

function Ripples() {
  return (
    <>
      <span
        aria-hidden
        className="soundspace-ripple pointer-events-none absolute inset-1 rounded-full border border-foreground"
      />
      <span
        aria-hidden
        className="soundspace-ripple soundspace-ripple--late pointer-events-none absolute inset-1 rounded-full border border-foreground"
      />
    </>
  );
}

function DotIcon({ id, large }: { id: PointSoundId; large: boolean }) {
  const Icon = SOUND_ICONS[id];
  const swatch = NOISE_SWATCH[id];
  return (
    <>
      <Icon aria-hidden className={large ? "size-icon" : "size-icon-sm"} />
      {swatch ? (
        <span
          aria-hidden
          className={cn(
            "absolute right-0 bottom-0 size-2 rounded-full ring-2 ring-popover",
            swatch,
          )}
        />
      ) : null}
    </>
  );
}

/** The level, as an arc round the dot (starting at the top). */
function LevelArc({ volume, on }: { volume: number; on: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 44 44"
      className="pointer-events-none absolute inset-0 size-full overflow-visible"
    >
      <circle
        cx="22"
        cy="22"
        r="20.5"
        pathLength={100}
        transform="rotate(-90 22 22)"
        className={cn(
          "fill-none stroke-foreground [stroke-width:1.5px]",
          on ? "opacity-80" : "opacity-30",
        )}
        strokeDasharray={`${Math.round(volume * 100)} 100`}
        strokeLinecap="round"
      />
    </svg>
  );
}

type Anchor = { x: number; y: number; r: number } | null;

function anchorFor(selected: Selection, scene: Scene, geo: Geo): Anchor {
  if (selected === "binaural") return { x: geo.cx, y: geo.cy, r: geo.R * 0.32 };
  const v = selected ? scene.voices.find((x) => x.id === selected) : undefined;
  if (!v) return null;
  const p = toStageXY(v.angle, v.radius, geo.R);
  return { x: geo.cx + p.x, y: geo.cy + p.y, r: geo.node / 2 };
}

/** The card hangs off the selected dot (or the head, for binaural). */
function SelectionCard({
  anchor,
  open,
  geo,
  onClose,
  children,
}: {
  anchor: Anchor;
  open: boolean;
  geo: Geo;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Popover open={!!anchor && open} onOpenChange={(next) => (next ? null : onClose())}>
      {anchor ? (
        <PopoverAnchor asChild>
          <span
            aria-hidden
            className="pointer-events-none absolute"
            style={{
              left: anchor.x - anchor.r,
              top: anchor.y - anchor.r,
              width: anchor.r * 2,
              height: anchor.r * 2,
            }}
          />
        </PopoverAnchor>
      ) : null}
      <PopoverContent
        side={anchor && anchor.x < geo.cx ? "right" : "left"}
        align="center"
        sideOffset={10}
        collisionPadding={12}
        className="w-60 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => {
          // A press on a dot toggles the card itself; let it.
          if ((e.target as Element | null)?.closest?.("[data-soundspace-node]")) e.preventDefault();
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

function StageHints({
  scene,
  size,
  coach,
  showHeadphones,
}: {
  scene: Scene;
  size: StageSize;
  coach: boolean;
  showHeadphones: boolean;
}) {
  const small = size === "S";
  return (
    <>
      {isEmptyScene(scene) ? (
        <span className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-state-hover px-3 py-1 text-xs text-muted-foreground motion-view">
          {small ? "Add a sound to begin" : "Sounds you add appear around you"}
        </span>
      ) : coach ? (
        // Quiet corner text, never a pill over the dots it's about.
        <span className="pointer-events-none absolute bottom-2 left-2.5 flex items-center gap-1.5 whitespace-nowrap text-2xs text-muted-foreground motion-view">
          <Move aria-hidden className="size-icon-xs" />
          {small ? "Drag to place" : "Drag a sound · nearer is louder"}
        </span>
      ) : null}
      {showHeadphones ? (
        <span className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 text-2xs text-subtle-foreground">
          <Headphones aria-hidden className="size-icon-xs" />
          Headphones on
        </span>
      ) : null}
    </>
  );
}

function DragGuide({ voice, geo }: { voice: Voice; geo: Geo }) {
  const { cx, cy, R } = geo;
  const p = toStageXY(voice.angle, voice.radius, R);
  const r = Math.max(R_MIN, voice.radius) * R;
  return (
    <>
      <svg
        aria-hidden
        viewBox={`0 0 ${geo.w} ${geo.h}`}
        className="pointer-events-none absolute inset-0 size-full"
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          className="fill-foreground/[0.03] stroke-foreground/20 [stroke-dasharray:2_5]"
        />
        <line
          x1={cx}
          y1={cy}
          x2={cx + p.x}
          y2={cy + p.y}
          className="stroke-foreground/35 [stroke-dasharray:3_4]"
        />
      </svg>
      <span
        className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-full bg-foreground px-2.5 py-1 text-2xs font-medium tabular-nums text-background shadow-md"
        style={{ left: cx + p.x, top: cy + p.y - geo.node / 2 - 8 }}
      >
        {directionName(voice.angle)} · {distanceWord(voice.radius)} ·{" "}
        {formatMeters(metersFor(voice.radius))}
      </span>
    </>
  );
}
