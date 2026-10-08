import { useRef, useState } from "react";

import { Eyebrow } from "@/components/ui/eyebrow";

export type EmailPreviewMode = "light" | "dark" | "text";

type EmailPreviewProps = {
  title: string;
  /** The rendered email HTML, already forced to the light or dark look. */
  html: string;
  text: string;
  mode: EmailPreviewMode;
};

/**
 * One email as a mail app would show it, for review in Storybook. The HTML is
 * the email's own document, so it renders in a sandboxed iframe: app CSS can't
 * leak into it, and its hex palette never touches the app's tokens.
 */
export function EmailPreview({ title, html, text, mode }: EmailPreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(480);

  // Narrowing the canvas re-wraps the email, so measure again whenever the
  // frame's width changes. A ref callback, so it attaches whenever the frame mounts.
  const observeFrame = (el: HTMLIFrameElement | null) => {
    frame.current = el;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const body = el.contentDocument?.body;
      if (body) setHeight(body.scrollHeight + el.offsetHeight - el.clientHeight);
    });
    observer.observe(el);
    return () => observer.disconnect();
  };

  const fitToContent = () => {
    const el = frame.current;
    const doc = el?.contentDocument;
    if (!el || !doc?.body) return;
    // The body, not the document (the document is never shorter than the frame),
    // plus the frame's own border, so no inner scrollbar appears.
    const measure = () => setHeight(doc.body.scrollHeight + el.offsetHeight - el.clientHeight);
    measure();
    // Geist arrives after load and changes line heights; measure again once it has.
    void doc.fonts?.ready.then(measure);
  };

  return (
    <figure className="m-0 flex w-full max-w-2xl flex-col gap-2">
      <figcaption>
        <Eyebrow>{title}</Eyebrow>
      </figcaption>
      {mode === "text" ? (
        <pre className="m-0 whitespace-pre-wrap rounded-lg border border-border bg-card p-6 font-mono text-sm text-foreground">
          {text}
        </pre>
      ) : (
        <iframe
          ref={observeFrame}
          title={title}
          srcDoc={html}
          // Same-origin so the frame can be measured; no scripts run inside it.
          sandbox="allow-same-origin"
          onLoad={fitToContent}
          className="w-full rounded-lg border border-border"
          style={{ height }}
        />
      )}
    </figure>
  );
}
