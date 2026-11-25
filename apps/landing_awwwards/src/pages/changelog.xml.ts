// The changelog as an RSS feed (/changelog.xml): one item per release, newest first, in the
// words of the app's What's new, linked to its section on /changelog.
import type { APIRoute } from "astro";

import releasesJson from "../../../../release-notes/releases.json";
import { changelogReleases } from "../../../landing/changelog.mjs";
import { site } from "../data/site";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LABEL: Record<string, string> = { new: "New", improved: "Improved", fixed: "Fixed" };

export const GET: APIRoute = () => {
  const releases = changelogReleases(releasesJson).slice(0, 40);
  const items = releases.map(
    (r: { version: string; date: string; items?: { type: string; text: string }[] }) => {
      const id = `v${r.version.replace(/[^0-9a-z]+/gi, "-")}`;
      const link = `${site.url}/changelog#${id}`;
      const notes = (r.items ?? [])
        .filter((i) => i?.text?.trim())
        .map((i) => `<li>${LABEL[i.type] ? `${LABEL[i.type]}: ` : ""}${esc(i.text.trim())}</li>`)
        .join("");
      const [y, m, d] = r.date.split("-").map(Number);
      return [
        "    <item>",
        `      <title>Moduo ${esc(r.version)}</title>`,
        `      <link>${link}</link>`,
        `      <guid isPermaLink="true">${link}</guid>`,
        `      <pubDate>${new Date(Date.UTC(y, m - 1, d, 12)).toUTCString()}</pubDate>`,
        `      <description>${esc(notes ? `<ul>${notes}</ul>` : "<p>Reliability improvements.</p>")}</description>`,
        "    </item>",
      ].join("\n");
    },
  );
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Moduo changelog</title>
    <link>${site.url}/changelog</link>
    <atom:link href="${site.url}/changelog.xml" rel="self" type="application/rss+xml" />
    <description>Every Moduo release, newest first, in the same words as the app’s What’s new.</description>
    <language>en-us</language>
${items.join("\n")}
  </channel>
</rss>
`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
};
