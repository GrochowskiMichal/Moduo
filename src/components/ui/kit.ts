// The north-star kit (DS-6, tasks-v3 AC14.1; re-plan §5.2). Every module
// builds on these; each one ships a `Densities` story that renders it at the
// three density steps (kit-densities.tsx). `src/components/ui/kit.test.ts`
// fails when a story is missing, and `tests/visual/kit.spec.ts` opens each
// story and reads the density tokens inside it.

type KitEntry = {
  /** The primitive's name in the re-plan's kit table. */
  name: string;
  /** Its file in src/components/ui (without .tsx). */
  file: string;
  /** The stories export that shows it at three densities. */
  story: string;
};

const KIT: readonly KitEntry[] = [
  { name: "Row", file: "row", story: "Densities" },
  { name: "Card", file: "item-card", story: "Densities" },
  { name: "GroupHeader", file: "group-header", story: "Densities" },
  { name: "MetaCount", file: "meta-count", story: "Densities" },
  { name: "PropertyRow / PropertyValue", file: "property-row", story: "Densities" },
  { name: "CollectionHeader", file: "collection-header", story: "Densities" },
  { name: "NavRow", file: "nav-row", story: "Densities" },
  { name: "Toolbar", file: "toolbar", story: "Densities" },
  { name: "FilterBar", file: "filter-bar", story: "Densities" },
  { name: "DisplayMenu", file: "display-menu", story: "Densities" },
  { name: "Chip", file: "chip", story: "Densities" },
  { name: "Picker pill", file: "chip", story: "PickerPillDensities" },
  { name: "EmptyState", file: "empty-state", story: "Densities" },
  { name: "Feed", file: "feed", story: "Densities" },
  { name: "DateField", file: "date-field", story: "Densities" },
  { name: "Progress", file: "progress", story: "Densities" },
  { name: "Avatar", file: "avatar", story: "Densities" },
];

/** Storybook's id for an export: "PickerPillDensities" → "picker-pill-densities". */
function kitStoryId(entry: KitEntry): string {
  const story = entry.story
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  return `components-ui-${entry.file}--${story}`;
}

export type { KitEntry };
export { KIT, kitStoryId };
