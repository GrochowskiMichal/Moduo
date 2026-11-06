// Send-as aliases with per-alias signatures (E39/E40, AC23). The signature
// lives in a marked block so switching From swaps only it, never your text.

export type MailAlias = {
  id: string;
  accountId: string;
  address: string;
  name: string;
  isDefault: boolean;
  signatureHtml: string;
};

const SIG_OPEN = '<div data-moduo-signature="">';
const SIG_RE = /<div data-moduo-signature="">[\s\S]*?<\/div><!--\/sig-->/;

export function signatureBlock(signatureHtml: string): string {
  return signatureHtml.trim() ? `${SIG_OPEN}${signatureHtml}</div><!--/sig-->` : "";
}

/** The alias to send from: one the original was addressed to, else the account default. */
export function pickAlias(
  aliases: MailAlias[],
  accountId: string,
  addressedTo: string[] = [],
): MailAlias | null {
  const mine = aliases.filter((a) => a.accountId === accountId);
  const to = new Set(addressedTo.map((a) => a.toLowerCase()));
  return (
    mine.find((a) => to.has(a.address.toLowerCase())) ??
    mine.find((a) => a.isDefault) ??
    mine[0] ??
    null
  );
}

/**
 * A compose opens from its alias (specs/mail-v3.md §9): the one the original was
 * addressed to, else the account's default, with that alias's signature inserted.
 * Without aliases for the account the spec is unchanged.
 */
export function openWithAlias<
  T extends { accountId: string; fromAddr: string; fromName: string | null; bodyHtml: string },
>(spec: T, aliases: readonly MailAlias[], addressedTo: string[] = []): T {
  const alias = pickAlias([...aliases], spec.accountId, addressedTo);
  if (!alias) return spec;
  return {
    ...spec,
    fromAddr: alias.address,
    fromName: alias.name || spec.fromName,
    bodyHtml: swapSignature(spec.bodyHtml, alias),
  };
}

/** Replaces the signature block (or appends one) with the new alias's signature. */
export function swapSignature(html: string, next: MailAlias | null): string {
  const block = signatureBlock(next?.signatureHtml ?? "");
  if (SIG_RE.test(html)) return html.replace(SIG_RE, block);
  if (!block) return html;
  const quote = html.indexOf("<blockquote");
  return quote >= 0 ? html.slice(0, quote) + block + html.slice(quote) : html + block;
}
