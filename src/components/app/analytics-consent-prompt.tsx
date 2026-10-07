import { useEffect } from "react";
import { toast } from "sonner";

import {
  type AnalyticsConsent,
  isAnalyticsAvailable,
  setAnalyticsConsent,
  useAnalyticsConsent,
} from "../../lib/analytics";
import { useAuth } from "../../providers/auth-provider";
import { Button } from "../ui/button";

export const ANALYTICS_CONSENT_TOAST_ID = "analytics-consent";
/** Let the app settle first, so the question never lands on the first paint. */
export const ANALYTICS_CONSENT_ASK_DELAY_MS = 2000;
const PRIVACY_URL = "https://moduo.app/privacy#analytics";

// The delay applies once per session. A later remount of the shell (boot churn, a
// workspace switch) puts the question straight back instead of waiting again.
let askedThisSession = false;

/**
 * The one-time analytics question, asked after sign-in (lib/analytics.ts). It shows
 * only in builds with a PostHog key, never under Do Not Track, and only until this
 * person answers on this device. Both answers carry the same weight, and either one
 * can be changed later in Settings → Preferences → Privacy. Rendered through the
 * toaster so it stacks with toasts instead of covering them.
 */
export function AnalyticsConsentPrompt() {
  const { userId, runtime } = useAuth();
  const consent = useAnalyticsConsent(userId);
  const shouldAsk = userId !== null && consent === null && isAnalyticsAvailable();

  useEffect(() => {
    if (!shouldAsk || userId === null) return;
    const choose = (choice: AnalyticsConsent) => {
      toast.dismiss(ANALYTICS_CONSENT_TOAST_ID);
      void setAnalyticsConsent(userId, choice);
    };
    // Desktop hands links to the system browser; a webview can't follow them out.
    const openPolicy = runtime
      ? () => {
          void runtime.window.openExternalUrl(PRIVACY_URL);
        }
      : undefined;
    const timer = setTimeout(
      () => {
        askedThisSession = true;
        toast.custom(() => <AnalyticsConsentCard onChoose={choose} onOpenPolicy={openPolicy} />, {
          id: ANALYTICS_CONSENT_TOAST_ID,
          duration: Number.POSITIVE_INFINITY,
          dismissible: false,
        });
      },
      askedThisSession ? 0 : ANALYTICS_CONSENT_ASK_DELAY_MS,
    );
    return () => {
      clearTimeout(timer);
      toast.dismiss(ANALYTICS_CONSENT_TOAST_ID);
    };
  }, [shouldAsk, userId, runtime]);

  return null;
}

export function AnalyticsConsentCard({
  onChoose,
  onOpenPolicy,
}: {
  onChoose: (choice: AnalyticsConsent) => void;
  /** Opens the policy outside the app (desktop). Without it the link opens a new tab. */
  onOpenPolicy?: () => void;
}) {
  return (
    <fieldset
      aria-labelledby="analytics-consent-title"
      className="flex w-full min-w-0 flex-col gap-3 rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-lg"
    >
      <div className="flex flex-col gap-1">
        <p id="analytics-consent-title" className="font-display text-sm font-medium">
          Help us improve Moduo?
        </p>
        <p className="text-xs text-muted-foreground">
          Share usage analytics: events like opening the app, with basic device and browser details.
          They carry your account ID, never your email or anything you write. You can change this
          any time in Settings → Preferences.
        </p>
      </div>
      <div className="flex items-center justify-between gap-2">
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            if (!onOpenPolicy) return;
            event.preventDefault();
            onOpenPolicy();
          }}
          className="rounded-sm text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Privacy policy
        </a>
        {/* Same weight on purpose: saying no is as easy as saying yes. */}
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => onChoose("denied")}>
            Don't share
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onChoose("granted")}>
            Share
          </Button>
        </div>
      </div>
    </fieldset>
  );
}
