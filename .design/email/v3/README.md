# Mail v3: the agreed prototype

These are the sources of the "Mail, rethought" artifact (version 3.1, 2026-11-06), the
design that [specs/mail-v3.md](../../../specs/mail-v3.md) builds. The published,
interactive version is https://claude.ai/artifact/CvUks2CuUUcm1Cdp4mNM6F. It is private:
ask Mike for access.

They are reference only. Nothing here is imported by the app, and every person, company and
message in `data.js` is made up.

| File | What it holds |
| --- | --- |
| `part3-render.js` | Every surface as an HTML string: rail, tabs, list rows, banners, reader, composer, side panel, popovers, the web view. Copy comes from here. |
| `part4-interact.js` | Handlers, the key map (`onKey`) and `STATES`, the 53 named states. The lab states in the spec map onto these ids. |
| `data.js` | The fixtures: accounts, people, threads, drafts, outbox, snippets, the "Why here?" texts. |
| `part1-style.html` | The CSS. It uses the house tokens; sizes and spacing to copy are here. |
| `part2-frame.html` | The page frame, the icon set and the place and tab definitions. |
| `rationale-why.html` | What changed against the shipped module, and why. |

When the spec and the prototype disagree, the spec wins. The spec records Mike's
2026-11-06 answers, which the prototype predates:

- The account status card lives in Settings, not the rail.
- "Why here?" only explains; it has no override or rule controls.
- Compact rows are a single line.
