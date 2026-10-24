# The reference ladder

A set of open-source product apps, run locally with seed data, that the critic must put in the
same order as a designer before its absolute levels mean anything. Read `calibration.md` first:
the planted-defect procedure there is cheaper and has a known answer, so run it before this.

## Why matched domains and wide gaps

Model judges pick the better of two screens at near chance when the quality gap is small, flip
on superficial differences, and favour one position. So rungs must be:

- **matched by domain** (tasks against tasks, chat against chat), so a pair compares craft, not
  what the app does;
- **far apart in quality**, since only wide gaps are judged reliably;
- **captured the same way** (same lab version, window size, theme, data density, engine);
- **compared in both orders**, counting only verdicts that hold in both.

A passed ladder certifies coarse ordering, nothing finer.

## Rungs (proposed order; a hypothesis until the designer confirms it blind)

| Track | High | Mid | Low |
|---|---|---|---|
| Tasks and projects | Kan.bn; Gigabugs (zbugs) read-only demo | Plane | OpenProject; Kanboard |
| Docs and notes | Outline (reputation unsourced) | Docmost | |
| Chat | | Mattermost | Zulip |
| CRM | Twenty | Atomic CRM (public demo) | |
| Anchors (cross-domain, count little) | Excalidraw; tldraw | | |
| The app itself | current build | | `--ablate level1..3` of the same build |

The ordering comes mostly from launch-era public comments and one 2026 review. No designer has
checked it on the 2026 builds. Before a ladder run counts, the designer orders each track's
rungs blind and pairwise, on the same captures, and that order replaces this table.

## How to run each rung

| App | Run locally | Seed | Sign-in |
|---|---|---|---|
| Twenty | Docker Compose, or the contributor setup | `npx nx database:reset twenty-server` | `tim@apple.dev` / `tim@apple.dev` |
| Plane | Docker Compose (Postgres, Redis, RabbitMQ, S3-compatible storage) | built-in workspace seed task | local account |
| Kan.bn | `docker compose up -d` | none: write a small seed through its API | email sign-in (Better Auth) |
| Outline | its repo's `.claude/skills/verify-outline` launches an isolated production build | none: its `setup-workspace.mjs` journey creates the workspace; add content through the API | local workspace |
| Docmost | Docker | none found: seed through its API | local account |
| Mattermost | Docker | `mmctl sampledata -u 60 --local` | seeded users |
| Zulip | official dev environment | `tools/rebuild-dev-database` (`populate_db`) | seeded users |
| OpenProject | Docker all-in-one image | demo data seeder (on by default) | local admin |
| Kanboard | single PHP app on SQLite | none: script it | local admin |
| Atomic CRM | public demo, or `npm` locally | demo data | none for the demo |
| Gigabugs | public read-only demo | 1.2M bugs built in | none |
| Excalidraw, tldraw | public sites, or local dev server | load a scene or snapshot file | none |

Each rung needs its own `lab.config.mjs` (screens, states, 3 to 5 journeys in the app's
language). Keep those configs and seeds outside the product repo, or in a gitignored folder:
they describe other people's software, not yours.

Not usable as rungs (checked October 2026): Cal.com (code went private in April 2026; Cal.diy
lacks team features), Midday (winding down), Huly (original repo frozen), Campsite
(unmaintained, non-commercial licence, needs S3, Pusher and Imgix), Mail-0/Zero (inactive since
August 2025), Focalboard (unmaintained). Email has no polished open rung; Roundcube on a local
IMAP server covers only the rough end.

## Pin every rung

Record the Docker tag or commit SHA of each rung with every run: Twenty, Plane, OpenProject and
Mattermost all shipped releases in October 2026, and craft drifts between versions. Re-run the
ladder whenever the critic's model or the lab version changes.

## Pass criterion

1. Every adjacent pair within a track comes out in the designer's order, in both presentation
   orders, in at least two of three runs.
2. The app's own ablation levels rank monotonically (Procedure A in `calibration.md`).
3. Cross-domain pairs (an anchor against a low rung) are reported but don't decide the pass.

Record runs and failures in `calibration.md`.

## Closed apps and galleries

Linear, Things, Raycast and other closed apps can't be driven by the lab without accounts and
are not ladder rungs. A team may capture them by hand as north-star references on its own
accounts; keep those captures out of git (a gitignored folder), since a public repo would
republish them. Screenshot galleries are out: Mobbin's terms (May 2026) forbid using its
content to "train, test, index, benchmark, or improve" any model. UICrit (CC BY 4.0, mobile
screens) is licence-clean for a sanity check that the critic beats chance, but it says nothing
about desktop apps.
