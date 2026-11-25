// The shortcuts page's board (pages/shortcuts.astro): the keys you hold light on the drawn
// keyboard, and the readout names what that chord does in Moduo, wherever it works. A row in the
// list, pressed or tapped, plays its keys on the board; under the pointer its keys wait there,
// outlined. Mac or Windows: the visitor's own first, then theirs to switch. Visual only: the
// browser keeps every key (nothing is prevented), and focus is never held. Until you press or tap
// something, the board follows your reading: the row in the middle of the screen waits on it.
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { caps, chordText, codes, type Os } from "../../components/shortcuts/legend";
import { type Key, type Shortcut, shortcuts } from "../../data/pages/shortcuts";
import { onPage } from "../../engine";

const MODS = new Set(["Mod", "Shift", "Alt", "Ctrl"]);
const MOD_CODES = /^(Meta|Control|Alt|Shift)(Left|Right)$|^CapsLock$|^Fn$/;

type Row = { s: Shortcut; group: string; el: HTMLButtonElement };

/** The chord a key press is, in the page's key names; null while only modifiers are down. */
function chordOf(e: KeyboardEvent, mac: boolean): Key[] | null {
  if (MOD_CODES.test(e.code) || !e.code) return null;
  const main = e.code.startsWith("Arrow")
    ? e.code.slice(5)
    : e.code === "Delete"
      ? "Backspace"
      : e.code === "NumpadEnter"
        ? "Enter"
        : e.code;
  const chord: Key[] = [];
  if (mac ? e.metaKey : e.ctrlKey) chord.push("Mod");
  if (mac && e.ctrlKey) chord.push("Ctrl");
  if (e.altKey) chord.push("Alt");
  if (e.shiftKey) chord.push("Shift");
  chord.push(main as Key);
  return chord;
}

const same = (a: readonly Key[], b: readonly Key[]) =>
  a.length === b.length && a.every((k) => b.includes(k));

function matches(s: Shortcut, chord: Key[]) {
  if (!s.range) return s.keys.some((c) => same(c, chord));
  const [lo, hi] = s.keys;
  const mods = (c: readonly Key[]) => c.filter((k) => MODS.has(k));
  const digit = (c: readonly Key[]) => Number(c.find((k) => k.startsWith("Digit"))?.slice(5));
  const n = digit(chord);
  return (
    same(mods(lo), mods(chord)) && n >= digit(lo) && n <= digit(hi) && chord.length === lo.length
  );
}

