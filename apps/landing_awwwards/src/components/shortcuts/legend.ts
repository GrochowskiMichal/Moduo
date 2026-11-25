// How a key is written on each platform, and which physical keys light for it. Shared by the
// page (build time) and its driver (motion/pages/shortcuts.ts), so the legends and the lit keys
// never disagree.
import type { Key } from "../../data/pages/shortcuts";

export type Os = "mac" | "win";

const NAMED: Record<string, { mac: string; win: string; sr?: { mac: string; win: string } }> = {
  Mod: { mac: "⌘", win: "Ctrl", sr: { mac: "Command", win: "Control" } },
  Shift: { mac: "⇧", win: "Shift", sr: { mac: "Shift", win: "Shift" } },
  Alt: { mac: "⌥", win: "Alt", sr: { mac: "Option", win: "Alt" } },
  Ctrl: { mac: "⌃", win: "Ctrl", sr: { mac: "Control", win: "Control" } },
  Escape: { mac: "Esc", win: "Esc" },
  Enter: { mac: "↵", win: "Enter", sr: { mac: "Return", win: "Enter" } },
  Space: { mac: "Space", win: "Space" },
  Backspace: { mac: "⌫", win: "Backspace", sr: { mac: "Delete", win: "Backspace" } },
  Up: { mac: "↑", win: "↑", sr: { mac: "Up arrow", win: "Up arrow" } },
  Down: { mac: "↓", win: "↓", sr: { mac: "Down arrow", win: "Down arrow" } },
  Left: { mac: "←", win: "←", sr: { mac: "Left arrow", win: "Left arrow" } },
  Right: { mac: "→", win: "→", sr: { mac: "Right arrow", win: "Right arrow" } },
  Slash: { mac: "/", win: "/" },
  Comma: { mac: ",", win: "," },
  BracketLeft: { mac: "[", win: "[" },
  Equal: { mac: "=", win: "=" },
  F11: { mac: "F11", win: "F11" },
};

// Shift and one of these reads as the character it types.
const SHIFTED: Record<string, string> = { Slash: "?", Digit3: "#", Equal: "+", Digit2: "@" };

export type Cap = { mac: string; win: string; srMac?: string; srWin?: string };

/** The keycaps a chord is written with: modifiers first, a shifted character as one cap. */
export function caps(chord: readonly Key[]): Cap[] {
  const main = chord.find((k) => !["Mod", "Shift", "Alt", "Ctrl"].includes(k));
  if (main && chord.includes("Shift") && SHIFTED[main] && chord.length === 2) {
    return [{ mac: SHIFTED[main], win: SHIFTED[main] }];
  }
  return chord.map((k) => {
    const named = NAMED[k];
    if (named)
      return { mac: named.mac, win: named.win, srMac: named.sr?.mac, srWin: named.sr?.win };
    const plain = k.replace(/^Key|^Digit/, "");
    return { mac: plain, win: plain };
  });
}

/** The chord as one line of text, for the readout and screen readers. */
export function chordText(chord: readonly Key[], os: Os) {
  return caps(chord)
    .map((c) => c[os])
    .join(os === "mac" ? "" : "+");
}

/** The physical keys (KeyboardEvent.code) a key lights on the drawn keyboard. */
export function codes(k: Key, os: Os): string[] {
  switch (k) {
    case "Mod":
      return os === "mac" ? ["MetaLeft", "MetaRight"] : ["ControlLeft", "ControlRight"];
    case "Shift":
      return ["ShiftLeft", "ShiftRight"];
    case "Alt":
      return ["AltLeft", "AltRight"];
    case "Ctrl":
      return ["ControlLeft"];
    case "Up":
    case "Down":
    case "Left":
    case "Right":
      return [`Arrow${k}`];
    default:
      return [k];
  }
}
