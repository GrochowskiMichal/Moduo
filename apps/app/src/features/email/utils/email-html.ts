// Sanitized srcdoc builder for the email reader iframes (EM-4 · DF-6).
//
// DF-6 (ratified): remote content is BLOCKED by default — the CSP whitelists
// only data:/cid: sources AND a DOM pass strips remote src/srcset/poster/
// background refs (so no tracking pixel fires on open and no broken-image
// glyphs remain). `{ blockRemote: false }` restores the remote-loading CSP for
// the per-message "Load images" / per-sender always-allow paths.
//
// `{ autoHeight: true }` injects a height reporter that posts the document's
// content height to the parent (EMAIL_IFRAME_HEIGHT_MESSAGE). The script is
// pinned by a per-document CSP nonce, so email HTML itself can never execute —
// the host iframe must use sandbox="allow-scripts" (and NEVER
// allow-same-origin) for it to run.

/** postMessage `type` sent by the auto-height reporter inside the iframe. */
export const EMAIL_IFRAME_HEIGHT_MESSAGE = "moduo:email:iframe-height";

export type EmailSrcDocOptions = {
  /** Block remote (http/https) content. Default TRUE — DF-6 ratified. */
  blockRemote?: boolean;
  /** Inject the nonce-pinned height reporter (needs sandbox="allow-scripts"). */
  autoHeight?: boolean;
};

/** Attributes that can trigger a remote fetch when they hold an http(s) URL. */
const REMOTE_FETCH_ATTRS = ["src", "srcset", "poster", "background"] as const;

/** Matches url(http…) / url(//…) inside inline styles and <style> blocks.
 * Linear: the space after a quote only matches once a quote was seen, so a run
 * of spaces can't be split two ways between `\s*`s (F19, MOD-577). */
const CSS_REMOTE_URL_RE = /url\(\s*(?:["']\s*)?(?:https?:)?\/\//i;

function isRemoteUrl(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v.startsWith("http://") || v.startsWith("https://") || v.startsWith("//");
}

/** Splitting on whitespace AND commas over-detects inside data: URIs that embed
 * an http URL — that direction fails safe (we block something local, never the
 * reverse). A per-candidate srcset parse can't miss a remote URL this way. */
function srcsetHasRemote(value: string): boolean {
  return value.split(/[\s,]+/).some(isRemoteUrl);
}

/** Drop only the style DECLARATIONS that reference a remote url() — `color: red;
 * background: url(https://…)` keeps its color. Declaration-level (not regex
 * surgery inside url()) so parens/commas in URLs can't mangle the survivors;
 * a data: URI's own `;`/`,` re-join verbatim since its parts never match. */
function stripRemoteStyle(el: Element, raw: string): void {
  const kept = raw.split(";").filter((decl) => !CSS_REMOTE_URL_RE.test(decl));
  if (kept.length === 0) el.removeAttribute("style");
  else el.setAttribute("style", kept.join(";"));
}

/**
 * Visit every remote-content reference in the parsed document; when `strip`,
 * neutralize it (remove the attribute / drop the remote url() token). Returns
 * how many refs were found — the reader uses the count to decide whether to
 * offer "Load images" at all.
 */
function walkRemoteRefs(doc: Document, strip: boolean): number {
  let count = 0;
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of REMOTE_FETCH_ATTRS) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const remote = attr === "srcset" ? srcsetHasRemote(value) : isRemoteUrl(value);
      if (remote) {
        count += 1;
        if (strip) el.removeAttribute(attr);
      }
    }
    const style = el.getAttribute("style");
    if (style && CSS_REMOTE_URL_RE.test(style)) {
      count += 1;
      if (strip) stripRemoteStyle(el, style);
    }
  });
  // <style> blocks can pull remote backgrounds/fonts — the CSP blocks the
  // fetch, so they only need counting (stripping would break local rules).
  doc.querySelectorAll("style").forEach((el) => {
    if (CSS_REMOTE_URL_RE.test(el.textContent ?? "")) count += 1;
  });
  // External stylesheets are never loadable under our style-src, but drop the
  // tags in blocked mode so nothing even attempts a preload.
  doc.querySelectorAll("link[href]").forEach((el) => {
    if (isRemoteUrl(el.getAttribute("href") ?? "")) {
      count += 1;
      if (strip) el.remove();
    }
  });
  return count;
}

/** How many remote-content refs an email body holds (0 = nothing to unblock). */
export function countRemoteRefs(rawHtml: string): number {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  return walkRemoteRefs(doc, false);
}

/** A fresh base64 CSP nonce so only OUR height script may execute. */
function scriptNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Reports the body's content height to the parent window. Measures the BODY
 * (not documentElement, whose scrollHeight is floored at the viewport) so the
 * parent can size the iframe down for short mails as well as up for long ones.
 */
