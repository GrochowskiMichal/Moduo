// Starter lab config (see the product-lab skill, references/config.md). Every TODO needs a
// real answer before the lab's evidence means anything. Seeded test data only: the lab
// screenshots everything it sees.
export default {
  purpose: "TODO: what the product is for, in one line",
  users: "TODO: who uses it and how often",
  platform: "web", // macos-desktop | windows-desktop | web | web-mobile
  primaryTheme: "light",

  baseURL: "http://127.0.0.1:4173",
  // TODO: the command that serves a production build (never a dev server)
  server: { command: "npm run build && npx vite preview --port 4173", timeout: 180000 },

  viewport: { width: 1440, height: 900 },
  windows: [
    [1024, 700],
    [1440, 900],
    [1920, 1080],
  ],
  themes: ["light", "dark"],

  tokens: { files: [/* TODO: "src/styles/tokens.css" */], exclude: [] },

  async setup() {
    // TODO: create a test person and seed realistic data; return what auth() needs
    return {};
  },
  async auth({ context, page, seed, variant }) {
    // TODO: sign the page in (storage state, a login form, or a session cookie)
  },

  screens: [
    {
      id: "home",
      title: "Home",
      path: "/",
      ready: "main",
      states: { default: {} },
    },
  ],

  journeys: [
    // {
    //   id: "create-item",
    //   screen: "home",
    //   goal: "Create a new item and see it in the list",
    //   target: { keys: 12, clicks: 2 },
    //   async keyboard({ press, type, step }) {},
    //   async pointer({ click, type, step }) {},
    // },
  ],

  overlays: [],
};
