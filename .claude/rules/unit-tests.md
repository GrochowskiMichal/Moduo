---
paths: ["apps/app/src/**/*.test.ts", "apps/app/src/**/*.test.tsx", "apps/app/rstest.setup.ts"]
incident: "A calendar hook test made live calls to prod's Supabase and failed bun run test once in seven runs (2026-10-08)"
expires: 2027-01-31
---

# App unit tests (Rstest + jsdom)

- **A test that mounts code calling `supabaseClient` directly talks to prod:** `runtime.web.client.ts` falls back to the prod URL and key when no env is set, and a late reply after jsdom's teardown kills the worker. Stub the client (`rs.spyOn(supabaseClient, "rpc")`) or route the call through the runtime the test fakes.
- **Fake timers fake `Date` too.** Model a throttled or sleeping timer with `rs.setSystemTime(Date.now() + ms)` then `rs.advanceTimersByTime(1000)`. Synchronous `advanceTimersByTime` runs no microtasks between timers: await only real promises in the code under test, or use `advanceTimersByTimeAsync`.
- **Rstest compiles `import.meta.env` to `process.env`**, where an unset variable is `undefined`; the bundle gets `""`. Stub it as `""` with `rs.stubEnv` to test a fallback (`lib/analytics.test.ts`).
- **`URL.createObjectURL` is stubbed for every jsdom test** in `apps/app/rstest.setup.ts`; don't stub it per file.
