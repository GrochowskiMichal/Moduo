// The legal pages are single-sourced from apps/landing: the build reads each page's <article>
// (and its title and description) so a legal edit lands on both sites at once. Comments, the old
// "next" footer and inline icons are dropped; the markup's own classes are styled in legal.css.
import aup from "../../../landing/aup.html?raw";
import dpa from "../../../landing/dpa.html?raw";
import privacy from "../../../landing/privacy.html?raw";
import terms from "../../../landing/terms.html?raw";

const sources = { privacy, terms, dpa, aup } as const;
export type LegalSlug = keyof typeof sources;

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Last, so "&amp;lt;" stays the text "&lt;".
    .replace(/&amp;/g, "&");

export function legalPage(slug: LegalSlug) {
  const html = sources[slug];
  const title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] ?? slug)
    .replace(/\s*[—|·-]\s*Moduo\s*$/i, "")
    .trim();
  const main = /<main[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] ?? "";
  // The page's own lede is its description (trimmed at a word for search results).
  const lede = decode(
    (/<p class="lede">([\s\S]*?)<\/p>/.exec(main)?.[1] ?? "").replace(/<[^>]+>/g, ""),
  )
    .replace(/\s+/g, " ")
    .trim();
  const description = lede.length > 158 ? `${lede.slice(0, lede.lastIndexOf(" ", 155))}…` : lede;
  const article = /<article[^>]*>([\s\S]*?)<\/article>/.exec(main)?.[1] ?? main;
  const clean = article
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<svg[\s\S]*?<\/svg>/g, "")
    .replace(/\s+id="page-title"/, ' id="legal-title"')
    .replace(/aria-labelledby="page-title"/g, 'aria-labelledby="legal-title"')
    // A company's form and a postal code never break across lines ("sp. / z o.o.", "00- / 193").
    .replace(/sp\. z o\.o\./g, "sp.\u00a0z\u00a0o.o.")
    .replace(/\b(\d{2}-\d{3}) /g, '<span class="nobr">$1</span>\u00a0');
  // The table of contents moves to the page's left rail; on phones it folds into a disclosure
  // where it stood, after the title and lede (head), before the clauses (rest).
  const tocHtml = /<nav class="toc"[\s\S]*?<\/nav>/.exec(clean)?.[0] ?? "";
  const at = tocHtml ? clean.indexOf(tocHtml) : clean.length;
  const head = clean.slice(0, at);
  const rest = clean.slice(at + tocHtml.length);
  // It leads the page in reading order, so its title is a label, not a heading before the h1.
  const toc = tocHtml.replace(
    /<h2 class="label"([^>]*)>([\s\S]*?)<\/h2>/,
    '<p class="label"$1>$2</p>',
  );
  const tocList = /<ol>[\s\S]*?<\/ol>/.exec(tocHtml)?.[0] ?? "";
  return { title, description, head, rest, toc, tocList };
}
