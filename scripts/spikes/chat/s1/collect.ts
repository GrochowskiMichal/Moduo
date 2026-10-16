// CV-0 spike 1: the results collector. The harness page POSTs one JSON per
// library; this writes results/<engine>.json (libraries merged by name).
//   bun scripts/spikes/chat/s1/collect.ts [port]   (default 8392)
// GET /status → { "<engine>": ["tanstack", …] } for the runners to poll.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 8392);
const dir = fileURLToPath(new URL("./results", import.meta.url));
mkdirSync(dir, { recursive: true });
const received: Record<string, string[]> = {};

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

type Payload = { engine: string; lib: string; fingerprint: unknown; results: unknown[] };

createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors).end();
    return;
  }
  if (req.method === "GET" && req.url === "/status") {
    res
      .writeHead(200, { ...cors, "content-type": "application/json" })
      .end(JSON.stringify(received));
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(404, cors).end();
    return;
  }
  let text = "";
  req.on("data", (chunk) => {
    text += chunk;
  });
  req.on("end", () => {
    const parsed = JSON.parse(text) as Payload | { progress: string; engine: string };
    if ("progress" in parsed) {
      console.log(`[progress] ${parsed.engine}: ${parsed.progress}`);
      res.writeHead(200, cors).end("ok");
      return;
    }
    const body = parsed;
    const engine = body.engine.replace(/[^a-z0-9-]/gi, "_");
    const file = join(dir, `${engine}.json`);
    const doc = existsSync(file)
      ? (JSON.parse(readFileSync(file, "utf8")) as {
          engine: string;
          libs: Record<string, unknown>;
        })
      : { engine, libs: {} as Record<string, unknown> };
    doc.libs[body.lib] = {
      at: new Date().toISOString(),
      fingerprint: body.fingerprint,
      results: body.results,
    };
    writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    received[engine] = [...new Set([...(received[engine] ?? []), body.lib])];
    console.log(`[collect] ${engine}/${body.lib}: ${body.results.length} results → ${file}`);
    res.writeHead(200, cors).end("ok");
  });
}).listen(port, "127.0.0.1", () => console.log(`[collect] listening on http://127.0.0.1:${port}`));
