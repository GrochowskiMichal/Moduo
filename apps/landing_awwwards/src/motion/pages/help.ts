// The help center's search (components/help/HelpSearch.astro): the field answers as you type.
// Every word you type must appear in a question or its answer; the groups and the topic rail
// narrow to what is left, the matched words are marked, and once only a few answers remain the
// ones that matched in their answer open. A topic button narrows to its group. `/` jumps to the
// field, as it does in the app, and ?q= in the address fills it (and is kept as you type).
import { onPage } from "../../engine";

type Item = {
  el: HTMLDetailsElement;
  texts: { el: HTMLElement; raw: string }[];
  hay: string;
  group: string;
};

const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'");
const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The text with every occurrence of a word marked, compared without case or accents. */
function marked(raw: string, words: string[]) {
  if (!words.length) return escape(raw);
  const folded = fold(raw);
  const hits: [number, number][] = [];
  for (const w of words) {
    let i = folded.indexOf(w);
    while (i !== -1) {
      hits.push([i, i + w.length]);
      i = folded.indexOf(w, i + w.length);
    }
  }
  if (!hits.length) return escape(raw);
  hits.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const h of hits) {
    const last = merged.at(-1);
    if (last && h[0] <= last[1]) last[1] = Math.max(last[1], h[1]);
    else merged.push([...h]);
  }
  let out = "";
  let at = 0;
  for (const [a, b] of merged) {
    out += escape(raw.slice(at, a)) + `<mark>${escape(raw.slice(a, b))}</mark>`;
    at = b;
  }
  return out + escape(raw.slice(at));
}

export function startHelp() {
  onPage(() => {
    const root = document.querySelector<HTMLElement>('[data-pg="help"]');
    if (!root) return;
    const field = root.querySelector<HTMLInputElement>("[data-help-q]");
    const count = root.querySelector<HTMLElement>("[data-help-count]");
    const none = root.querySelector<HTMLElement>("[data-help-none]");
    const cats = [...root.querySelectorAll<HTMLButtonElement>("[data-help-cats] [data-cat]")];
    const groups = [...root.querySelectorAll<HTMLElement>("[data-group]")];
    if (!field || !count || !none) return;
    const [one, many] = [count.dataset.one ?? "answer", count.dataset.many ?? "answers"];

    const items: Item[] = [...root.querySelectorAll<HTMLDetailsElement>("[data-item]")].map(
      (el) => {
        const texts = [...el.querySelectorAll<HTMLElement>("[data-text]")].map((t) => ({
          el: t,
          raw: (t.textContent ?? "").trim(),
        }));
        return {
          el,
          texts,
          hay: fold(texts.map((t) => t.raw).join(" ")),
          group: el.closest<HTMLElement>("[data-group]")?.dataset.group ?? "",
        };
      },
    );
    // Answers the search opened, so clearing the field closes them again (and only them).
    const opened = new Set<HTMLDetailsElement>();
    let cat = "all";
    let lastUrl = "";
    let urlTimer = 0;

    const run = () => {
      const q = field.value.trim();
      const words = [
        ...new Set(
          fold(q)
            .split(/\s+/)
            .filter((w) => w.length > 0),
        ),
      ];
      const perCat = new Map<string, number>();
      let shown = 0;
      const matches: Item[] = [];
      for (const item of items) {
        const hit = words.every((w) => item.hay.includes(w));
        if (hit) perCat.set(item.group, (perCat.get(item.group) ?? 0) + 1);
        const visible = hit && (cat === "all" || item.group === cat);
        item.el.hidden = !visible;
        for (const t of item.texts) t.el.innerHTML = visible ? marked(t.raw, words) : escape(t.raw);
        if (visible) {
          shown += 1;
          matches.push(item);
        }
      }
      for (const g of groups) {
        const n = [...g.querySelectorAll<HTMLElement>("[data-item]")].filter(
          (el) => !el.hidden,
        ).length;
        g.hidden = n === 0;
        const label = g.querySelector<HTMLElement>("[data-n]");
        if (label) label.textContent = String(n);
      }
      let total = 0;
      for (const b of cats) {
        const id = b.dataset.cat ?? "all";
        const n =
          id === "all" ? [...perCat.values()].reduce((s, v) => s + v, 0) : (perCat.get(id) ?? 0);
        if (id === "all") total = n;
        const label = b.querySelector<HTMLElement>("[data-n]");
        if (label) label.textContent = String(n);
        b.classList.toggle("is-empty", n === 0);
      }
      none.hidden = shown > 0;
      const noun = shown === 1 ? one : many;
      const found = shown === 0 ? `No ${many}` : `${shown} ${noun}`;
      count.textContent = q
        ? `${found} for “${q}”${cat !== "all" && total > shown ? `, ${total} in all topics` : ""}`
        : found;

      // A few answers left: open the ones whose answer holds the words.
      const few = words.length > 0 && q.length >= 3 && shown <= 4;
      for (const el of opened) {
        if (!few || el.hidden) {
          el.open = false;
          opened.delete(el);
        }
      }
      if (few) {
        for (const m of matches) {
          const answer = fold(
            m.texts
              .slice(1)
              .map((t) => t.raw)
              .join(" "),
          );
          if (!m.el.open && words.some((w) => answer.includes(w))) {
            m.el.open = true;
            opened.add(m.el);
          }
        }
      }

      window.clearTimeout(urlTimer);
      urlTimer = window.setTimeout(() => {
        const url = new URL(location.href);
        if (q) url.searchParams.set("q", q);
        else url.searchParams.delete("q");
        if (url.href !== lastUrl) {
          lastUrl = url.href;
          history.replaceState(history.state, "", url);
        }
      }, 400);
    };

    const pick = (b: HTMLButtonElement) => {
      cat = b.dataset.cat ?? "all";
      for (const other of cats) other.setAttribute("aria-pressed", String(other === b));
      run();
      // Narrowing from far down the page brings the results back into view.
      const top = root.querySelector<HTMLElement>("[data-help-results]");
      if (top && top.getBoundingClientRect().top < 0) {
        top.scrollIntoView({
          block: "start",
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
      }
    };
    const onCat = (e: Event) => pick(e.currentTarget as HTMLButtonElement);
    for (const b of cats) b.addEventListener("click", onCat);
    field.addEventListener("input", run);

    // `/` from anywhere on the page puts you in the field, as in the app.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      field.focus();
      field.select();
    };
    addEventListener("keydown", onKey);

    const start = new URL(location.href).searchParams.get("q");
    if (start) {
      field.value = start;
      run();
    }

    return () => {
      for (const b of cats) b.removeEventListener("click", onCat);
      field.removeEventListener("input", run);
      removeEventListener("keydown", onKey);
      window.clearTimeout(urlTimer);
    };
  });
}
