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

const isBadUrlChar = (c: string) => {
  const code = c.charCodeAt(0);
  return (
    c === '"' ||
    c === "'" ||
    c === "(" ||
    code <= 0x08 ||
    code === 0x0b ||
    (code >= 0x0e && code <= 0x1f) ||
    code === 0x7f
  );
};

const decodeHex = (hex: string) => {
  const cp = Number.parseInt(hex, 16);
  return cp === 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)
    ? "\uFFFD"
    : String.fromCodePoint(cp);
};

class Lexer {
  i = 0;
  readonly out: Tok[] = [];
  constructor(readonly css: string) {}

  validEscape(at: number) {
    return this.css[at] === "\\" && this.css[at + 1] !== undefined && !isNewline(this.css[at + 1]);
  }

  startsIdent(at: number) {
    const c = this.css[at];
    const n = this.css[at + 1];
    if (c === "-") return isNameStart(n) || n === "-" || this.validEscape(at + 1);
    return isNameStart(c) || this.validEscape(at);
  }

  skipWs() {
    while (isWs(this.css[this.i])) this.i += 1;
  }

  /** i points just past the backslash. */
  escape(): string {
    const c = this.css[this.i];
    if (c === undefined) return "\uFFFD";
    if (!isHex(c)) {
      this.i += 1;
      return c;
    }
    let hex = "";
    while (hex.length < 6 && isHex(this.css[this.i] ?? "")) hex += this.css[this.i++];
    if (this.css[this.i] === "\r" && this.css[this.i + 1] === "\n") this.i += 2;
    else if (isWs(this.css[this.i])) this.i += 1;
    return decodeHex(hex);
  }

  name(): string {
    let v = "";
    for (;;) {
      if (isName(this.css[this.i])) v += this.css[this.i++];
      else if (!this.validEscape(this.i)) return v;
      else {
        this.i += 1;
        v += this.escape();
      }
    }
  }

  /** A backslash inside a string: returns the decoded text (maybe empty). */
  stringEscape(): string {
    const n = this.css[this.i + 1];
    if (n === undefined) this.i += 1;
    else if (isNewline(n)) this.i += 2;
    else {
      this.i += 1;
      return this.escape();
    }
    return "";
  }

  string(q: string, s: number): Tok {
    let v = "";
    for (;;) {
      const c = this.css[this.i];
      if (c === undefined || isNewline(c)) return { t: "str", v, ok: false, s, e: this.i };
      if (c === q) {
        this.i += 1;
        return { t: "str", v, ok: true, s, e: this.i };
      }
      if (c === "\\") v += this.stringEscape();
      else {
        v += c;
        this.i += 1;
      }
    }
  }

  badUrl(s: number): Tok {
    while (this.i < this.css.length && this.css[this.i] !== ")") {
      this.i += 1;
      if (this.css[this.i - 1] === "\\" && this.validEscape(this.i - 1)) this.escape();
    }
    if (this.css[this.i] === ")") this.i += 1;
    return { t: "badurl", s, e: this.i };
  }

  /** Whitespace inside an unquoted url(): legal only right before ")". */
  urlWs(v: string, s: number): Tok {
    this.skipWs();
    if (this.css[this.i] !== ")") return this.badUrl(s);
    this.i += 1;
    return { t: "url", v, s, e: this.i };
  }

  url(s: number): Tok {
    let v = "";
    this.skipWs();
    for (;;) {
      const c = this.css[this.i];
      if (c === undefined) return { t: "badurl", s, e: this.i };
      if (c === ")") {
        this.i += 1;
        return { t: "url", v, s, e: this.i };
      }
      if (isWs(c)) return this.urlWs(v, s);
      if (isBadUrlChar(c)) return this.badUrl(s);
      if (c === "\\" && !this.validEscape(this.i)) return this.badUrl(s);
      this.i += 1;
      v += c === "\\" ? this.escape() : c;
    }
  }

  identLike(s: number): Tok {
    const v = this.name();
    if (this.css[this.i] !== "(") return { t: "ident", v, s, e: this.i };
    this.i += 1;
    if (v.toLowerCase() !== "url") return { t: "fn", v, s, e: this.i };
    let j = this.i;
    while (isWs(this.css[j])) j += 1;
    const q = this.css[j];
    return q === '"' || q === "'" ? { t: "fn", v, s, e: this.i } : this.url(s);
  }

