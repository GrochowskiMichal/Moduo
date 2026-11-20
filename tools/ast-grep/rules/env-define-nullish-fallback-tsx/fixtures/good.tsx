// Fixed shapes: nothing here may be reported.
export const host = (import.meta.env.PUBLIC_POSTHOG_HOST ?? "").trim() || "https://app.posthog.com";
export const key = import.meta.env.PUBLIC_POSTHOG_KEY || undefined;
