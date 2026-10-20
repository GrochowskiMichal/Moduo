import { fileURLToPath } from "node:url";

// The app itself builds Tailwind through @rsbuild/plugin-tailwindcss; Storybook
// runs on Vite, which needs PostCSS. Scan apps/app for class names.
export default {
  plugins: {
    "@tailwindcss/postcss": { base: fileURLToPath(new URL("../app", import.meta.url)) },
  },
};
