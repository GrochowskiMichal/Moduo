/**
 * The link a guest can open. The app itself is served from app.moduo.app /
 * app.staging.moduo.app; the address people forward is the public site.
 * Local dev stays on the dev server.
 */
export function bookingPublicOrigin(location: { hostname: string; origin: string }): string {
  const host = location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") return location.origin;
  if (host.includes("staging")) return "https://staging.moduo.app";
  return "https://moduo.app";
}

export function bookingPublicUrl(
  slug: string,
  location: { hostname: string; origin: string },
): string {
  return `${bookingPublicOrigin(location)}/book/${slug}`;
}
