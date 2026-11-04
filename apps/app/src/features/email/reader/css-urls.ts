// Finds every URL a piece of CSS can load, the way a browser tokenizes it
// (CSS Syntax Level 3): escapes decode in names, strings and url() bodies,
// comments hide nothing, and image-set() strings, @import and @font-face src
// all count. Used by the reader's tracker shield instead of a regex.

type Tok =
  | { t: "ws" | "delim" | "close" | "semi"; s: number; e: number }
  | { t: "url"; v: string; s: number; e: number }
  | { t: "badurl"; s: number; e: number }
  | { t: "str"; v: string; ok: boolean; s: number; e: number }
  | { t: "fn"; v: string; s: number; e: number }
  | { t: "at" | "ident"; v: string; s: number; e: number };

const isHex = (c: string) => /^[0-9a-fA-F]$/.test(c);
const isWs = (c: string | undefined) =>
  c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
const isNameStart = (c: string | undefined) =>
  c !== undefined && (/^[A-Za-z_]$/.test(c) || c.charCodeAt(0) >= 0x80);
const isName = (c: string | undefined) => c !== undefined && (isNameStart(c) || /^[0-9-]$/.test(c));
const isNewline = (c: string | undefined) => c === "\n" || c === "\r" || c === "\f";

function tokenize(css: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const validEscape = (at: number) =>
    css[at] === "\\" && css[at + 1] !== undefined && !isNewline(css[at + 1]);
  const startsIdent = (at: number) => {
    const c = css[at];
    if (c === "-") return isNameStart(css[at + 1]) || css[at + 1] === "-" || validEscape(at + 1);
    return isNameStart(c) || validEscape(at);
  };
  // i points just past the backslash.
  const escape = (): string => {
    const c = css[i];
    if (c === undefined) return "�";
    if (isHex(c)) {
      let hex = "";
      while (hex.length < 6 && css[i] !== undefined && isHex(css[i]!)) hex += css[i++];
      if (css[i] === "\r" && css[i + 1] === "\n") i += 2;
      else if (isWs(css[i])) i += 1;
      const cp = Number.parseInt(hex, 16);
      return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
        ? "�"
        : String.fromCodePoint(cp);
    }
    i += 1;
    return c;
  };
  const name = (): string => {
    let v = "";
    for (;;) {
      if (isName(css[i])) v += css[i++];
      else if (validEscape(i)) {
        i += 1;
        v += escape();
      } else return v;
    }
  };
  const string = (q: string, s: number): Tok => {
    let v = "";
    for (;;) {
      const c = css[i];
      if (c === undefined) return { t: "str", v, ok: false, s, e: i };
      if (c === q) {
        i += 1;
        return { t: "str", v, ok: true, s, e: i };
      }
      if (isNewline(c)) return { t: "str", v, ok: false, s, e: i };
      if (c === "\\") {
        if (css[i + 1] === undefined) i += 1;
        else if (isNewline(css[i + 1])) i += 2;
        else {
          i += 1;
          v += escape();
        }
        continue;
      }
      v += c;
      i += 1;
    }
  };
  const badUrlRest = () => {
    while (i < css.length && css[i] !== ")") {
      if (validEscape(i)) {
        i += 1;
        escape();
      } else i += 1;
    }
    if (css[i] === ")") i += 1;
  };
  const url = (s: number): Tok => {
    let v = "";
    while (isWs(css[i])) i += 1;
    for (;;) {
      const c = css[i];
      if (c === undefined) return { t: "badurl", s, e: i };
      if (c === ")") {
        i += 1;
        return { t: "url", v, s, e: i };
      }
      if (isWs(c)) {
        while (isWs(css[i])) i += 1;
        if (css[i] === ")") {
          i += 1;
          return { t: "url", v, s, e: i };
        }
        badUrlRest();
        return { t: "badurl", s, e: i };
      }
      const code = c.charCodeAt(0);
      if (
        c === '"' ||
        c === "'" ||
        c === "(" ||
        code <= 0x08 ||
        code === 0x0b ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
      ) {
        badUrlRest();
        return { t: "badurl", s, e: i };
      }
      if (c === "\\") {
        if (!validEscape(i)) {
          badUrlRest();
          return { t: "badurl", s, e: i };
        }
        i += 1;
        v += escape();
        continue;
      }
      v += c;
      i += 1;
    }
  };

  while (i < css.length) {
    const s = i;
    const c = css[i]!;
    if (c === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end < 0 ? css.length : end + 2;
      continue;
    }
    if (isWs(c)) {
      while (isWs(css[i])) i += 1;
      out.push({ t: "ws", s, e: i });
    } else if (c === '"' || c === "'") {
      i += 1;
      out.push(string(c, s));
    } else if (c === "@" && startsIdent(i + 1)) {
      i += 1;
      out.push({ t: "at", v: name(), s, e: i });
    } else if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(css[i + 1] ?? ""))) {
      while (/[0-9.]/.test(css[i] ?? "")) i += 1;
      if (startsIdent(i)) name();
      out.push({ t: "delim", s, e: i });
    } else if (startsIdent(i)) {
      const v = name();
      if (css[i] === "(") {
        i += 1;
        if (v.toLowerCase() === "url") {
          let j = i;
          while (isWs(css[j])) j += 1;
          if (css[j] === '"' || css[j] === "'") out.push({ t: "fn", v, s, e: i });
          else out.push(url(s));
        } else out.push({ t: "fn", v, s, e: i });
      } else out.push({ t: "ident", v, s, e: i });
    } else {
      i += 1;
      out.push({ t: c === ")" ? "close" : c === ";" ? "semi" : "delim", s, e: i });
      // "(" "[" "{" also open blocks; they close with ) ] } which we only
      // need for function nesting, tracked below via "close".
    }
  }
  return out;
}

