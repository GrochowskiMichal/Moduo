import path from "node:path";
import fs from "node:fs";
import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";

function readLocalEnvValue(name: string): string {
  const localPath = path.resolve(__dirname, ".env.local");
  if (!fs.existsSync(localPath)) return "";
  const text = fs.readFileSync(localPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key !== name) continue;
    const value = line.slice(idx + 1).trim().replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
    return value;
  }
  return "";
}

const alphaVantageKey = readLocalEnvValue("PUBLIC_ALPHA_VANTAGE_API_KEY");
const finnhubKey = readLocalEnvValue("PUBLIC_FINNHUB_API_KEY");
const marketstackKey = readLocalEnvValue("PUBLIC_MARKETSTACK_API_KEY");

export default defineConfig({
  plugins: [pluginReact()],
  source: {
    entry: {
      index: "./src/main.tsx",
    },
    define: {
      "import.meta.env.PUBLIC_ALPHA_VANTAGE_API_KEY": JSON.stringify(alphaVantageKey),
      "import.meta.env.PUBLIC_FINNHUB_API_KEY": JSON.stringify(finnhubKey),
      "import.meta.env.PUBLIC_MARKETSTACK_API_KEY": JSON.stringify(marketstackKey),
      "globalThis.__PUBLIC_ALPHA_VANTAGE_API_KEY__": JSON.stringify(alphaVantageKey),
      "globalThis.__PUBLIC_FINNHUB_API_KEY__": JSON.stringify(finnhubKey),
      "globalThis.__PUBLIC_MARKETSTACK_API_KEY__": JSON.stringify(marketstackKey),
    },
  },
  html: {
    template: "./index.html",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 8081,
    strictPort: true,
  },
  output: {
    distPath: {
      root: "dist",
    },
  },
});