export function startShortcuts() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>('[data-pg="shortcuts"]');
    if (!root) return;
    const read = root.querySelector<HTMLElement>("[data-sc-read]");
    const idle = read?.firstElementChild?.cloneNode(true) as HTMLElement | undefined;
    const picks = [...root.querySelectorAll<HTMLButtonElement>("[data-os-pick]")];
    if (!read) return;

    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
    let os: Os = mac ? "mac" : "win";
    const groupName = new Map(shortcuts.groups.map((g) => [g.id, g.name] as const));
    const rows: Row[] = [...root.querySelectorAll<HTMLButtonElement>("[data-sc]")].map((el) => {
      const [g, i] = (el.dataset.sc ?? ":").split(":");
      const group = shortcuts.groups.find((x) => x.id === g)!;
      return { s: group.items[Number(i)] as Shortcut, group: groupName.get(g) ?? "", el };
    });

    // Every drawn key by its physical code (the Mac's and the Windows bottom rows both).
    const keyEls = new Map<string, HTMLElement[]>();
    root.querySelectorAll<HTMLElement>("[data-code]").forEach((el) => {
      const c = el.dataset.code!;
      keyEls.set(c, [...(keyEls.get(c) ?? []), el]);
    });
    const els = (chord: readonly Key[]) =>
      chord.flatMap((k) => codes(k, os)).flatMap((c) => keyEls.get(c) ?? []);

    const timers: number[] = [];
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const held = new Map<string, number>();
    let shown: {
      chords: Key[][];
      join?: "to" | "or";
      lines: { does: string; where: string }[];
    } | null = null;

    const setOs = (next: Os) => {
      os = next;
      root.dataset.os = os;
      for (const b of picks) b.setAttribute("aria-pressed", String(b.dataset.osPick === os));
      if (shown) render();
    };

    const cap = (k: string) => {
      const kbd = document.createElement("kbd");
      kbd.className = "kbd";
      kbd.textContent = k;
      return kbd;
    };
    /** The readout: the chord on the left, what it does (and where) beside it. */
    function render() {
      if (!shown) return;
      const box = document.createElement("div");
      box.className = "rd";
      const keys = document.createElement("span");
      keys.className = "rd__keys";
      keys.setAttribute(
        "aria-label",
        shown.chords.map((c) => chordText(c, os)).join(shown.join ? ` ${shown.join} ` : " "),
      );
      shown.chords.forEach((c, i) => {
        if (i > 0 && shown!.join) {
          const to = document.createElement("span");
          to.className = "rd__to";
          to.textContent = shown!.join;
          keys.append(to);
        }
        for (const piece of caps(c)) keys.append(cap(piece[os]));
      });
      box.append(keys);
      if (!shown.lines.length) {
        const p = document.createElement("span");
        p.className = "rd__none";
        p.textContent = shortcuts.board.none;
        box.append(p);
      }
      for (const line of shown.lines.slice(0, 3)) {
        const does = document.createElement("span");
        does.className = "rd__does";
        does.textContent = line.does;
        const where = document.createElement("span");
        where.className = "rd__where";
        where.textContent = line.where;
        box.append(does, where);
      }
      read!.replaceChildren(box);
    }

    const flash = (list: HTMLElement[], cls: string, ms: number) => {
      list.forEach((el) => el.classList.add(cls));
      later(() => list.forEach((el) => el.classList.remove(cls)), ms);
    };

    // The real keyboard.
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      engage();
      const lit = keyEls.get(e.code) ?? [];
      lit.forEach((el) => el.classList.add("is-on"));
      window.clearTimeout(held.get(e.code));
      // With ⌘ held a Mac never sends the other key's keyup: let it go on its own.
      if (!MOD_CODES.test(e.code)) {
        held.set(
          e.code,
          window.setTimeout(
            () => lit.forEach((el) => el.classList.remove("is-on")),
            e.metaKey ? 520 : 4000,
          ),
        );
      }
      const chord = chordOf(e, mac);
      if (!chord || e.repeat) return;
      const hits = rows.filter(
        (r) => (!r.s.only || r.s.only === (mac ? "mac" : "win")) && matches(r.s, chord),
      );
      shown = {
        chords: [chord],
        lines: hits.map((r) => ({ does: r.s.does, where: r.group })),
      };
      render();
      for (const r of hits) flash([r.el], "is-match", 900);
    };
    const up = (e: KeyboardEvent) => {
      (keyEls.get(e.code) ?? []).forEach((el) => el.classList.remove("is-on"));
      window.clearTimeout(held.get(e.code));
      if (e.key === "Meta")
        root.querySelectorAll(".kb__k.is-on").forEach((el) => el.classList.remove("is-on"));
    };
    const clear = () =>
      root
        .querySelectorAll(".kb__k.is-on, .kb__k.is-hint")
        .forEach((el) => el.classList.remove("is-on", "is-hint"));

    // A row: play its chords on the board, one after another.
    const play = (r: Row) => {
      timers.splice(0).forEach((t) => window.clearTimeout(t));
      clear();
      rows.forEach((x) => x.el.classList.remove("is-playing"));
      const chords = r.s.keys as Key[][];
      shown = {
        chords,
        join: r.s.range ? "to" : r.s.or ? "or" : undefined,
        lines: [{ does: r.s.does, where: r.group }],
      };
      render();
      r.el.classList.add("is-playing");
      chords.forEach((c, i) => later(() => flash(els(c), "is-on", 620), i * 760));
      later(() => r.el.classList.remove("is-playing"), chords.length * 760);
    };
    const onRow = (e: Event) => {
      const r = rows.find((x) => x.el === e.currentTarget);
      engage();
      if (r) play(r);
    };
    const onEnter = (e: Event) => {
      const r = rows.find((x) => x.el === e.currentTarget);
      if (r) els(r.s.keys[0] as Key[]).forEach((el) => el.classList.add("is-hint"));
    };
    const onLeave = () =>
      root.querySelectorAll(".kb__k.is-hint").forEach((el) => el.classList.remove("is-hint"));
    // Reading, not pressing: the row crossing the middle of the screen waits on the board,
    // outlined, without being read out. The first key or tap hands the board back to you.
    let engaged = false;
    const triggers: ScrollTrigger[] = [];
    function engage() {
      if (engaged) return;
      engaged = true;
      read!.setAttribute("aria-live", "polite");
      rows.forEach((x) => x.el.classList.remove("is-near"));
      onLeave();
    }
    const preview = (r: Row) => {
      if (engaged) return;
      read!.setAttribute("aria-live", "off");
      rows.forEach((x) => x.el.classList.toggle("is-near", x === r));
      onLeave();
      els(r.s.keys[0] as Key[]).forEach((el) => el.classList.add("is-hint"));
      shown = {
        chords: r.s.keys as Key[][],
        join: r.s.range ? "to" : r.s.or ? "or" : undefined,
        lines: [{ does: r.s.does, where: r.group }],
      };
      render();
    };
    for (const r of rows) {
      triggers.push(
        ScrollTrigger.create({
          trigger: r.el,
          start: "top 55%",
          end: "bottom 55%",
          onToggle: (self) => self.isActive && preview(r),
        }),
      );
    }
    const fine = matchMedia("(hover: hover) and (pointer: fine)").matches;
    for (const r of rows) {
      r.el.addEventListener("click", onRow);
      if (fine) {
        r.el.addEventListener("pointerenter", onEnter);
        r.el.addEventListener("pointerleave", onLeave);
      }
    }
    const onPick = (e: Event) =>
      setOs(((e.currentTarget as HTMLElement).dataset.osPick as Os) ?? "mac");
    for (const b of picks) b.addEventListener("click", onPick);

    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", clear);
    setOs(os);

    return () => {
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", clear);
      for (const r of rows) {
        r.el.removeEventListener("click", onRow);
        r.el.removeEventListener("pointerenter", onEnter);
        r.el.removeEventListener("pointerleave", onLeave);
      }
      for (const b of picks) b.removeEventListener("click", onPick);
      triggers.forEach((t) => t.kill());
      timers.forEach((t) => window.clearTimeout(t));
      held.forEach((t) => window.clearTimeout(t));
      if (idle) read.replaceChildren(idle);
    };
  });
}
