// A calendar's color: the eight named hues first (they follow the theme), then
// a custom color from a hue slider, five shades of it, or a typed HEX, RGB or
// HSL value. Typed values commit on Enter or blur; the slider on release.

import { Check } from "lucide-react";
import { useId, useState } from "react";

import { LABEL_COLORS } from "../../../components/tag-colors";
import { Input } from "../../../components/ui/input";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { cn } from "../../../lib/utils";
import {
  hexToHsl,
  hexToRgb,
  hslToHex,
  hueAttrs,
  isHexColor,
  normalizeHue,
  parseColor,
  shadesOf,
} from "../hue";

type Format = "hex" | "rgb" | "hsl";

const FORMATS = [
  { value: "hex", label: "HEX" },
  { value: "rgb", label: "RGB" },
  { value: "hsl", label: "HSL" },
];

function formatted(hex: string, format: Format): string {
  if (format === "rgb") return hexToRgb(hex).join(", ");
  if (format === "hsl") {
    const [h, s, l] = hexToHsl(hex);
    return `${h}, ${s}%, ${l}%`;
  }
  return hex.toUpperCase();
}

function parseIn(text: string, format: Format): `#${string}` | null {
  if (format === "hsl" && !/^hsl\(/i.test(text.trim())) return parseColor(`hsl(${text})`);
  return parseColor(text);
}

export function CalendarColorPicker({
  value,
  name,
  onPick,
}: {
  /** The current hue: a label name or a custom hex. */
  value: string;
  /** The calendar's name, for labels. */
  name: string;
  onPick: (hue: string) => void;
}) {
  const current = normalizeHue(value);
  const custom = isHexColor(current) ? current : null;
  const [format, setFormat] = useState<Format>("hex");
  const [draft, setDraft] = useState<string | null>(null);
  // The slider previews without saving until it's released.
  const [sliding, setSliding] = useState<`#${string}` | null>(null);
  const shown = sliding ?? custom;
  const [hue, sat] = shown ? hexToHsl(shown) : [265, 80];
  const fieldId = useId();
  const invalid = draft !== null && draft.trim() !== "" && !parseIn(draft, format);

  const releaseSlider = () => {
    if (!sliding) return;
    onPick(sliding);
    setSliding(null);
  };

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = parseIn(draft, format);
    setDraft(null);
    if (parsed) onPick(parsed);
  };

  return (
    <div className="flex w-60 flex-col gap-3">
      <div className="grid grid-cols-8 gap-1.5">
        {LABEL_COLORS.map((label) => (
          <button
            key={label}
            type="button"
            data-label={label}
            aria-label={label}
            aria-pressed={current === label}
            onClick={() => onPick(label)}
            className="cal-swatch grid size-6 place-items-center rounded-sm transition-transform duration-(--motion-fade) ease-(--ease-out) hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {current === label ? <Check aria-hidden className="size-3.5 text-background" /> : null}
          </button>
        ))}
      </div>

      <div className="h-px bg-border" />

      <div className="flex flex-col gap-2">
        <label htmlFor={`${fieldId}-hue`} className="text-xs text-muted-foreground">
          Custom
        </label>
        <input
          id={`${fieldId}-hue`}
          type="range"
          min={0}
          max={359}
          value={hue}
          aria-label={`${name} custom hue`}
          className="hue-slider"
          onChange={(e) => setSliding(hslToHex(Number(e.target.value), Math.max(sat, 55), 60))}
          onPointerUp={() => releaseSlider()}
          onKeyUp={() => releaseSlider()}
        />
        <div className="grid grid-cols-5 gap-1.5">
          {shadesOf(hue, sat).map((shade, i) => (
            <button
              key={shade}
              type="button"
              {...hueAttrs(shade)}
              aria-label={`Shade ${i + 1}, ${shade}`}
              aria-pressed={shown === shade}
              onClick={() => onPick(shade)}
              className={cn(
                "cal-swatch h-6 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                shown === shade && "ring-2 ring-foreground",
              )}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <SegmentedControl
            size="xs"
            aria-label="Color format"
            value={format}
            onValueChange={(next) => {
              setFormat(next as Format);
              setDraft(null);
            }}
            items={FORMATS}
          />
          <span
            aria-hidden
            {...hueAttrs(shown ?? current)}
            className="cal-swatch ml-auto size-5 shrink-0 rounded-sm"
          />
        </div>
        <Input
          size="sm"
          aria-label={`${name} color as ${format.toUpperCase()}`}
          aria-invalid={invalid || undefined}
          spellCheck={false}
          className="font-mono"
          placeholder={
            format === "hex" ? "#4F8EF7" : format === "rgb" ? "79, 142, 247" : "220, 90%, 64%"
          }
          value={draft ?? (shown ? formatted(shown, format) : "")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            }
            if (e.key === "Escape" && draft !== null) {
              e.stopPropagation();
              setDraft(null);
            }
          }}
        />
        {invalid ? (
          <p className="text-xs text-warning">
            Type a color like #4F8EF7, 79, 142, 247 or 220, 90%, 64%
          </p>
        ) : null}
      </div>
    </div>
  );
}
