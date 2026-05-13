import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { type BodyFont, type DisplayFont } from "../../../lib/appearance";

import { AppearancePickerRow } from "./picker-row";

type FontRole = "display" | "body";

type Option<V extends string> = {
  value: V;
  label: string;
  fontVar: string;
  sample: string;
};

const DISPLAY_OPTIONS: ReadonlyArray<Option<DisplayFont>> = [
  { value: "pilat", label: "Pilat Extended", fontVar: "var(--font-display-pilat)", sample: "Aa" },
  { value: "geist", label: "Geist", fontVar: "var(--font-display-geist)", sample: "Aa" },
  { value: "cal", label: "Cal Sans", fontVar: "var(--font-display-cal)", sample: "Aa" },
  {
    value: "fraunces",
    label: "Fraunces",
    fontVar: "var(--font-display-fraunces)",
    sample: "Aa",
  },
];

const BODY_OPTIONS: ReadonlyArray<Option<BodyFont>> = [
  { value: "geist", label: "Geist", fontVar: "var(--font-body-geist)", sample: "Aa" },
  { value: "inter", label: "Inter", fontVar: "var(--font-body-inter)", sample: "Aa" },
  { value: "serif", label: "Source Serif Pro", fontVar: "var(--font-body-serif)", sample: "Aa" },
  { value: "mono", label: "Geist Mono", fontVar: "var(--font-body-mono)", sample: "Aa" },
];

const ROLE_LABEL: Record<FontRole, string> = {
  display: "Display font",
  body: "Body font",
};

const ROLE_DESCRIPTION: Record<FontRole, string> = {
  display: "Used for page titles, section headers, and the wordmark.",
  body: "Used for note bodies, paragraphs, and most UI text.",
};

const PREVIEW_LINE: Record<FontRole, string> = {
  display: "The quick brown fox jumps over the lazy dog.",
  body: "The quick brown fox jumps over the lazy dog.",
};

type Props =
  | {
      role: "display";
      value: DisplayFont;
      onChange: (value: DisplayFont) => void;
    }
  | {
      role: "body";
      value: BodyFont;
      onChange: (value: BodyFont) => void;
    };

export function FontPicker(props: Props) {
  const { role } = props;
  const options = role === "display" ? DISPLAY_OPTIONS : BODY_OPTIONS;
  const triggerId = `font-${role}-trigger`;
  const activeOption = options.find((o) => o.value === props.value) ?? options[0];

  return (
    <AppearancePickerRow
      title={ROLE_LABEL[role]}
      description={ROLE_DESCRIPTION[role]}
      htmlFor={triggerId}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <Select
          value={props.value}
          onValueChange={(next) => {
            if (role === "display") props.onChange(next as DisplayFont);
            else props.onChange(next as BodyFont);
          }}
        >
          <SelectTrigger id={triggerId} className="w-full sm:w-64">
            <SelectValue placeholder={activeOption.label} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                <span style={{ fontFamily: option.fontVar }}>{option.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p
          aria-hidden
          className={
            role === "display"
              ? "min-h-9 flex-1 truncate text-xl text-foreground"
              : "min-h-9 flex-1 truncate text-base text-foreground"
          }
          style={{ fontFamily: activeOption.fontVar }}
        >
          {PREVIEW_LINE[role]}
        </p>
      </div>
    </AppearancePickerRow>
  );
}
