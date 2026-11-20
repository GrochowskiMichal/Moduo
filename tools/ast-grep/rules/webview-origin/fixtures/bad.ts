// Pre-fix shape: the webview's origin sent to Stripe as a return URL.
export async function openBilling() {
  // @flag
  const returnUrl = `${window.location.origin}/?billing=return`;
  return portal({ returnUrl });
}