  number(s: number): Tok {
    while (/[0-9.]/.test(this.css[this.i] ?? "")) this.i += 1;
    if (this.startsIdent(this.i)) this.name();
    return { t: "delim", s, e: this.i };
  }

  /** Skips a comment at i; true when there was one. */
  comment(): boolean {
    if (this.css[this.i] !== "/" || this.css[this.i + 1] !== "*") return false;
    const end = this.css.indexOf("*/", this.i + 2);
    this.i = end < 0 ? this.css.length : end + 2;
    return true;
  }

  token(): Tok {
    const { css } = this;
    const s = this.i;
    const c = css[s]!;
    if (isWs(c)) {
      this.skipWs();
      return { t: "ws", s, e: this.i };
    }
    if (c === '"' || c === "'") {
      this.i += 1;
      return this.string(c, s);
    }
    if (c === "@" && this.startsIdent(s + 1)) {
      this.i += 1;
      return { t: "at", v: this.name(), s, e: this.i };
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(css[s + 1] ?? ""))) return this.number(s);
    if (this.startsIdent(s)) return this.identLike(s);
    this.i += 1;
    return { t: c === ")" ? "close" : c === ";" ? "semi" : "delim", s, e: this.i };
  }
}

function tokenize(css: string): Tok[] {
  const lx = new Lexer(css);
  while (lx.i < css.length) {
    if (!lx.comment()) lx.out.push(lx.token());
  }
  return lx.out;
}

/** One URL reference in CSS: [s, e) is the text to replace. */
export type CssUrlRef = { url: string | null; s: number; e: number; kind: "fn" | "str" };

const nextReal = (toks: Tok[], k: number) => {
  let j = k;
  while (toks[j]?.t === "ws") j += 1;
  return j;
};

/** url("…") / src("…") as a function token: the whole call up to its ")"; returns the ref and the last index. */
function fnRef(css: string, toks: Tok[], k: number): [CssUrlRef, number] {
  const tok = toks[k]!;
  const j = nextReal(toks, k + 1);
  const arg = toks[j];
  const close = toks[nextReal(toks, j + 1)];
  let depth = 1;
  let m = k + 1;
  for (; m < toks.length && depth > 0; m += 1) {
    const t = toks[m]!.t;
    if (t === "fn") depth += 1;
    else if (t === "close") depth -= 1;
  }
  const end = toks[m - 1]?.e ?? css.length;
  const clean = arg?.t === "str" && arg.ok && close?.t === "close" && depth === 0;
  const url = clean && arg.t === "str" ? arg.v : null;
  return [{ url, s: tok.s, e: end, kind: "fn" }, m - 1];
}

/** @import "…": the string after it, if any. */
function importRef(toks: Tok[], k: number): [CssUrlRef, number] | null {
  const j = nextReal(toks, k + 1);
  const arg = toks[j];
  if (arg?.t !== "str") return null;
  return [{ url: arg.ok ? arg.v : null, s: arg.s, e: arg.e, kind: "str" }, j];
}

const IMAGE_SET = new Set(["image-set", "-webkit-image-set"]);

/** The reference token k starts, if any; returns it and the last index it used. */
function refAt(css: string, toks: Tok[], k: number, stack: string[]): [CssUrlRef, number] | null {
  const tok = toks[k]!;
  switch (tok.t) {
    case "url":
      return [{ url: tok.v, s: tok.s, e: tok.e, kind: "fn" }, k];
    case "badurl":
      return [{ url: null, s: tok.s, e: tok.e, kind: "fn" }, k];
    case "fn": {
      const fname = tok.v.toLowerCase();
      if (fname === "url" || fname === "src") return fnRef(css, toks, k);
      stack.push(fname);
      return null;
    }
    case "close":
      stack.pop();
      return null;
    case "str":
      if (!IMAGE_SET.has(stack[stack.length - 1] ?? "")) return null;
      return [{ url: tok.ok ? tok.v : null, s: tok.s, e: tok.e, kind: "str" }, k];
    case "at":
      return tok.v.toLowerCase() === "import" ? importRef(toks, k) : null;
    default:
      return null;
  }
}

/** Every URL reference; `url: null` means the reference could not be parsed with confidence. */
export function findCssUrls(css: string): CssUrlRef[] {
  const toks = tokenize(css);
  const refs: CssUrlRef[] = [];
  const stack: string[] = [];
  for (let k = 0; k < toks.length; k += 1) {
    const hit = refAt(css, toks, k, stack);
    if (hit) {
      refs.push(hit[0]);
      k = hit[1];
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
