import { createTamagui, createTokens } from "@tamagui/core";

const tokens = createTokens({
  color: {
    background: "#f6f7fb",
    panel: "#ffffff",
    text: "#141b2d",
    primary: "#1d4ed8",
    muted: "#64748b",
    border: "#dbe4f0",
  },
  size: { 0: 0, 1: 12, 2: 14, 3: 16, 4: 18, 5: 22, 6: 28 },
  space: { 0: 0, 1: 6, 2: 10, 3: 14, 4: 18, 5: 24, 6: 32 },
  radius: { 0: 0, 1: 6, 2: 10, 3: 14, 4: 20, 5: 999 },
  zIndex: { 0: 0, 1: 1, 2: 2, 3: 3 },
});

export default createTamagui({
  tokens,
  themes: {
    light: {
      background: tokens.color.background,
      color: tokens.color.text,
      panel: tokens.color.panel,
      primary: tokens.color.primary,
      muted: tokens.color.muted,
      borderColor: tokens.color.border,
    },
  },
  defaultTheme: "light",
});
