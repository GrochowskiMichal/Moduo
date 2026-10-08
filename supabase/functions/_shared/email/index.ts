/**
 * The Moduo email kit (specs/transactional-email.md TX-1). Edge Functions
 * import from here relatively; app code, tests and Storybook use `@email/*`.
 * The example data lives in `templates/fixtures.ts`, imported directly by
 * tests and Storybook so it never ships in a function bundle.
 */

export * from "./assets.ts";
export * from "./blocks.ts";
export * from "./format.ts";
export * from "./ics.ts";
export * from "./palette.ts";
export * from "./render.ts";
export * from "./send.ts";
export * from "./templates/index.ts";
