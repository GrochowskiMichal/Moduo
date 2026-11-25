// /ai: the key's reach (components/ai/Reach.astro). The levels on the key decide which tools are
// lit: a tool opens when its own module is at its level (View for reading, Edit for changing)
// and, for the six that touch a second module, that module is at Edit too. A change parts the
// field: what opens slides in from the stroke's side, what closes steps back; the count runs to
// its new number. Pointing at a tool, or moving through the field with the arrow keys (one tab
// stop), reads it out beside the key. Under reduced motion the field changes in place.
import { gsap } from "gsap";

import { ease, onPage, prefersReducedMotion } from "../../engine";

type Level = "none" | "view" | "edit";

export function startAi() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>("[data-reach]");
    if (!root) return;
    const reduce = prefersReducedMotion();
    const form = root.querySelector("form")!;
    const chips = [...root.querySelectorAll<HTMLElement>("[data-tool]")];
    const belts = [...root.querySelectorAll<HTMLElement>("[data-belt]")];
    const nums = [...root.querySelectorAll<HTMLElement>("[data-reach-n]")];
    const say = root.querySelector<HTMLElement>("[data-reach-say]");
    const reads = [...root.querySelectorAll<HTMLElement>("[data-reach-read]")];
    const total = Number(root.dataset.total);
    const restRead = reads.map((r) => r.textContent ?? "");
    // What each level lets the assistant do, per module (from the page's content file).
    const lines = JSON.parse(root.dataset.says ?? "{}") as Record<string, Record<Level, string>>;

    const reach = (): Record<string, Level> => {
      const out: Record<string, Level> = {};
      form.querySelectorAll<HTMLFieldSetElement>("fieldset[data-module]").forEach((fs) => {
        out[fs.dataset.module!] = (fs.querySelector<HTMLInputElement>("input:checked")?.value ??
          "none") as Level;
      });
      return out;
    };
    const allows = (level: Level, access: string) =>
      access === "view" ? level !== "none" : level === "edit";
    const levelName = { none: "None", view: "View", edit: "Edit" } as const;

    const counter = { v: chips.filter((c) => c.classList.contains("is-on")).length };
    const write = (n: number) => nums.forEach((el) => (el.textContent = String(n)));

    const update = () => {
      const r = reach();
      const opening: HTMLElement[] = [];
      const closing: HTMLElement[] = [];
      let open = 0;
      chips.forEach((c) => {
        const own = allows(r[c.dataset.module!], c.dataset.access!);
        const needs = c.dataset.needs;
        const on = own && (!needs || r[needs] === "edit");
        const need = own && !on;
        if (on) open++;
        const was = c.classList.contains("is-on");
        if (on && !was) opening.push(c);
        if (!on && was) closing.push(c);
        c.classList.toggle("is-on", on);
        c.classList.toggle("is-need", need);
      });
      belts.forEach((b) => {
        const m = b.dataset.belt!;
        const level = r[m];
        if (b.dataset.level === level) return;
        b.dataset.level = level;
        b.querySelector("[data-belt-lvl]")!.textContent = levelName[level];
        const says = b.querySelector<HTMLElement>("[data-belt-says]")!;
        says.textContent = lines[m]?.[level] ?? says.textContent;
        if (!reduce)
          gsap.fromTo(
            says,
            { autoAlpha: 0, x: -8 },
            { autoAlpha: 1, x: 0, duration: 0.5, ease: ease.out },
          );
      });
      if (say) say.textContent = `${open} of ${total} tools open`;
      if (reduce) {
        write(open);
      } else {
        gsap.to(counter, {
          v: open,
          duration: 0.6,
          ease: ease.out,
          overwrite: true,
          onUpdate: () => write(Math.round(counter.v)),
        });
        if (opening.length)
          gsap.fromTo(
            opening,
            { x: -8, autoAlpha: 0.35 },
            {
              x: 0,
              autoAlpha: 1,
              duration: 0.55,
              ease: ease.out,
              stagger: 0.012,
              overwrite: true,
              clearProps: "transform,opacity,visibility",
            },
          );
        if (closing.length)
          gsap.fromTo(
            closing,
            { x: 6 },
            {
              x: 0,
              duration: 0.45,
              ease: ease.out,
              stagger: 0.008,
              overwrite: true,
              clearProps: "transform",
            },
          );
      }
    };

    // Read a tool out beside the key.
    let reading: HTMLElement | null = null;
    const readOut = (c: HTMLElement | null) => {
      reading?.classList.remove("is-read");
      reading = c;
      if (!c) {
        reads.forEach((r, i) => (r.textContent = restRead[i]));
        return;
      }
      c.classList.add("is-read");
      const state = c.classList.contains("is-on")
        ? "Open"
        : c.classList.contains("is-need")
          ? "Closed until the other module is at Edit"
          : "Closed";
      const part = (tag: string, cls: string, text: string) => {
        const el = document.createElement(tag);
        if (cls) el.className = cls;
        el.textContent = text;
        return el;
      };
      reads.forEach((r) =>
        r.replaceChildren(
          part("code", "", c.dataset.tool ?? ""),
          " ",
          part("span", "reach__does", `${c.dataset.does}.`),
          part("span", "reach__req", `${state}. Needs ${c.dataset.req}.`),
        ),
      );
    };

    // One tab stop into the field; the arrow keys, Home and End move through it.
    let focusIndex = 0;
    const setStop = (i: number) => {
      chips[focusIndex]?.setAttribute("tabindex", "-1");
      focusIndex = Math.max(0, Math.min(chips.length - 1, i));
      chips[focusIndex].setAttribute("tabindex", "0");
    };
    setStop(0);
    const onKey = (e: KeyboardEvent) => {
      const i = chips.indexOf(e.target as HTMLElement);
      if (i < 0) return;
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      let next = -1;
      if (step) next = i + step;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = chips.length - 1;
      if (next < 0 || next >= chips.length) return;
      e.preventDefault();
      setStop(next);
      chips[next].focus();
    };
    const onFocus = (e: FocusEvent) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>("[data-tool]");
      if (!c) return;
      setStop(chips.indexOf(c));
      readOut(c);
    };
    const onOver = (e: PointerEvent) =>
      readOut((e.target as HTMLElement).closest<HTMLElement>("[data-tool]") ?? reading);
    const onLeave = () => {
      if (
        !root.contains(document.activeElement) ||
        !(document.activeElement as HTMLElement).dataset.tool
      )
        readOut(null);
    };
    const onTap = (e: MouseEvent) => {
      const c = (e.target as HTMLElement).closest<HTMLElement>("[data-tool]");
      if (c) c.focus({ preventScroll: true });
    };

    const belt = root.querySelector<HTMLElement>("[data-reach-belt]")!;
    form.addEventListener("change", update);
    belt.addEventListener("keydown", onKey);
    belt.addEventListener("focusin", onFocus);
    belt.addEventListener("pointerover", onOver);
    belt.addEventListener("pointerleave", onLeave);
    belt.addEventListener("focusout", onLeave);
    belt.addEventListener("click", onTap);
    return () => {
      form.removeEventListener("change", update);
      belt.removeEventListener("keydown", onKey);
      belt.removeEventListener("focusin", onFocus);
      belt.removeEventListener("pointerover", onOver);
      belt.removeEventListener("pointerleave", onLeave);
      belt.removeEventListener("focusout", onLeave);
      belt.removeEventListener("click", onTap);
    };
  });
}
