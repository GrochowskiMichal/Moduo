// Imported first in main.tsx: the URL must be clean before the router, or
// anything else, reads the location. See auth-url.ts.
import { scrubAuthCallbackFromUrl } from "./auth-url";

scrubAuthCallbackFromUrl();
