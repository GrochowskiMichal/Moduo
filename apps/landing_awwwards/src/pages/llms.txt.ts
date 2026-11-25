// llms.txt (llmstxt.org): the site in one plain file for language models and the tools that read
// it for people. Built from the same content as the pages, so it never drifts from them.
import type { APIRoute } from "astro";

import { families, pages, type PageSlug } from "../data/pages";
import { moduleOrder, modules, pricing, site } from "../data/site";
import { legalPage, type LegalSlug } from "../lib/legal";

const line = (href: string, name: string, text: string) =>
  `- [${name}](${new URL(href, site.url).href}): ${text}`;
const group = (slugs: readonly PageSlug[]) =>
  slugs.map((s) => line(pages[s].href, pages[s].label ?? pages[s].name, pages[s].short)).join("\n");

export const GET: APIRoute = () => {
  const plans = pricing.plans
    .map((p) =>
      p.id === "free"
        ? `${p.name}, free for one person`
        : `${p.name}, ${p.who.toLowerCase()}: ${p.monthly}${p.unit} billed monthly or ${p.yearly}${p.unit} billed yearly`,
    )
    .join("; ");
  const legal = (["privacy", "terms", "dpa", "aup"] as LegalSlug[])
    .map((slug) => line(`/${slug}`, legalPage(slug).title, legalPage(slug).description))
    .join("\n");
  const body = `# ${site.name}

> ${site.boilerplate} ${site.brandLine}

Moduo is in private beta: invites go out in waves from the waitlist on ${site.url}. It runs on Mac, Windows and the web; email runs in the desktop app. Assistants connect over MCP at https://mcp.moduo.app with access set per module (none, view or edit). Moduo trains no AI models. Plans: ${plans}. Prices in USD before tax; they are the planned launch prices.

## Modules

${moduleOrder.map((m) => line(`/${m}`, modules[m].name, modules[m].description)).join("\n")}

## Product

${group(families.product)}
${line("/pricing", "Pricing", pages.pricing.short)}

## Moduo for

${group(families.for)}

## Resources

${group(families.resources)}
${line("/changelog", "Changelog", pages.changelog.short)}

## Company

${group(families.company)}

## Optional

${legal}
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
};
