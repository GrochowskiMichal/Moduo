# moduo.app, the product site

A static Astro site for Moduo: the home page, one page per module, pricing, the manifesto, the
changelog, the colophon, the typeface page (`/modus`), the legal pages and a designed 404. Every
word is set in Modus, Moduo's own typeface (`public/fonts/modus-300_700.woff2`). The design record (brief, concept, system) is in
[DESIGN.md](./DESIGN.md).

## Run it

From the repo root (Bun workspaces), or from this folder:

```bash
bun run --cwd apps/landing_awwwards dev
```

Dev server on http://127.0.0.1:4321. A production build and a local preview:

```bash
bun run --cwd apps/landing_awwwards build
```

```bash
bun run --cwd apps/landing_awwwards preview
```

## Where things live

| What | Where |
| --- | --- |
| Every visible string, prices, FAQ, module copy | `src/data/site.ts` |
| Colors, type scale, spacing, motion tokens | `src/styles/tokens.css` |
| The stroke geometry (the mark's stroke, chains, windows) | `src/lib/stroke.ts` |
| The signature scroll scene (one driver) | `src/motion/interlock.ts` + `src/components/home/Scene.astro` |
| The home hero, First light (the Osaka clip, the glass stroke in depth; raw WebGL) | `src/lib/first-light.ts` (placement, shader) + `src/motion/first-light.ts` (driver) |
| The hero's clip, its sun track, its first frame | `public/hero/osaka-office{,-720}.{webm,mp4}`, `src/data/first-light-sun.json`, `public/hero/osaka-office.webp`, made by `bun scripts/first-light-video.ts <clip.mp4>` (needs `ffmpeg`, `cwebp`) |
| The hero's stills (reduced motion, no WebGL) | `public/hero/first-light-{wide,narrow}.webp`, rendered by `bun scripts/first-light-poster.ts` |
| The motion engine (lifecycle, Lenis on the GSAP ticker, transitions) | `src/engine/` |
| Product pictures (stylized, not screenshots) | `src/components/frames/` |
| Share images | `public/og/*.png`, rendered by `bun run og` from `src/pages/og/[slug].astro` |
| The typeface's outlines (type page, footer plate, share card) | `src/data/modus/*.json`, written by `node scripts/modus-data.mjs` from the Modus UFO masters; read through `src/lib/modus.ts` |
| The type page's 3D name (one driver, raw WebGL) | `src/motion/modus-hero.ts` + `src/components/modus/Hero.astro` |

Checks: `bun run --cwd apps/landing_awwwards typecheck` (also part of the root `bun run verify`),
and the root `bun run lint:js` covers this folder's TypeScript.

Single-sourced from the rest of the repo at build time, so nothing is copied by hand:

- the logo artwork from `brand/exports/svg/` (`src/lib/brand.ts`),
- the legal pages from `apps/landing/{privacy,terms,dpa,aup}.html` (`src/lib/legal.ts`),
- the changelog from `release-notes/releases.json`, ordered by `apps/landing/changelog.mjs`.

## Deploy

moduo.app is this site. `apps/landing/build.mjs` builds it into `apps/landing/dist`, and the
landing Worker there (with the `/book` router) is what ships: PR previews (`landing-preview.yml`),
staging after `checks` on develop (`landing-deploy.yml`, home at `/landing`), and production from a
`/release` release tag (`_deploy-web.yml`).

## Waitlist and analytics

The forms post to the `waitlist-join` Edge Function (sources `nav`, `hero`, `close`), whose origin
allowlist covers `moduo.app`. A preview on another host gets a 403 until that host is added there.
PostHog (the current landing's EU project) loads only after a visitor accepts the cookie card,
never on a local host. The card is asked once the first screen is behind the visitor, never when
the browser sends Do Not Track, and opens again from Cookie settings or `/#cookie-settings` (the
privacy policy's link).

## Deploy

Cloudflare Workers static assets, like `apps/landing` (`wrangler.jsonc`, `public/_headers`). It is
not wired to a workflow. A private, never-indexed preview:

```bash
bun run --cwd apps/landing_awwwards build:preview
```

```bash
cd apps/landing_awwwards && bunx wrangler deploy --env preview
```

Moving moduo.app over means carrying `apps/landing/wrangler.jsonc`'s production env (custom
domain, the `/book` and `/static` routes to the app Worker) into this Worker first.
