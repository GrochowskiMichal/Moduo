export function buildEmailSrcDoc(rawHtml: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");

  doc.querySelectorAll("script, iframe, object, embed").forEach((node) => {
    node.remove();
  });

  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of [...node.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) {
        node.removeAttribute(attr.name);
      }
    }
  });

  const headHtml = doc.head?.innerHTML ?? "";
  const bodyHtml = doc.body?.innerHTML ?? rawHtml;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http: cid:; style-src 'unsafe-inline'; font-src data: https: http:; media-src data: https: http:;" />
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
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    * {
      box-sizing: border-box;
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
}
