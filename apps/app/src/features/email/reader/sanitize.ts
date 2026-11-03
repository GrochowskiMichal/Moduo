// Reader HTML policy (MR-10, AC15; decision 9). Wraps the reviewed two-layer
// sanitizer (utils/email-html.ts: DOM strip + nonce CSP in a sandbox frame)
// with the images setting, the tracker shield and a stable per-message nonce.
//
// Trackers are stripped BEFORE the images decision, so "Load images" never
// fires a known pixel while tracker blocking is on (X7).

import { buildEmailReaderDoc } from "../utils/email-html";

/** Settings → Mail → Remote images (S4). */
export type ImagesPolicy = "block" | "contacts" | "always";

export type ReaderImagesInput = {
  policy: ImagesPolicy;
  /** The sender is a Moduo contact (for "contacts"). */
  senderIsContact: boolean;
  /** Per-sender "Always load" list hit. */
  senderAllowed: boolean;
  /** Per-message "Load images" was clicked. */
  loadedForMessage: boolean;
};

/** Hosts whose images exist only to report opens (substring match on host). */
export const TRACKER_HOSTS = [
  "list-manage.com",
  "mailchimp.com",
  "sendgrid.net",
  "mandrillapp.com",
  "mailgun.org",
  "hubspot.com",
  "hs-analytics.net",
  "hubspotlinks.com",
  "mixpanel.com",
  "customer.io",
  "klaviyo.com",
  "exacttarget.com",
  "sparkpostmail.com",
  "mailtrack.io",
  "getnotify.com",
  "bananatag.com",
  "yesware.com",
  "streak.com",
  "superhuman.com",
  "mailsuite.com",
  "track.",
  "pixel.",
  "open.",
] as const;

export function shouldLoadImages(input: ReaderImagesInput): boolean {
  if (input.loadedForMessage || input.senderAllowed) return true;
  if (input.policy === "always") return true;
  if (input.policy === "contacts") return input.senderIsContact;
  return false;
}

function hostOf(src: string): string | null {
  try {
    const url = new URL(src.startsWith("//") ? `https:${src}` : src);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isTinyDimension(v: string | null): boolean {
  if (v === null) return false;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) && n <= 1;
}

function isTracker(img: Element): boolean {
  const src = img.getAttribute("src") ?? "";
  const host = hostOf(src.trim());
  if (!host) return false;
  if (
    TRACKER_HOSTS.some((t) =>
      t.endsWith(".") ? host.startsWith(t) : host === t || host.endsWith(`.${t}`),
    )
  ) {
    return true;
  }
  const style = (img.getAttribute("style") ?? "").replace(/\s+/g, "").toLowerCase();
  const tinyStyle =
    /(?:^|;)width:[01](?:px)?(?:;|$)/.test(style) && /(?:^|;)height:[01](?:px)?(?:;|$)/.test(style);
  const tinyAttr =
    isTinyDimension(img.getAttribute("width")) && isTinyDimension(img.getAttribute("height"));
  const hidden = /display:none|visibility:hidden/.test(style);
  return tinyAttr || tinyStyle || hidden;
}

/** Removes tracking images; returns the cleaned HTML and how many went. */
export function stripTrackers(rawHtml: string): { html: string; trackers: number } {
  const doc = new DOMParser().parseFromString(rawHtml, "text/html");
  let trackers = 0;
  doc.querySelectorAll("img").forEach((img) => {
    if (isTracker(img)) {
      trackers += 1;
      img.remove();
    }
  });
  if (trackers === 0) return { html: rawHtml, trackers };
  return {
    html: `<!doctype html><head>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body>`,
    trackers,
  };
}

// One nonce per message for the session: random (an email's author can read
// its own headers, so nothing is derived from them), reused across re-renders.
const nonces = new Map<string, string>();
const MAX_NONCES = 500;

export function messageNonce(messageId: string): string {
  const hit = nonces.get(messageId);
  if (hit) return hit;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  if (nonces.size >= MAX_NONCES) {
    const oldest = nonces.keys().next().value;
    if (oldest !== undefined) nonces.delete(oldest);
  }
  nonces.set(messageId, nonce);
  return nonce;
}

export type ReaderDoc = {
  srcDoc: string;
  /** Remote refs still blocked (0 = no images bar). */
  remoteBlocked: number;
  /** Trackers stripped (the shield's count). */
  trackers: number;
  imagesLoaded: boolean;
  nonce: string;
};

export function buildReaderDoc(
  messageId: string,
  rawHtml: string,
  images: ReaderImagesInput,
  trackerBlocking = true,
): ReaderDoc {
  const { html, trackers } = trackerBlocking
    ? stripTrackers(rawHtml)
    : { html: rawHtml, trackers: 0 };
  const imagesLoaded = shouldLoadImages(images);
  const nonce = messageNonce(messageId);
  const { srcDoc, remoteCount } = buildEmailReaderDoc(html, {
    blockRemote: !imagesLoaded,
    autoHeight: true,
    nonce,
  });
  return { srcDoc, remoteBlocked: imagesLoaded ? 0 : remoteCount, trackers, imagesLoaded, nonce };
}
