// Structured data (JSON-LD) the inner pages hand to Base.astro, which adds the Organization. Plain
// functions, built at render time. Prices and platforms come from the content files, never typed
// here twice.
import { pricing, site } from "../data/site";

type Ld = Record<string, unknown>;

/** Breadcrumbs from the home page down: [name, root-relative path] pairs, home excluded. */
export function crumbs(...items: [string, string][]): Ld {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [["Moduo", "/"] as [string, string], ...items].map(([name, path], i) => ({
      "@type": "ListItem",
      position: i + 1,
      name,
      item: new URL(path, site.url).href,
    })),
  };
}

/** Questions and answers shown on the page, word for word. */
export function faq(items: readonly { q: string; a: string }[]): Ld {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

/** A how-to the page walks through, step for step. */
export function howTo(
  name: string,
  steps: readonly { title: string; text: string }[],
  description?: string,
): Ld {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    ...(description ? { description } : {}),
    step: steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.title,
      text: s.text,
    })),
  };
}

/** Moduo as an application: where it runs and what it costs (the plans' yearly prices). */
export function app(): Ld {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: site.name,
    url: site.url,
    description: site.boilerplate,
    applicationCategory: "BusinessApplication",
    operatingSystem: "macOS, Windows, Web",
    offers: pricing.plans.map((p) => ({
      "@type": "Offer",
      name: p.name,
      price: p.yearly.replace("$", ""),
      priceCurrency: "USD",
      description: p.who,
    })),
  };
}