/** One URL reference in CSS: [s, e) is the text to replace. */
export type CssUrlRef = { url: string | null; s: number; e: number; kind: "fn" | "str" };

/** Every URL reference; `url: null` means the reference could not be parsed with confidence. */
export function findCssUrls(css: string): CssUrlRef[] {
  const toks = tokenize(css);
  const refs: CssUrlRef[] = [];
  const stack: string[] = [];
  const nextReal = (k: number) => {
    let j = k;
    while (toks[j]?.t === "ws") j += 1;
    return j;
  };
  for (let k = 0; k < toks.length; k += 1) {
    const tok = toks[k]!;
    if (tok.t === "url") refs.push({ url: tok.v, s: tok.s, e: tok.e, kind: "fn" });
    else if (tok.t === "badurl") refs.push({ url: null, s: tok.s, e: tok.e, kind: "fn" });
    else if (tok.t === "fn") {
      const fname = tok.v.toLowerCase();
      if (fname === "url" || fname === "src") {
        const j = nextReal(k + 1);
        const arg = toks[j];
        const close = toks[nextReal(j + 1)];
        // Find the matching ")" so the whole function is replaced.
        let depth = 1;
        let m = k + 1;
        for (; m < toks.length && depth > 0; m += 1) {
          const t = toks[m]!;
          if (t.t === "fn") depth += 1;
          else if (t.t === "close") depth -= 1;
        }
        const end = toks[m - 1]?.e ?? css.length;
        const clean = arg?.t === "str" && arg.ok && close?.t === "close" && depth === 0;
        refs.push({ url: clean && arg.t === "str" ? arg.v : null, s: tok.s, e: end, kind: "fn" });
        k = m - 1;
        continue;
      }
      stack.push(fname);
    } else if (tok.t === "close") stack.pop();
    else if (tok.t === "str") {
      const top = stack[stack.length - 1];
      if (top === "image-set" || top === "-webkit-image-set") {
        refs.push({ url: tok.ok ? tok.v : null, s: tok.s, e: tok.e, kind: "str" });
      }
    } else if (tok.t === "at" && tok.v.toLowerCase() === "import") {
      const j = nextReal(k + 1);
      const arg = toks[j];
      if (arg?.t === "str") {
        refs.push({ url: arg.ok ? arg.v : null, s: arg.s, e: arg.e, kind: "str" });
        k = j;
      }
    }
  }
  return refs;
}

/** Replaces each reference `drop` selects; returns the new CSS and how many went. */
export function rewriteCssUrls(
  css: string,
  drop: (url: string | null) => boolean,
): { css: string; dropped: number } {
  const refs = findCssUrls(css).filter((r) => drop(r.url));
  if (refs.length === 0) return { css, dropped: 0 };
  let out = "";
  let at = 0;
  for (const r of refs) {
    out += css.slice(at, r.s) + (r.kind === "fn" ? "none" : '""');
    at = r.e;
  }
  return { css: out + css.slice(at), dropped: refs.length };
}
