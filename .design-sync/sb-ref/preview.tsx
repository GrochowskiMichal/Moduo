// Preview used ONLY to build the design-sync reference oracle (storybook build).
// It loads global.css + fonts (which the providers-only sb-config/preview omits
// so the converter's esbuild decorator bundle doesn't choke on .woff2), then
// re-exports the real decorator chain unchanged.
import "@/global.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";

export { default } from "../sb-config/preview";
