import { fileURLToPath } from "node:url";

export default {
  plugins: {
    // Scan this app for class names, whichever directory the build runs from
    // (Storybook reuses this config from apps/storybook).
    "@tailwindcss/postcss": { base: fileURLToPath(new URL(".", import.meta.url)) },
  },
};