function heightReporterJs(): string {
  return `(function () {
  var last = -1;
  function post() {
    var body = document.body;
    if (!body) return;
    var h = Math.max(body.scrollHeight, body.offsetHeight);
    if (h > 0 && h !== last) {
      last = h;
      // targetOrigin "*" is deliberate: the payload is a single integer, the
      // app window is never framed, and pinning the desktop's custom-scheme
      // origin (tauri://localhost) is unreliable in WKWebView targetOrigin
      // matching — a silent mismatch would kill auto-height entirely.
      parent.postMessage({ type: ${JSON.stringify(EMAIL_IFRAME_HEIGHT_MESSAGE)}, height: h }, "*");
    }
  }
  if (typeof ResizeObserver !== "undefined") {
    var ro = new ResizeObserver(post);
    ro.observe(document.documentElement);
    if (document.body) ro.observe(document.body);
  }
  window.addEventListener("load", post);
  setTimeout(post, 60);
  setTimeout(post, 300);
  setTimeout(post, 1000);
  post();
})();`;
}

/** How many sanitize → serialize → re-parse rounds before we give up on the HTML. */
const MAX_SANITIZE_PASSES = 4;

/**
 * One sanitize pass over a parsed email. Returns the remote-ref count.
 *
 * DOMParser parses with scripting off and never looks inside `template.content`,
 * while the allow-scripts frame parses with scripting on: a tag hidden in a
 * comment inside <noscript> or <template> here becomes a real element there.
 * So both elements and every comment go (MOD-574).
 */
function sanitizeOnce(doc: Document, blockRemote: boolean): number {
  doc.querySelectorAll("script, iframe, object, embed, noscript, template").forEach((node) => {
    node.remove();
  });
  const comments = doc.createTreeWalker(doc, NodeFilter.SHOW_COMMENT);
  const dropped: Node[] = [];
  while (comments.nextNode()) dropped.push(comments.currentNode);
  for (const node of dropped) node.parentNode?.removeChild(node);

  // A <meta http-equiv="refresh"> navigates the frame on open (the in-frame CSP
  // can't stop a self-navigation) and <base> retargets every relative URL, so
  // both go (MOD-574). Only a charset/content-type meta stays; ours leads anyway.
  doc.querySelectorAll("base, meta").forEach((node) => {
    const httpEquiv = node.getAttribute("http-equiv")?.trim().toLowerCase() ?? null;
    const charsetOnly = httpEquiv === null && node.hasAttribute("charset");
    if (node.localName === "meta" && (charsetOnly || httpEquiv === "content-type")) return;
    node.remove();
  });

  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of [...node.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) {
        node.removeAttribute(attr.name);
      }
    }
  });

  return walkRemoteRefs(doc, blockRemote);
}

const serialize = (doc: Document) =>
  `<head>${doc.head?.innerHTML ?? ""}</head><body>${doc.body?.innerHTML ?? ""}</body>`;

/** Plain text, escaped: what the reader shows for HTML that never settles. */
function textOnly(doc: Document): string {
  const text = (doc.body?.textContent ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<pre>${text}</pre>`;
}

/**
 * The reader-facing builder: the sanitized srcdoc AND the remote-ref count
 * (which drives the "Load images" bar). Sanitizing repeats on its own output
 * until a round trip changes nothing, because parse → serialize → parse can
 * build a different tree (the nested-form/math mutation trick); HTML that is
 * still changing after MAX_SANITIZE_PASSES is shown as plain text.
 */
export function buildEmailReaderDoc(
  rawHtml: string,
  options: EmailSrcDocOptions = {},
): { srcDoc: string; remoteCount: number } {
  const { blockRemote = true, autoHeight = false } = options;
  const parser = new DOMParser();
  let doc = parser.parseFromString(rawHtml, "text/html");
  const remoteCount = sanitizeOnce(doc, blockRemote);
  let html = serialize(doc);
  let settled = false;
  for (let pass = 1; pass < MAX_SANITIZE_PASSES; pass++) {
    doc = parser.parseFromString(html, "text/html");
    sanitizeOnce(doc, blockRemote);
    const next = serialize(doc);
    if (next === html) {
      settled = true;
      break;
    }
    html = next;
  }

  const csp = [
    "default-src 'none'",
    blockRemote ? "img-src data: cid:" : "img-src data: https: http: cid:",
    "style-src 'unsafe-inline'",
    blockRemote ? "font-src data:" : "font-src data: https: http:",
    blockRemote ? "media-src data:" : "media-src data: https: http:",
  ];

  let heightScript = "";
  if (autoHeight) {
    const nonce = scriptNonce();
    csp.push(`script-src 'nonce-${nonce}'`);
    heightScript = `<script nonce="${nonce}">${heightReporterJs()}</` + `script>`;
  }

  const headHtml = settled ? (doc.head?.innerHTML ?? "") : "";
  const bodyHtml = settled ? (doc.body?.innerHTML ?? "") : textOnly(doc);

  const srcDoc = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${csp.join("; ")};" />
  ${headHtml}
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #1f1f1f;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    body {
      padding: 16px;
    }
    img, video, table {
      max-width: 100%;
    }
    img, video {
      height: auto;
    }
    img:not([src]) {
      display: none;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    * {
      box-sizing: border-box;
    }
  </style>
</head>
<body>${bodyHtml}${heightScript}</body>
</html>`;

  return { srcDoc, remoteCount };
}

/** String-only convenience wrapper for legacy callers. */
export function buildEmailSrcDoc(rawHtml: string, options: EmailSrcDocOptions = {}): string {
  return buildEmailReaderDoc(rawHtml, options).srcDoc;
}
