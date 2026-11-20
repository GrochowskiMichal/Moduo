/**
 * Founder promotion codes (MOD-583), kept free of esm.sh imports so the
 * backend tests can load it.
 *
 * A founder code is a 100%-off-forever coupon, so it must be unguessable and
 * usable by its recipient only: 16 characters from `crypto.getRandomValues`
 * (80 bits), nothing taken from the email, and the promotion code is bound to
 * the recipient's own Stripe customer, so it does nothing in anyone else's
 * Checkout.
 */

/** No 0/O or 1/I: the code is read out of an email and typed. 32 symbols, so a byte maps without bias. */
export const FOUNDER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const FOUNDER_CODE_LENGTH = 16;
export const FOUNDER_CODE_PREFIX = "FOUNDERS-";

export function founderPromoCode(
  fill: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  const bytes = fill(new Uint8Array(FOUNDER_CODE_LENGTH));
  let suffix = "";
  for (const b of bytes) suffix += FOUNDER_CODE_ALPHABET[b & 31];
  return FOUNDER_CODE_PREFIX + suffix;
}

/** A Stripe customer as `customers.list({ email })` answers it. */
export type FounderCustomerCandidate = {
  id: string;
  metadata?: Record<string, string> | null;
};

/**
 * The recipient's own customer: one Moduo made for their account (it carries
 * `supabase_user_id`, as getOrCreateCustomer sets it) and that the account
 * still points at (`profiles.stripe_customer_id`). Null when they have none
 * yet (no account, or never started a trial): then no code is issued.
 */
export function founderCustomerId(
  candidates: readonly FounderCustomerCandidate[],
  profiles: readonly { id: string; stripe_customer_id: string | null }[],
): string | null {
  for (const c of candidates) {
    const uid = c.metadata?.supabase_user_id;
    if (!uid) continue;
    if (profiles.some((p) => p.id === uid && p.stripe_customer_id === c.id)) return c.id;
  }
  return null;
}
