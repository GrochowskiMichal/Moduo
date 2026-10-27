// Fixed: the hosted web origin, never the webview's.
import { webOrigin } from "@/lib/web-origin";

export async function openBilling() {
  return portal(isDesktopShell() ? {} : { returnUrl: `${webOrigin()}/?billing=return` });
}
