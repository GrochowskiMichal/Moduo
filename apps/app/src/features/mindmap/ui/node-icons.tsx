import type { LucideIcon } from "lucide-react";
import {
  Circle,
  Flag,
  Palette,
  SlidersHorizontal,
  Smile,
  Square,
  Star,
  Tag,
  Target,
  Triangle,
  Type,
  Zap,
} from "lucide-react";

type NodeIconOption = {
  key: string;
  label: string;
  Icon: LucideIcon;
};

export const NODE_ICON_OPTIONS: NodeIconOption[] = [
  { key: "circle", label: "Circle", Icon: Circle },
  { key: "square", label: "Square", Icon: Square },
  { key: "triangle", label: "Triangle", Icon: Triangle },
  { key: "star", label: "Star", Icon: Star },
  { key: "flag", label: "Flag", Icon: Flag },
  { key: "tag", label: "Tag", Icon: Tag },
  { key: "palette", label: "Palette", Icon: Palette },
  { key: "smile", label: "Smile", Icon: Smile },
  { key: "type", label: "Type", Icon: Type },
  { key: "target", label: "Target", Icon: Target },
  { key: "zap", label: "Zap", Icon: Zap },
  { key: "sliders", label: "Sliders", Icon: SlidersHorizontal },
];

const NODE_ICON_MAP = new Map(NODE_ICON_OPTIONS.map((option) => [option.key, option.Icon]));

const LEGACY_EMOJI_MAP: Record<string, string> = {
  "💡": "circle",
  "✅": "square",
  "📂": "triangle",
  "📝": "type",
  "❓": "target",
  "🔗": "tag",
  "⚖️": "sliders",
  "🎯": "target",
  "🧠": "zap",
  "⚡": "zap",
  "🔥": "star",
  "🌟": "star",
  "🎨": "palette",
  "🔍": "target",
  "📊": "sliders",
  "🚀": "zap",
  "💎": "star",
  "🏆": "flag",
  "⚙️": "sliders",
  "📌": "tag",
  "🎵": "smile",
  "📸": "circle",
  "🗓️": "square",
  "👥": "smile",
};

export function resolveNodeIcon(key: string | undefined): LucideIcon {
  return NODE_ICON_MAP.get(key ?? "") ?? Circle;
}

export function normalizeNodeIcon(rawIcon: unknown, rawEmoji: unknown): string {
  if (typeof rawIcon === "string" && NODE_ICON_MAP.has(rawIcon)) return rawIcon;
  if (typeof rawEmoji === "string") return LEGACY_EMOJI_MAP[rawEmoji] ?? "";
  return "";
}
