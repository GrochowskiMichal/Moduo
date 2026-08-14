/**
 * Build the URL that redirects a freshly-authed user to Stripe Checkout for a
 * pending plan. A top-level browser redirect can't carry an Authorization
 * header, so the session access_token rides as a query param that
 * create-checkout-session's in-code auth reads (deployed with verify_jwt=false).
 */
export function checkoutRedirectUrl(priceId: string, accessToken: string | null): string {
  const supabaseUrl =
    (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
    "https://wtoonrvuqumihpkbvwvs.supabase.co";
  const query = new URLSearchParams();
  query.set("price_id", priceId);
  if (accessToken) query.set("access_token", accessToken);
  return `${supabaseUrl}/functions/v1/create-checkout-session?${query.toString()}`;
}
