// CV-0 spike 1: the rows. Compiled by the React Compiler like any app
// component (only the stream file opts out): a row takes its row object and
// nothing else, so an unchanged row is skipped.

import { useEffect, useState } from "react";
import { AUTHORS } from "./fixture";
import { imageBox, type Row } from "./model";

function initials(name: string): string {
  const [a = "", b = ""] = name.split(" ");
  return `${a.charAt(0)}${b.charAt(0)}`;
}

function time(at: number): string {
  return new Date(at).toISOString().slice(11, 16);
}

/** A stand-in preview, decoded late (the box must not move when it lands). */
function previewSrc(w: number, h: number, seed: number): string {
  const hue = (seed * 47) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 40% 40%)"/><stop offset="1" stop-color="hsl(${(hue + 60) % 360} 40% 25%)"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function Preview({ w, h, seed }: { w: number; h: number; seed: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setSrc(previewSrc(w, h, seed)), 120);
    return () => clearTimeout(id);
  }, [w, h, seed]);
  const box = imageBox({ w, h });
  // The box's size travels as two custom properties; under
  // [data-imgbox="css"] the stylesheet sizes the image from them, otherwise
  // only the width/height attributes reserve it.
  return (
    <div className="s1-image" ref={sizeVars(box)}>
      {src ? (
        <img src={src} width={box.w} height={box.h} alt="" decoding="async" />
      ) : (
        <div className="s1-image-wait" />
      )}
    </div>
  );
}

/** The stored size, as custom properties the stylesheet reads. */
function sizeVars(box: { w: number; h: number }) {
  return (el: HTMLDivElement | null) => {
    if (!el) return;
    el.style.setProperty("--s1-w", `${box.w}px`);
    el.style.setProperty("--s1-h", `${box.h}px`);
  };
}

function Body({ row }: { row: Extract<Row, { type: "msg" | "chain" }> }) {
  const msg = row.msg;
  const text = row.extra ? `${msg.text}${row.extra}` : msg.text;
  return (
    <>
      {msg.kind === "code" ? (
        <pre className="s1-code">{text}</pre>
      ) : text ? (
        <div className="s1-text">{text}</div>
      ) : null}
      {msg.img ? <Preview w={msg.img.w} h={msg.img.h} seed={msg.seq} /> : null}
      {row.extra ? <span className="s1-edited">(edited)</span> : null}
      {row.type === "chain" ? (
        <div className="s1-chain">{row.replies} replies · folded</div>
      ) : msg.replies ? (
        <div className="s1-chain-open">{msg.replies} replies</div>
      ) : null}
    </>
  );
}

export function RowView({ row }: { row: Row }) {
  if (row.type === "day") {
    return (
      <div className="s1-day" data-day={row.key}>
        <span>{row.label}</span>
      </div>
    );
  }
  const name = AUTHORS[row.msg.author] as string;
  return (
    <div
      className="s1-msg"
      data-first={row.first ? "" : undefined}
      data-reply={row.msg.root ? "" : undefined}
      data-kind={row.msg.kind}
      data-day={`d:${new Date(row.msg.at).toISOString().slice(0, 10)}`}
    >
      {row.first ? (
        <div className={`s1-avatar s1-c${row.msg.author}`} aria-hidden="true">
          {initials(name)}
        </div>
      ) : (
        <div className="s1-gutter" />
      )}
      <div className="s1-main">
        {row.first ? (
          <div className="s1-meta">
            <span className="s1-name">{name}</span>
            <span className="s1-time">{time(row.msg.at)}</span>
          </div>
        ) : null}
        <Body row={row} />
      </div>
    </div>
  );
}
