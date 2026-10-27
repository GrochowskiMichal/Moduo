// Pre-fix shapes: every `@flag` line must be reported.
export const host =
  // @flag
  import.meta.env.PUBLIC_POSTHOG_HOST ?? "https://app.posthog.com";
