// Shared label-color palette for workspace tags (cross-module: Tasks, Notes,
// Contacts, and the hue of a calendar or mail account). The eight hue names map
// 1:1 to the [data-label="…"] tokens in src/styles/tokens.css (§13b); a tag
// stores its hue as one of these names (not a hex), so color stays token-routed
// and theme-safe.
//
// The palette and the auto-pick rule live once in the contracts vocabulary, so
// the MCP connector colours a tag it makes exactly as the app does (MOD-93).
// This module re-exports them for the app's existing import paths.

export {
  DEFAULT_LABEL_COLOR,
  isLabelColor,
  LABEL_COLORS,
  type LabelColor,
  normalizeLabelColor,
  pickTagColor,
} from "@contracts/vocabularies";
