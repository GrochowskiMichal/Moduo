# Moduo product site: design

The planning record for `apps/landing_awwwards`. Later passes read this before changing
anything. The brand rules it follows live in `.design/brand/BRAND_BRIEF.md` and
`.design/brand/DECISIONS.md` (numbers in brackets below cite them).

## 0. Brief

| | |
| --- | --- |
| Subject | Moduo: a lightweight workspace that links email, tasks, notes, calendar, contacts and chat in one window. Made by Maciej Grzywacz (product, design) and Mike Grochowski (engineering). |
| Audience | Founders and co-founders, solo operators running their work across many apps, and small companies. Tool-literate people who know the category and distrust heavy all-in-ones. |
| Job | 1) Make the linking idea obvious in seconds. 2) Collect waitlist sign-ups. 3) Earn trust: fair pricing, data you can take with you, AI that only sees what you allow. 4) Be the canonical, indexable product site, legal pages included. |
| Status | Private beta, waitlist. Invites go out in waves. |
| Assets | The mark and lockup (`brand/exports`), favicons, the founders' photos (consented), vetted shipped copy, the planned launch prices, the legal documents, the manifesto, the release notes. |
| Language | American English (65). |
| Constraints | Black canvas, Paper type, no brand hue, one typeface (36, 47): since 26 October that face is Modus, Moduo's own (§8), not Geist. The product is the only picture: no stock, 3D, abstract or AI imagery, no illustration (67, 69); the type page's hero lays the type in 3D space, recorded as an exception in §8; since 28 October the home hero was a live scene, the mark standing on a ridge at first light with the sun coming through its windows (§11, an exception decided like the others); since 30 October it is Dusk, one email from before dawn to sunrise behind the product's own window (§13). Things arrive, they don't perform (53). The logo reveal plays once, on a first visit, never on route changes, never loops (54, 55). No invented logos, quotes, counts or testimonials. Voice and banned words (59–65). |

### Assumptions (also listed in the hand-off)

- Production URL is `https://moduo.app`. This site would replace `apps/landing` only when the founders decide; until then it deploys to its own Worker.
- Prices are the planned launch prices published on the current landing (Free, Pro $12/$10, Duo $20/$16, Team $15/$12 a seat; founding prices $8, $13, $10).
- Shipped strings the brand fixes are reused verbatim: the campaign line (brand 61: the page title, the press kit, the specimen; the hero carried it until 30 October, §5), the brand line, the boilerplate, the FAQ answers, the founders' quotes. The hero's subcopy was cut on 28 October to two sentences (§5); the shipped promise stays word for word.
- The five links in the signature are real product behavior, checked in code: email → task (`features/email/convert.ts`, the T key), note checkbox lines → tasks (`notes/editor/plugins/task-line-plugin.tsx`), `/` links inside event notes (`calendar/ui/event-detail-panel.tsx`), events on the contact page (contacts roll-up), a chat channel linked to a client (`chat/linking.ts`, relation kind `conversation-of`).
- Module shortcuts are positional in the app (`Mod+1…6` follow the sidebar order), so the site never pins a number to a module.
- The legal pages, the manifesto and the changelog are ported from `apps/landing` and `release-notes/releases.json`, not rewritten. The manifesto's last line, "The last productivity app you'll ever set up", is dropped as brand decision 61 requires.
- Analytics: the same PostHog EU project as the current landing, loaded only after the visitor accepts.

## 1. Concept

Three candidates from three territories.

| | A. Overlap is connection (identity) | B. One window, one day (process) | C. Every noun is a door (formal) |
| --- | --- | --- | --- |
| Idea | The mark is three strokes whose overlaps cancel into open windows. The site runs on that rule: wherever two modules overlap, a window opens and shows the link between them. | The whole site is one app window living through one working day; scroll is the clock from 8:00 to 19:00, the window switches modules as Anna's email arrives at 9:12. | The site is set as running text where every person, email, task and time is a live mention that opens what it links to. |
| Anchor | The mark's construction: visible = (left ∪ right) XOR middle (§3), its meaning "modules meet, and where they meet, something opens" (12), and the motion grammar "overlap cancels, separation reveals" (54). No other company has this rule. | The brand line "One window for the whole working life." and module switching from the keyboard. | Links are made with a key, a mention or a click, never a schema. |
| Layout | The mark's geometry: vertical sides, 45° edges, exact offsets. Six strokes, five windows. | A pinned window, a clock in the corner. | One column of prose. |
| Motion verb | Part: things arrive by sliding apart from a shared line and leave by closing until they cancel. | Switch, like ⌘1…6. | Expand in place. |
| Signature | Six module strokes start apart, then slide together on scroll. Every overlap cancels to black and opens a window holding one real link. | The window morphs through modules as the clock runs. | A paragraph whose mentions open their linked items. |
| O / F / Fe / P | 5 / 5 / 4 / 1 | 3 / 4 / 3 / 3 | 4 / 4 / 4 / 3 |

**Pick A.** It is the only one built on a fact nobody else owns, and it states the product thesis
(the connection is the product) without drawing a node graph, which the brand forbids. From C we
keep one detail: the link captions name the relation the way the app does ("spawned from").

### Concept card

```
Idea:        Moduo's mark is three strokes whose overlaps open into windows. The site runs on
             the same rule: where two modules overlap, a window opens and holds the link.
Metaphor:    the mark's construction (strokes, exact offsets, XOR windows).
Signature:   "Grown from the mark": on scroll the header's mark drops out of the bar and grows
             to fill the stage, parts, and the row carries on into six module strokes, apart like six apps; they slide together pair by
             pair, each overlap cancels to black and opens a window, and the link it holds
             arrives under the chain as a card of the app; then the chain keeps unfurling to
             both edges of the screen.
             One driver (src/motion/interlock.ts) maps scroll progress to everything.
Emotion:     calm certainty. Something appears out of nothing, already complete. Then stillness.
Motion verb: part. Arrive by separating from a shared line (horizontal, brand ease-out);
             leave by closing until the overlap cancels.
Screenshot:  the plate: six Paper strokes on Canvas black, five windows, and under them one
             client's morning as five cards of the app, each carrying the one before.
```

The logo itself stays the logo: it is never relabeled, recolored, distorted or overlapped by
type. The six-stroke chain is a new symbol built with the brand's motion grammar (54), the use
the brand reserves "for future animated symbols".

## 2. Art direction system

### Palette (the app's neutral system, black shade; hex = sRGB of the oklch tokens)

| Role | Token | Hex | Use |
| --- | --- | --- | --- |
| ground | Canvas, `--background` | `#000000` | every page |
| ink | Paper, `--neutral-50` | `#fafafa` | type, strokes, the mark |
| muted | Mist, `--neutral-400` | `#a4a4a4` | secondary text (8.8:1 on black) |
| quiet | Ash, `--neutral-500` | `#7a7a7a` | captions, meta (4.9:1) |
| line | `--neutral-800` | `#1b1b1b` | hairlines |
| line-strong | `--neutral-700` | `#333333` | dividers that must read |
| raised | Card / Popover, `--neutral-900/850` | `#090909` / `#121212` | product frames, wells |
| action | `--primary`, mono | `#eeeeee` → `#ffffff` | the one filled action, label `#030303` |
| curtain | Canvas | `#000000` | page transition panels, Paper hairline edge |

Status and tag hues (`#61c568`, `#fcb442`, `#00ade4`, the label hues) appear only inside product
pictures, small, as dots and chips (41). The XOR effects need no color at all: Paper over Paper
cancels to black.

### Type

**Modus** (§8) sets every word: one self-hosted variable woff2, Light 300 to Bold 700, 38 KB (v1.3),
preloaded. Geist Mono stays only for text copied from a terminal or code (commit hashes and
messages, branch names, inline code in legal text). Keycaps, the set signs (∪ ∩ △), figures and
labels that used to be mono are Modus: it draws the Mac key legends and tabular figures itself.
`font-synthesis: none`, so nothing is ever faked (Modus has no italic). Weights are tokens, one
per role:

| Token | Weight | Role |
| --- | --- | --- |
| `--w-light` | 300 | large quiet lines, 28 px and up (the keys statement, the type page's clock) |
| `--w-text` | 400 | reading, leads, statements |
| `--w-small` | 450 | text at 14 px and under (`.t-s`, `.t-xs`): the axis lets small text hold its color on black |
| `--w-ui` | 500 | controls, nav, labels, names |
| `--w-display` | 600 | headlines, titles, `b` and `strong` |
| `--w-mark` | 700 | the typed wordmark, nothing else |

| Token | Size | Leading | Tracking | Weight | Role |
| --- | --- | --- | --- | --- | --- |
| `--t-mega` | clamp(2.9rem, 0.55rem + 8.7vw, 9.75rem) | 0.9 | -0.03em | 600 | the hero line |
| `--t-xl` | clamp(2.5rem, 1.05rem + 4.4vw, 6rem) | 0.95 | -0.025em | 600 | page titles, module names |
| `--t-l` | clamp(1.75rem, 1.15rem + 1.9vw, 3.25rem) | 1.1 | -0.015em | 400 | statements |
| `--t-m` | clamp(1.25rem, 1.08rem + 0.55vw, 1.625rem) | 1.32 | -0.006em | 400 | leads, captions titles |
| `--t-body` | 1.125rem | 1.55 | 0 | 400 | reading |
| `--t-s` | 0.875rem | 1.5 | 0 | 450 (500 for UI) | UI, nav, buttons |
| `--t-xs` | 0.75rem | 1.4 | 0.012em | 450 | meta, figure labels |

Modus is spaced for reading, so display sizes close up more as they grow and small sizes open
a touch. Text that should show the raised colon between figures (clocks, times) keeps tracking
0: browsers switch contextual alternates off in letter-spaced text.

Numbers are tabular wherever they count or tell time. Real quotes and apostrophes. No dashes in
visible text.

### Grid and rhythm

- 12 columns, margin `clamp(1rem, 4vw, 4rem)`, gutter `clamp(0.75rem, 1.6vw, 1.5rem)`, content
  capped at 1680 px.
- **Three hanging lines: columns 1, 5 and 9.** Every text block starts on one of them, the way
  the mark is three strokes on exact offsets. Phones collapse to one line plus an indent.
- Section rhythm varies on purpose: full viewport (hero, interlock), airy (statements, 28u),
  normal (16u), tight (8u, the index and the FAQ).

### Shape

- The stroke: the mark's middle stroke (`#mk-stroke`, 331.51 × 543.75 in the 1000 box,
  vertical sides, 44.9° edges, rounded acute corners). Every graphic on the site is made of it.
- UI follows the app (brand radius "soft"): 8 px controls, 12 px frames and cards, 16 px dialogs,
  full round only for badges, avatars and dots.
- No shadows except `--shadow-lg` under the hub frame and `--shadow-md` on menus inside frames.

### Motion language

- One ease: the brand's ease-out `cubic-bezier(0.16, 1, 0.3, 1)` (registered as `moduo`), and its
  in-out sibling `cubic-bezier(0.7, 0, 0.2, 1)` for curtains. No springs, no bounce, no glow.
- **Part.** Arrival is a horizontal separation: text lines arrive with a fade and a small slide
  along x (0.9 s, 70 ms stagger), with no blur (as in the app, decision 81); strokes slide apart
  along x; page transitions close two Canvas panels with 45° edges and part them on the new page.
- Hover, per role (one treatment each):
  - Primary and secondary buttons: **the XOR sweep.** A stroke-shaped Paper band passes over the
    button with `mix-blend-mode: difference`, so the button inverts where it passes and ends fully
    inverted. Touch: the same inversion on `:active`. Reduced motion: an instant inversion.
  - Nav: one shared highlight (the app's hover fill `#1b1b1b`) that slides to the hovered item;
    the current page keeps it.
  - Index rows (modules, next module): a two-stroke glyph closes until its window opens; the
    name moves one offset right.
  - Inline links: a quiet underline at rest; on hover a Paper line draws across it, left to
    right.
  - Utility links (legal, social, cookie): color only.
- Durations: hover 0.36 s, heading lines 0.9 s, blocks 0.8 s, product pictures 1.1 s, strokes
  0.8 s (the reveal), transitions 0.55 s close + 0.7 s part.
- **Idle.** The mark never moves at rest (55). Since 28 October the hero's scene breathes around
  it (§11): mist drifts through the light, dust turns in the shafts, a few stars tremble; the
  mark itself stays still, and the app's focus clock still counts in the window's bar. What breathes on its own is the chain where it rests (the plate and the ribbon): a slow wave
  runs along it (±2 % of the offset, 10 s), the plate lights its five links in turn, and the
  window nearest the pointer opens a little. On the GSAP ticker, paused off screen, absent under
  reduced motion.

### Explainer figure

None. An isometric figure would be illustration, which the brand rules out for v1 (69). The
interlock is the explainer, drawn with the brand's own geometry.

## 3. Composition plan (home)

Every section uses a different layout family.

```
1 HERO · First light (100svh), §11. Until 28 October: a product poster, drawn here
+-------------------------------------------------------------------------+
| [mark]moduo           Modules  Pricing  AI  Manifesto    [Join waitlist] |
|                                                    Email, tasks, notes,  |
| Fire ten apps.                                     calendar, contacts... |
| Keep the work.        (cols 1-8, 8.5rem max)       [ email    ][Join]    |
|                                                                          |
|  ________________________ light on the top edge _______________________  |
| +----------------------------------------------------------------------+ |
| | N Northwind   Home  Notes  Tasks  Calendar  Email  Contacts  Chat 24:12| |
| | Tasks              | Today          | Inbox                          | |
| | o Send Anna... [@] | 09 standup     | . Anna Carter                  | |
+-------------------------------------------------------------------------+  cut + faded
  intro: the window stands up out of the dark (lying back 34° to its 8° lean), the light runs
         out along its top edge from the middle; then everything holds still
2 GROWN FROM THE MARK · sticky stage, scrubbed (440svh), one canvas
  beat 0: the header's mark drops out of the bar and grows to fill the stage (a close-up of
          the logo) while the hero fades under it
  beat 1: the mark parts and the row carries on to six strokes, apart; then all six names
          arrive over the caps: Email Tasks Notes ...
          "Six kinds of work, spread over ten apps."
  beat 2: pairs close left to right; each window opens (one ring goes out), a node marks
          it and a wire draws down to its caption in the row below
  beat 3: the plate (the climax): the chain comes closer, drawing guides and plus marks (the
          footer's grammar), five wired titles, the headline at display size,
          "One client. Five links. Nothing copied."; at rest each link lights in turn
          and shows its sentence
  beat 4: the ribbon: the chain unfurls to both edges of the screen, in Ash fading to
          black, "Then the next client, and the next." with the waitlist button
3 MODULES · bento of six cards, spans 7/5 · 5/7 · 5/7 (no row of three alike), closed by a
  wide card: the keys that work everywhere, with ⌘K open on "anna"
  +----------------------------+  +--------------------+
  | Email              [//////] |  | Tasks      [//////] |   each card: name, one line, the
  | one line                    |  | one line            |   module's glyph; its moment drawn
  |   [reader] -> [task row]    |  |  [focus] [week bars]|   in the app's anatomy, bleeding off
  +----------------------------+  +--------------------+   the card; the whole card links
4 AI · two cards of the modules' family, 7/5: the question and its answer | the key's reach
  per module (a live control: set a module to None and its line of the answer goes)
5 YOURS · ledger: square cells on hairlines, 4/4/4 then 6/6, each promise with its picture
  (export filling, the vault and its noise, keys with one revoked | import wiring, the account
  deleted); the top row reads head first, the bottom row picture first
6 WON'T BUILD · sticky narrative: sticky title left, four refusals right
7 PRICING · four columns, stroke-count glyphs (1 outline, 1, 2, 4 strokes)
8 MAKERS · split frame: two portraits clipped to the stroke, quotes
9 QUESTIONS · list (details/summary)
10 FINALE · footer as finale, the production landing's spec sheet: a framed grid of cells on
   hairlines (the six lists in one row; under them Say hello as a strip with the extruded
   mark at its end), then the wordmark plate, then the legal bar as cells. (The closing
   section with the form that stood before it went on 30 October: the header's button is
   the action.)
```

Inner pages: module (×6) · pricing · manifesto · changelog · privacy · terms · DPA ·
acceptable use · 404. The 404 is two strokes that do not touch ("nothing links here"); the way
home closes them until a window opens.

### Mobile (390 px)

Composed, not shrunk: the hero stacks line and subcopy, then Home as the laptop shows it, about
two screens wide, standing at the left margin and cut by the screen's right edge, so the bar's
tabs and the first widgets read at their own density (30 October, Mike: the one-column Home of
the first cut "does not demonstrate fully what it should", with Linear's phone hero as the
reference; it runs on under the fold, as the laptop's does). The
scene keeps every beat. While the pairs close the camera follows the closing pair (strokes large,
the chain running past the edges) and wires one caption, with its sentence, to the margin; the
six names stand in one row over the chain, spread across its width in the strokes' order, the
closing pair's lit and the rest dim (two staggered rows, the first cut, read as "ultra weird and
unclean"); the plate pulls back to the whole chain and stacks the five titles. Index rows drop
the glyph. Pricing becomes a stack with the toggle sticky. Portraits stack. The FAQ list runs
the full width (the home page's display-size list once kept its desktop column there, a
specificity slip).

### Genericness test

A generic model given "Moduo, black, Geist" lands on a dark SaaS page: a product screenshot
hero, three feature cards, gradient glow, eyebrow labels over every heading. Changed: modules
hold real product moments, not icons (since 27 October the modules are cards, at Mike's ask,
each holding its module's moment in the app's own anatomy); every graphic is built from the one
stroke; hovers and transitions come
from the XOR rule; no eyebrows, no gradients, no glow, no light-mode toggle. The hero did hold
the stroke chain instead of the product until 2026-10-27, when Mike asked for the product there,
and then for a product-marketing hero. A generic one is a screenshot under a colored glow with
a logo wall, badges and floating callouts around it. Ours keeps only three things: the line,
the words with the form, and the app itself, redrawn in its own anatomy and legible at full
size, lit by one white light on its top edge. No callouts, no badges, no color; the logo in
the header is what the scene grows from (§5).

## 4. Stack

Astro 7 (static), GSAP 3 (ScrollTrigger, SplitText, CustomEase), Lenis, plain CSS with the
tokens above. Static HTML with little JS, served the way `apps/landing` already is: Cloudflare
Workers static assets (`wrangler.jsonc`, `_headers`). The waitlist posts to the existing
`waitlist-join` Edge Function (its origin allowlist covers moduo.app).

## 5. Decisions made while building

- **The hero is a clean product poster.** (Superseded on 28 October by First light, §11; the
  line, its words and Home at the foot of the screen carry over.) (2026-10-27, Mike: "entire hero section refinement
  and with something much better", then of a busy take with a live demo, a crossed-out app list
  and link lines: "ultra messy and AI-sloppy, we need something clean and stunning".) Three
  things and nothing else. The line on the left at a step under the display size (8.5rem at
  most), so the words (a step quieter than the line, three lines) and the form sit beside it in
  cols 9 to 12. Under them, with room to breathe, Home: the app's
  window redrawn at the width of the grid, so its rows read at about 18 px on a laptop, leaning
  back 8° from its top edge like a screen on a desk, one white light catching that edge, running
  on under the fold where the hero cuts and fades it. The intro stands it up out of the dark and
  runs the light out along its edge; then it holds still. Takes that did not survive: ten paper
  apps falling onto a small tilted slab (too small to read, too abstract), and a looping demo
  with a pointer, a T key, notes, link lines and a struck list of the ten apps (too busy).
- **The waitlist dialog shows the one email the list sends.** (2026-10-28, Mike, of the old
  modal: "clean yet stunning, surprise me with creativity". Two takes did not survive: the form
  inside the header bar, "not behaving well, keep it in a modal", and a two-column dialog with
  the whole invite open in Moduo's reader, "the idea is nice but a little too messy".) One
  column (`components/WaitlistDialog.astro`): the title, "Moduo opens in waves. When yours
  opens, this is the one email we send.", then that email as one row of Moduo's inbox (from
  Moduo, the real invite's subject from `waitlist-invite.ts`, "When your wave opens"), then the
  field and the button, then one quiet line. What you type is the row's "To", so you watch your
  invite being addressed, and the two strokes after the address close into a window once it
  reads as one. Joined, the row is marked "Queued", a light runs along its top edge (as on the
  hero's window) and the form gives way to "You're on the list."; the header's button reads "On
  the list" with the two-stroke tick from then on, on every page (a class set before first
  paint).
- **The hero's words: one edge, two short sentences.** (2026-10-28, Mike: "lets work on the
  headline and copy, text itself and presenting it", then of a take with the line in two weights
  and a four-line paragraph beside it: "it needs to be much cleaner"; the waitlist form left the
  hero the day before.) The campaign line stays (brand 61 keeps it for the landing hero, and it
  reads in three seconds), both lines in Paper at one weight. Under it, on the same left edge, in
  the reading grey at t-m, a sentence a line: what Moduo is ("Email, tasks, notes, calendar,
  contacts and chat in one window.") and the shipped promise ("Nothing lives in two places.",
  the line the colophon reads as the one under our headline). Then the window. The right of the
  first screen stays empty, so the line, its words and the product read top to bottom with
  nothing beside them. Takes that did not survive: the grey second line (the payoff read as an
  afterthought) and a bold and light line with a paragraph beside it (too many parts).
- **The hero's line is "What You touch stays in touch.", a lockup with "touch" set once;
  "You" takes a capital** (2026-10-30, Mike: "make You Y uppercase"; the line is to the reader.
  The OG image reads the same data. The campaign line and the title tag are not this line.)
  (2026-10-30, Mike: the new line, and "maybe we could somehow present this touch-in touch
  without repetition of word 'touch' creatively"; of the first take, "nah we need some cleaner
  solution"; of the second, "i was more about placing positioning text such original and
  creative and UX proof way or play with font sizes and weights so we do not have to repeat word
  touch twice".) The two short lines, "What you" and "stays in", stand on the left in the line's
  weight as one block with straight sides: the second line is sized so it is exactly as wide as
  the first (1.315 times its size, measured from the face's advances and kerning at build time,
  `lib/lockup.ts`), so both run into the one word with one gap and the block has no ragged edge
  (the first night's take set the lines flush right against the word, equal in size, which
  stepped the left edge in under "What you"; on a phone Mike read that as "weirdly positioned").
  The word stands beside them at the height of both (2.68 times the first line's size, also
  measured: its ascenders meet the first line's, its baseline is the second line's) in the light
  weight, so its stroke stays near theirs and the size does the talking: each line reads into it.
  The heading holds the sentence itself for readers and crawlers; the lockup is drawn
  aria-hidden. On a phone the lockup's width in ems (the lines, the gap, the word: `--lock-em`)
  sets the size, so it fills the column exactly. The intro is the reveals': the two lines, then
  the word a beat later. The campaign line (brand 61) stays the
  campaign line in the page title, the press kit and the specimen; home's share image carries
  the same lockup. The second sentence under the line stays "in one window" (the boilerplate's
  phrase, and the colophon reads the line under it). Takes not kept, both built the same night:
  the word set once with its hairline outline left on the first line after sliding down to the
  second (a clean ring from the glyphs' own edge rather than text-stroke, which showed Modus's
  joins; a hollow word in the headline was not clean enough), and the line set plain with the
  second word sliding out of the first in the intro (the repeat was the thing to avoid).
- **The hero shows the product; the mark comes out of the header.** (2026-10-27, Mike's call.)
  The hero's right side was first Anna's inbox, the picture the email page uses; since the same
  day it is Home with its live demo (above). On a short screen the picture runs on under the fold
  instead of pushing the form down. The mark the hero used to hold is the header's: at the
  very top the header draws it; the moment the page moves, the canvas takes it over on the same
  pixels (measured from the header's lockup and its viewBox) and the header's copy steps out
  (`html.mark-lent`). The mark drops straight down out of the bar first, so it never grows over
  the word beside it, then grows about thirty times over at an even rate (each bit of scroll
  scales it by the same factor) to the close-up. The stage sits over the hero while it does,
  blended with `difference`, so the stroke inverts the fading headline and window it crosses, the
  XOR rule again; clicks pass through it to the hero's form. While the mark is out, the header
  keeps blending instead of turning solid, so the stroke reads through it; the header's mark
  fades back once the stroke has grown away, and is the header's again at the top.
- **Everything grows out of the mark.** On scroll the mark fills the stage, its
  three strokes part, and the row carries on: three more strokes slide the last part of their gap
  into place as they fade up, one after another. (A first build dealt the new strokes out from
  under the mark's own; every critic read the crossing as a collision, so they arrive beside it.)
  At the end the chain unfurls outward from both ends the same way. A
  running count at the bottom right ("6 strokes · 5 windows") narrates the build, so the colophon's claim,
  "every shape on this site is one stroke of the Moduo mark", is shown, not told. The nav lockup
  no longer plays its own reveal: two marks forming at once competed.
- **The plate is one client's story, not a schematic.** (2026-10-28, Mike: the strokes parting
  were "perfect", but "from the moment strokes are connecting it becomes messy with these
  lines"; "instead of text and descriptions, visualize it with the bento's little elements, not
  the features, the connection itself: a connected story".) The wires, nodes, drawing guides and
  sentences are gone. Each link arrives under the chain as one card of the app
  (`components/home/LinkCard.astro`, the bentos' anatomy): the thing as it sits in the next
  module, carrying the chip of the thing it came from, and each card's chip is the card before
  it: the email "Final deck notes" on the task, the task as a line in the kickoff note, the note
  on the Phase 2 call, the call on Anna's page, Anna on the channel. Read left to right the five
  are her morning. Each card is the real element, in its module's anatomy (2026-10-28, Mike:
  "more detailed, to mimic a real element"): the task with its project and due day, the note
  with its line, the call with its time and guests, Anna's page with her role, the channel with
  Jamie's message; the carried thing is the last row, the relation named on its right the way
  the app names it ("Created from", "Task", "Linked", "Attendee", "Conversation"), and a small
  module label sits on top. On a wide screen they stand in a row about as wide as the chain, in
  the order of their windows; the lit link's card is at full strength and the rest wait a step
  back; its linked row steps in a beat after it as the window opens. The plate itself is calm
  (Mike: "messy-busy regarding content positioning"): the line at statement size like the beats
  before it (the ribbon keeps the display size, so the scene still peaks there), the chain a
  step smaller, the cards under it, the running count gone once the plate stands. A phone shows the card in play. A window
  that opens still sends out one ring through the strokes. Each card is a link to its module
  page (its title and sentence are there for screen readers), and under the pointer or focus it
  lifts and opens its window wider.
- **Beats hang on two lines.** Each beat's line sits on the left and its words on the third
  hanging line (col 9), so the stage keeps its height for the figure.
- **The cookie card waits for the scene.** On home it is asked once the scene has played, not
  once the first screen is behind, so it never covers the plate's captions.
- **The stage is a canvas that applies the mark's rule natively.** Even strokes on the canvas,
  odd strokes on a second one, composited with `xor`, so every overlap is a window at any stroke
  count (the ribbon draws 34). Wires, nodes and the ring a window sends out when it opens are
  drawn with `xor` too, so they invert whatever they cross. Until the canvas has drawn, and
  whenever the page is at the very top, the header's own mark is the mark (crisper than the
  canvas, which draws at 2x, on a 3x phone).
- **The ribbon is the one place strokes go grey.** The six module strokes stay Paper; the strokes
  the chain unfurls to the edges step down from Ash toward the canvas with distance, so the
  six you met stay the subject. This is the boldest use of the chain so far (brand 67 rules out
  abstract imagery); it is built only from the mark's stroke and rule, and Maciej should rule on it.
- **Idle motion lives in the chain, not the logo.** The mark is still at rest (55), so the hero
  holds still (`idleMotion: false` on the first screen is this decision). The chain breathes
  where it rests (the plate and the ribbon), as §2 describes. The Tasks picture's focus timer
  counts up, as the app's does.
- **The scene's layout is in place before the first paint.** It keys on `html.motion` (set by the
  head script), not on a class the driver adds later, so there is no layout shift; the driver only
  starts the stage canvas (`.is-live`), and the first frame it draws is the header's mark.
- **A page's opening text paints with the HTML.** The largest text of each first screen (home's
  line under the headline, module names, the pricing title and lead, the manifesto intro, legal
  ledes) is never hidden for a reveal, so a throttled phone paints it in about a second; the
  headline lines, buttons and everything below the first screen still arrive.
- **The XOR rule is real, not drawn.** Chains paint layer A, layer B, then A again in Canvas
  black clipped by B (`Chain.astro`); small glyphs use a `difference` blend (`StrokePair.astro`);
  buttons invert under a Paper band with the stroke's 45° edge and a `difference` blend.
- **The header blends at the top and turns solid once you scroll**, so it never sits on top of
  text; it steps aside on the way down and returns on the way up.
- **Consent asks late and rides with the frame.** The card (bottom right, Decline and Accept of
  equal weight) is asked only once the first screen is behind the visitor, so it never covers a
  hero, and from then on it moves with the header: away while you read down, back when you head
  up, so it never parks on the text you are reading. Opened from Cookie settings (or the privacy
  policy's `/#cookie-settings`), hovered or focused, it stays. Browsers sending Do Not Track are
  not asked, as on the current landing. PostHog loads only after Accept.
- **Inner pages are still at rest.** The chain's idle wave lives on home, where the concept is
  told; module, pricing, manifesto, changelog and legal pages hold still until you scroll, point or
  focus, so reading pages stay calm.
- **Module pages start the picture on the first screen.** The hero keeps the home grammar (name
  on top, words bottom left, the lit chain bottom right) without a forced full height, so there is
  no empty band under the name; an odd last feature spans the row.
- **The joints answer.** On home, each of the five captions is a link to the module page that
  explains it; under the pointer or focus (or with the pointer near its window) its window opens
  wider and its two modules stay lit while the rest step back (a focused caption first brings
  the scene to the plate, so focus never lands on something invisible). On module pages each overlap card links to the
  module on the other side of its window, its two strokes join as it arrives, and an "Everything
  else" card covers the links made by gesture.
- **Phones open on the title.** Legal pages and the changelog fold their contents into an "On
  this page" (or "Releases") disclosure after the lede; the manifesto's stroke rail is a desktop
  aid and stays off phones, where every part keeps its number.
- **On a module page, "Modules" is the current section** (`aria-current="true"`), with the nav's
  resting highlight.
- **Changelog notes keep their words.** Typographer's quotes for display, and a release whose only
  note is "Reliability improvements." reads as one quiet row instead of a full section.
- **Removed accessory: the blur.** Every arrival used to fade in through an 8 px blur. It went
  in the final pass: the app dropped blur for performance (decision 81, "no blur anywhere"), it
  was the most expensive effect on a throttled phone, and without it the fade and the slide along
  the stroke axis carry the motion verb on their own.
- **Inline links draw in.** Under the pointer a Paper line draws across an inline link's quiet
  underline, along the reading direction, on every line it wraps to; utility links (footer, legal
  bar) only light up.
- **Rhythm: about 160 px between sections, about 290 px before a new chapter** (AI, the plans,
  the closing line). The generous 320–400 px gaps left whole frames empty.
- **The mark stays in the middle of home.** Each module row ends in the six strokes with its own
  stroke picked out (it lights up under the pointer), and the strokes of the module chain on
  module pages lift almost to white with their name lit when hovered.
- **Every page ends on an action.** (Superseded 30 October: home's closing form and the
  footer's brand cell went; the header's Join the waitlist button is the action on every page.)
  Pages other than home (whose closing section was the form) were to carry the waitlist form
  under the footer's brand line; the carried-over footer never did.
- **Every hero speaks the same grammar.** Home and module pages: the name or line on top, the words
  bottom left, the chain bottom right (on module pages the current module's stroke is lit and the
  other five are links).
- **Product pictures are the app, redrawn.** (2026-10-27, Mike: "all product mockups should use
  the original product font" and look like the app, or a polished version of it.) They are drawn
  in HTML from the app itself on the latest `mike`: its code (a survey of the chrome, rows and
  each module, with the comfortable density’s sizes), its Storybook and the Tasks welcome clips,
  which are recorded from the real app. Geist, the app’s face, is self-hosted for the pictures
  only (preloaded on module pages; not on home, where it cost the phone’s LCP 0.2 s). The chrome
  is the app’s: the mark and workspace switcher, the module tabs in the app’s order (Home, Notes,
  Tasks, Calendar, Email, Contacts, Chat) with their Lucide icons (`lib/app-icons.ts`, copied
  from the app’s lucide-react), help, bell and a neutral avatar, and the bottom bar with its
  panel toggles and tools. Panels are 16 px apart from the edges and 8 px from each other, 240 /
  280 px at the sides; state fills are the app’s translucent ones. Each module is its real
  screen: Tasks in Focus (the now card, up next by project, the details panel), Email as rail,
  thread list and the reader in the right panel (the pointer on "To task", its tooltip showing T,
  the key that goes down every few seconds), the note with task lines, a hued mention chip and
  the hover "Make task" on a plain checkbox line, the working week with a dashed, elapsed block
  offering Later, Longer, Remove (the calendar page’s copy now says so, as the app does), the
  contact hub with its capped sections and relation labels, and a channel with a wrapped-up chain
  and a message marked as the decision. The polish is one step past the app and no further: a
  glass hairline and a lip of light on the window, a lip on every panel, a faint light from above
  the bar. The story stays the site’s (Anna Carter, Northwind), so every picture is the same
  morning the scene tells. Captions say "redrawn from the app" and that its look is still
  changing; the pictures stay `role="img"` with a label. The type page’s Tasks picture is the one
  exception to Geist: it is set in Modus, because it is the typeface’s specimen. Live details
  (none under reduced motion): the focus clock counts in the card and the bar, the note’s caret
  blinks, the T goes down. The AI key picture is the one live control, drawn as the app’s API key
  settings (its module order, None / View / Edit): switching a module to None removes what the
  assistant could say about it.
- **Bentos hold moments, not icons.** (2026-10-27, Mike: "much higher level", with two
  references: a ruled grid of trust clauses, each with a small UI and a dot field, and a deck of
  rounded feature cards whose product pictures bleed off the card.) Two families, one per
  section, so they never blur: the modules are rounded cards like the app’s panels (6 cards,
  spans 7/5, 5/7, 5/7), each a link to its page, each holding the module’s moment drawn with the
  product pictures’ kit (Geist, the app’s tokens and icons, `components/bento/*Mini`): the email
  turning into a task under T, Focus at the moment a task is finished (Done ⏎: the minutes the
  clock kept lift off its pill and land on the task in the done list, “38m of ~45m”, and the next
  task rises out of Up next with its clock starting; it replaced a week of planned-against-focused
  bars, 28 October, Mike: a report is not a moment of Tasks), a checkbox line becoming a task, the
  elapsed block asking later, longer or remove, Anna’s page filling in with how each thing links
  to her, and a new address at her company offering to join, a thread wrapped up with its
  decision. The promises are a ledger, square cells on hairlines like a contract’s clauses:
  export filling, the vault (one stroke of the mark with a lock set in it, and the noise a model
  would see), keys with one revoked, the import wiring, the account deleted. The references’ dot
  fields became a field of tiny strokes, the mark’s grain (`.bfield`). Each picture plays its
  moment once in view (`motion/bento.ts`) and the modules’ again under the pointer; the vault’s
  noise reshuffles and the import’s wires pulse at rest, paused off screen. Every picture’s still
  state is the result, so reduced motion and no-JS lose nothing. On a card, the pointer brings a
  soft light and the picture parts from the card a step; the glyph’s stroke lights. The Hub
  (“Open anything. See everything it touches.”, Anna’s page as a full-width picture) went once
  the cards arrived: the Contacts card says the same, so the scene now hands straight over to the
  modules (Mike, 27 October). The AI section joined the card family too: the question and its
  answer beside the key’s reach per module, still the one live control (`.bcard--still` keeps
  those two cards from answering the pointer, since they are not links). The keys statement (a
  paragraph at display size with live keycaps) went the same way: its sentence now heads a wide
  card that closes the modules grid, beside ⌘K open on “anna” finding her across contacts, email,
  tasks and notes; the T clause left it, since the Email card shows T.
- **The cards' spacing (28 October, a layout pass on the Tasks card).** A card's line runs under
  its glyph, which sits beside the title only, so the measure is 34ch, not the glyph's column:
  narrow cards keep two lines instead of three, and `text-wrap: pretty` keeps a last word from
  standing alone. Under 26rem a card's Open button keeps only its arrow, so it never sits on the
  picture's words. The Tasks picture holds its moment at every width: the card keeps room
  (`--mini-fs` × 24) so the task the minutes land on is whole, and the picture fades out at the
  card's foot instead of slicing a done row wherever the height cuts it. Inside it, each list's
  heading sits low in its row, close to what it heads; the done list stands a step apart from Up
  next and recedes after the task that just took the minutes; those minutes follow the task's
  title ("Prep the Phase 2 call 38m of ~45m"), which reads as written onto it and keeps the row's
  far end clear for the Open button.
- **Home, the page you arrange (28 October, Mike: a section between the AI and the promises,
  "a high-end futuristic version of what we will have in product, as an interactive animated
  mockup").** `components/home/Board.astro` + `motion/board.ts`. Its layout family is new on
  the page: one wide app window in edit mode, the board on an 8-column grid of cells marked at
  their corners like a drawing (the footer's plus marks), the shelf of widgets on its right.
  - The idea: a widget says more the more room it has. Each card is a size container: a line
    at one row, a glance in a small square, the full list when wide or tall (the app's own rule,
    `widget-density.ts`). The step past the app: any span from 2 × 1 snaps to the grid, where
    the app has four sizes on 8 × 4.
  - Hands on: a card moves by its name and resizes by its corner. What it covers parts to the
    nearest free spot, sideways before down (the app relocates the same way, greedy
    nearest-free), and comes back if the card moves on. Every change plays as a FLIP, the
    content held at its new size inside a card that grows from where it was. The grid wakes
    under the pointer; a dashed cell area and a size readout show where a card will land. Three
    layouts (Monday, Deep work, Client day) set the whole board, row by row. The shelf adds a
    widget into the first free spot, flying from its button; × takes one off. Keys: arrows move
    a focused card, Shift and arrows resize it, Delete removes it, Enter opens its module.
  - The hand: the first time the board is in sight a pointer shows it once (Habits added from
    the shelf, pulled a row taller, Deep work, back to Monday) and stops for good the moment
    the visitor touches anything.
  - Live, on the one clock and only on screen: the focus ring and its clock run, Anna types in
    Catch up, the capture field's caret blinks, the clock is the visitor's real time (and
    Osaka's, wide). The Monday layout leaves a 2 × 2 cell area empty on purpose: room to grow.
  - Still (no JS, reduced motion): the Monday layout placed by CSS alone (phone: its own
    four-column layout), every word readable; reduced motion keeps the hands-on part with every
    change instant and nothing ticking.
- **The site-wide layout pass (28 October, after the Tasks card).** Every page was shot at 1440
  and 390 and read for grouping, rhythm and the hanging lines. Recorded so later passes keep it:
  - Side lists hang on line 5: the FAQ, the refusals, the AI asks ("Calls" on 5, "In Moduo" on 9),
    the security vendors (34 % / 32 %), the pricing bill. The one exception is the home page's
    FAQ: its display-size title needs a column more, so its list stays on 6. Inner pages set the
    FAQ title as a section (t-l), not a chapter.
  - A heading sits nearer what it heads than what came before it: the home scene's still layout
    (10u between beats, 4u from a heading to its figure, 4u from the cards to their caption), the
    module pages' "What X does" label on its first feature's baseline.
  - Rows that sit side by side share their lines (subgrid): the plans (features and buttons level,
    a founding-price line held empty on Free), the download doors, the shortcut keys (one key
    column, 11.75rem, on wide screens).
  - Three cards never squeeze into eight columns: below 1600 px a module page's overlaps and every
    Related row put the title above and run the cards across all twelve.
  - A repeating group's last padding gives way to its section's (import guides, integration
    groups, the use-case day), and the module pages run 12u between ordinary sections, 8u before
    the keys.
  - The footer's words land on line 1; its frame keeps at least a gutter from the screen's edge.
    Below 1280 px the hero chains show only the current page's name (and the one under the
    pointer), and the footer takes its six-column layout (three lists a row).
  - Reading pages keep a 38rem measure for prose (`--measure`); boxes and tables keep 44rem.
  - The page hero without a back link no longer keeps that link's empty row: every hero's name
    starts at the same height.
  - Pictures that would be cut by their cell get room (the keys card, the Tasks card) or run out
    in a fade (the Modus size samples, the Tasks done list), never a slice through a line.
  Left as they are, on purpose: line 7 for half-width pictures (/modus, /press founders), the
  four-up rows on 1/4/7/10 (/security, /colophon), the compare table's 22 % first column
  (reading width wins over the line), and the use-case moments' top alignment beside their
  pictures.
- **Kept verbatim:** the legal pages (one dash in the DPA, repeated headings in their tables of
  contents) and the founders' manifesto ("You just work."), except the line brand decision 61
  drops.
- **Long pages get a rail on line 1.** Legal pages and the changelog put their contents in a sticky
  rail that lights the part you are reading; the manifesto's rail is six strokes, one per part,
  and the lit stroke is where you are (`motion/rail.ts`, the same idiom as the module chain).
- **The founders' section opens with two strokes** that join into one window as it arrives: two
  people, one shared window.

- **Performance and phones pass (26 Oct).** The colophon and about drivers load only on their
  pages (`lazy()` in `motion/setup.ts`); home's scene stays in the first script. Phone fields are
  16 px so iOS never zooms into the form; the page edge, the consent card and the menu clear the
  notch and home indicator (`viewport-fit=cover`); `text-size-adjust` is 100%, so a reader's text
  zoom works. A phone on its side sizes the hero line and the module chain by height. Joiner's
  © and ® fell back to Geist until the typeface drew them (Modus 1.0 draws both; since 1.1 they
  hold the face's own C and R).
- **Phones compose the scene from what is on it.** The chain no longer sits at fixed fractions
  of the screen: the driver measures the tallest beat and places the chain under it, then the
  links, with the count at the foot (`layoutNarrow` in `motion/interlock.ts`), so large text or
  Safari's bars never push the chain into the words. Short phones (under 740 px) set the beats a
  size down. On the plate the chain steps in from the margins so the guides' end marks stand
  clear, and the stacked list of links carries no wire (only the single caption while the pairs
  close is wired). The second beat arrives as the first leaves, with no empty frame between.

- **"Save up to 20%".** The yearly switch said "Save 20%", true for Duo ($20 → $16) and Team
  ($15 → $12) but not Pro ($12 → $10 is 17%). The current landing still says "Save 20%".

- **The footer stays the spec sheet, organized (30 October).** Mike asked for the footer
  "fully rebuilt, completely fresh". The rebuild (the site's map in the site's own grammar: six
  families each headed by a chain of strokes, one a link, the current page lit, a light running
  along the row as it came in; the form on inner pages; no cells, no extruded mark) was built,
  QA'd and scored 7.2 by two fresh critics; Mike: "nah I liked the previous version better but
  making it a little more organized". So the production landing's spec-sheet footer stays (the
  cells on hairlines, the extruded mark leaning from the pointer, the plate, the legal bar as
  cells) and only its order changed: six lists in six cells, three a row, every list one column
  (Modules no longer carries "Moduo for" under it in two columns, Follow along is no longer two
  columns), what Moduo is on the first row (Product, Modules, Moduo for), who makes it and where
  to read more on the second (Company, Resources, Follow along), both rows nine links tall; the
  brand cell holds the words under the line and "Say hello" at its foot, so no cell is a
  leftover. Under 1280 px the three-a-row keeps, on a phone the cells pair (Product with
  Modules, Moduo for with Company, Resources with Follow along). The fresh take's parts worth
  keeping later: the stroke index (the family's strokes as its links), and the form in the
  footer of inner pages (every page ends on an action, still not the case today).
  Then (same day) Mike cut two things as "completely useless here": the footer's brand cell
  (the lockup, the brand line and its words: the hero and the header say them) and home's
  closing section ("Start with one module." with the waitlist form: the header's button is
  the action on every page, and the home's FAQ answers into the footer). The footer is now one
  row of the six lists, and under it the way to reach us as a strip (Say hello, the address,
  its note beside it) with the extruded mark at its end, a size smaller; then the plate and
  the legal bar. Six lists a row still under 1280 px (one column each), two a row on a phone
  with the strip last and the mark hidden, as before.
  Mike's second pass on it, the same hour: a list's name was hard to tell from its links, so
  it is a column head now (Paper, on its own hairline, the links under it); the mark's depth
  reads as a readout (Geist Mono in a small frame) and not as a second caption; the strip
  earns its room with the address at display size, the one bright line in the row; the
  plate's legend ("Point at the letters…") and the bar's status cell ("Private beta. Invites
  go out in waves.") went; and the plate's lines: each name now sits on its line (they hung
  above them, and "Overshoot" had no line), and two dashed lines 12 units past the x-height
  and the baseline show where the rounds end, named once under the lower one.
  Then the wordmark left the box (Mike: "what if we completely remove this big moduo out of
  the box, remove these lines, remove also these weird elements, and make it a little
  bigger"): it stands under the frame now, the last thing on every page, across the whole
  width, its box cut to the word so it is a size bigger; no metric lines, dims, labels or
  overshoot lines, no plus marks and rulers, no crosshair. What stays: the clean outline, the
  draw-in, the sweep (mod, duo, both, with the brackets that name them), and the build of a
  letter under the pointer. The drawing's note ("Set in Modus…") stays above it.
  Then styled (Mike: "what about styling it better?"): the word is solid Paper now, with its
  windows open, the mark's rule in the letters (the ss01 outlines: where an arch leaves its
  stem the overlap is drawn reversed and cancels), the box cut to the letters, so a size
  bigger again. It arrives in two steps: each letter's outline draws itself, then floods
  solid, letter after letter; then the sweep, one word lit and the other's letters stepped
  back to a shade, then both. The brackets went (lines). A letter under the pointer fades
  from solid to its build (the plain letter's strokes, the edges they were cut from, the
  cuts, the points): the word becomes the drawing where you point.
  Mike: "I like it, but remove the windows from the font and bring back this selector
  mod-duo." So the word is the plain letters, solid, and the brackets that name the two words
  ("mod, as in modular", "duo, as in two") are back for the sweep and under the pointer.

## 6. The colophon (`/colophon`)

The footer's credit line, "Set in Modus. Every shape on this site, the letters included, is one
stroke of the Moduo mark.", opens its own page (the name opens /modus, the sentence this page) (the line in the footer plate is a link, and Colophon sits in the
footer's Company column). The page reads the line word by word and finds a second meaning in
each, all of them true:

- **Modus** is the typeface, and Latin for measure: what two strokes leave when they stack in
  one place is the stroke's outline, the template every letter of Modus is cut from. (Until 26
  October this beat read "Geist", the old face, as German for ghost.)
- **Set** is typesetting, and a set: the mark's rule is the symmetric difference,
  `(left ∪ right) △ middle`, the brand brief's `visible = (left ∪ right) XOR middle` in set terms.
- **Moduo** is mod and duo sharing one d, the same rule at the scale of letters.
- **One stroke** under that rule is the product's promise. The hero's "nothing lives in two
  places" is what XOR does: a spot covered twice doesn't double, it opens a window.

```
Idea:        the credit line is the whole idea folded small; the page unfolds it.
Metaphor:    a reading, word by word, drawn as the footer's construction plate.
Signature:   two strokes stack and cancel to an outline (a bright hairline over a faint "Modus");
             later mod and duo slide together across the full width and their shared d
             becomes a ghost too; the story ends on the mark holding the work: Anna's email
             in one window, its task in the other.
             One driver (src/motion/colophon.ts) maps the chapter position to everything.
Emotion:     the click of a hidden meaning landing. Quiet, exact, a little delighted.
Motion verb: part and cancel (the mark's grammar), scrubbed by scroll.
Screenshot:  the hairline outline of a stroke with "Modus" faint across it.
```

Composition: a scroll story (each step's words held in the middle of the left column while the
step scrolls by, a sticky canvas beside them; the name's beat takes the whole width once, its
words low; on phones the stage holds the top 44% and the words read under it), then the line
once more with its four
readings (a phrase and its reading light each other), then an index of every place the stroke
lives on the site, then the sign-off. Without JS or with reduced motion each step carries its own
static figure, and the underlines are simply there.

Decisions:
- **Idle is ghosts only.** The first screen's stroke trails a ghost's hairline drifting a hair
  behind it (the story's first hint); on the ghost chapter the two stacked strokes breathe apart
  and a fine pointer can pull them open. Nothing else moves at rest.
- **The line repeats on purpose, twice.** The page is about that sentence, so it stands in the
  hero and in the reading; on its own page the footer's sentence is plain text, marked as the current page (the audit's
  "repeated 2x" warning is this decision).
- **Transitions keep the rule.** Nothing half transparent ever overlaps: strokes fade up only
  where they don't touch anything and then slide in whole, the mark leaves along its own 45° edge,
  and the two words come in from either side, so every overlap on the way is a real window.
- **The finale is the logo, holding the work.** Email and Tasks arrive apart with a copy each,
  close until the copies are one subject in their window, then Notes joins and a ticked checkbox
  shows in the second window; the camera comes closer than for the bare mark.
- **Signed "Maciej & Mike"**, as brand decision 60 asks of personal notes. The founders should
  read and approve the copy (`colophon` in `src/data/site.ts`); it speaks in their voice.
- Modus is credited as ours, cut from the mark; Geist Mono as Vercel's, for code. The index of
  places opens with "The letters" (the type page).

## 7. About us (`/about`)

Who we are, as the coding agent we build Moduo with reads us, then how Moduo started. Fifth
version. Earlier ones, in order: the agent's read section by section; the story with the agent
as margin comments; the two of us on shared scales (we didn't want to be compared); annotated
portraits (the founders didn't want photos on this page, and the copy read like a personality
test). The founders kept the hero every time. The read is Claude's (a note Mike shared from the
dogfood workspace), rewritten plainly; the evidence and every date, time, hash and message in
the story were checked against the repository on 23 October 2026. Counts leave out merges and
rebased copies (a commit counts once per author date and message). The data lives in `rhythm`,
`about`, `aboutRead`, `aboutBridge`, `aboutStory` and `aboutClose` in `src/data/site.ts`.

```
Idea:        what the agent wrote about each of us, in plain lines with their evidence, then the
             git log telling how it started.
Metaphor:    the git graph: a centre line with a node per row, then lanes that fork.
Signature:   the centre line of the read draws down as you read and each row's two lines arrive
             from it; the story's lanes keep the same pen.
Emotion:     "plain, specific, a bit dry; nobody is selling anybody."
Screenshot:  the mirrored read, Mike's lines set to the centre line from the left, Maciej's from
             the right.
```

Composition, top to bottom:
- **Hero** (unchanged): the line, the lead, our average day in strokes, "now" live.
- **What it wrote about us.** Centred title and one sentence of caveat. Under it two columns
  mirrored on a centre line: Mike's five lines set to the line from the left, Maciej's from the
  right, a node on the line per row and a hairline from it to both. Each line is a plain
  observation in sans with its evidence in mono. No photos, no headings like "Drive" or "Growth
  edge", no taglines, no closing verdict.
- **The bridge.** Our one sentence large ("We came at it from opposite ends and ran into the same
  wall."), the account under it, on the story's text column.
- **How it started** (git graph down the left margin, everything else on one text column): the
  first commit with its typed log under the story, each row's dot on Mike's lane; the 54 silent
  days counting; 11 May, Maciej's lane forking off, the night's first 8 commits under the story
  ("Show all 34" opens the rest); "Since then" with both lanes running into today and on,
  dotted.
- **Close**: it asked us where it's wrong; the address and the waitlist.

Decisions:
- **Plain lines.** Each line is something the repository shows, said the way a colleague would,
  with no trait names, no growth advice and no verdict about the two of us together.
- **Each list is its own.** In the markup each person's lines are their own list (screen readers
  hear Mike's five, then Maciej's); the grid only sets them level. No line refers to the other
  person.
- **One left edge for the story.** The bridge and every chapter share the text column next to
  the graph; the read is centred; the hero and the close keep the page's left edge.
- **Corrections from the data.** Maciej's first day was 32 commits, not 64 (each had a rebased
  copy); the hero's day chart and every total count each commit once (Mike's 4 a.m. peak is
  340, not 412).
- **Reduced motion and no JS** show the read whole, the lanes drawn, the messages printed and the
  count at 54.
- **Idle motion:** the "now" node in the hero and the "today" nodes breathe; nothing else moves
  at rest.
- **A chart's screen-reader table sits in a wrapping `.sr-only` div.** A table can't shrink to the
  1 px box: on its own it widened the phone page to 790 px and pushed the menu off screen.
- Maciej still has to approve the page: it carries the agent's read of Maciej and quotes
  Maciej's commits.

## 8. Modus, the typeface (`/modus`)

Since 26 October 2026 every word on the site is set in Moduo's own typeface, drawn from the
mark's stroke (source and history: `docs/local/Moduo Joiner/`, never committed). Its working
title was Solidus. This section is the name, the story that ties it to the mark, the brand and
the site, and the page that shows it.

### The name: Modus

Three candidates, judged on the story they tell, not on sound alone:

| | Solidus (working title) | Kreska | **Modus** |
| --- | --- | --- | --- |
| Meaning | the slash's proper name; the 45° cut; `/` links in Moduo | Polish for stroke, and the accent over ś ć ź ń ó | Latin for measure, and for manner: the way a thing is done |
| Tie to Moduo | the cut, one product gesture | the founders' language, the accent | the root of the name itself: modus → modulus (a small measure) → module → mod-uo |
| Tie to the mark | the stroke's angle | the stroke at accent size | the stroke is the measure every letter is cut from |
| Problems | a current commercial sans is called Solidus (Brown Type, 2023, on sale) | hard to say outside Poland; a detail, not a system | a 2001 GarageFonts sans is called Modus; the word is common |

**Pick Modus.** It is the only name that is the whole system: the font is literally built on one
measure (the stroke), its name is the root of Moduo's own name, and Moduo and Modus differ by one
letter, so the face reads as family. Mike proposed it; the case above makes it the right call
rather than a fun one. In font menus it is **Moduo Modus** (the brand prefix, like Airbnb Cereal,
keeps it apart from GarageFonts' Modus); in copy, Modus. A trademark search comes before it is
ever licensed for download. Solidus and Kreska stay as chapters of the story: the 45° cut, and the
Polish accent that is the mark's stroke at accent size.

### The story, as the site tells it

- **Modus is the measure.** The mark is three strokes. Modus takes one of them as its unit: stems
  stood up on a flat foot and cut at the mark's 45°, bars laid down, arches bent, bowls closed,
  the kreska made small. Corners round at 0.3 of the stroke, a touch softer than the mark's 0.2
  (0.27 until 1.1, which rounded them a little more on Mike's call).
- **One letter apart.** Moduo is mod + duo; Modus is the Latin word our name grew from. Keep four
  letters, change the last. ("Mod, and us" is the one dry joke, on the type page's word ladder.)
- **Windows are the mark's rule in letters.** Stylistic set 1 draws the overlap where an arch
  leaves its stem reversed, so it cancels the way the mark's overlaps do.
- **The wordmark is set in it.** The header's lockup types "moduo" in Modus Bold beside the mark,
  at the drawn master's proportions in units of the mark's height H (measured on
  `lockup-current.svg`: gap 0.36 H, x-height 0.44 H, baseline 0.79 H down; H is 24 px in the
  header, as on the current landing, after a first pass set the word too large for its mark),
  and the footer's wordmark plate proofs that same word on its metric lines in Modus units
  (ascender 740, x-height 520, stem 142). At rest the word is a clean outline: each letter is
  one path of all its strokes, filled to the paper under its stroke, so only the outer line
  shows. (Until 30 October the plate drew every stroke's whole outline, with fitted circles and
  dashed stems under them, at rest; Mike: "layer under layer", and the circles were a guess that
  no longer matched the face.) Point at a letter and it shows how it was built, exactly as the
  generator built it: each stroke on its own (they overlap; Modus unions nothing), the two
  edges it was cut from running a little past the cuts, the cuts, a round's boxes with the lean
  of its counter, and every point with its handles. The construction comes from the generator
  itself (`nib/construct.py` writes `src/data/modus/build.json`, per master, for a to z), so it
  stays exact when the face changes; rerun it after `modus-data.mjs`.
  Brand decision 18 says the wordmark is drawn artwork; this is the proposal for Maciej to judge,
  and both places go back to the artwork by removing `typed` and restoring the old plate
  (backup in `docs/local/landing-backups/2026-10-26-before-modus/`).
- **The credit line reads twice.** "Set in Modus." opens the type page; the colophon's ghost beat
  became the measure beat (two stacked strokes leave an outline: a template, a measure).

### The type page

(History: since 3 November 2026 the page is one endless sheet, §20. The plates below are gone.)

Concepts considered: (A) **Line of sight**: the name's strokes hang at different depths, placed so
that from the front they read as the word; off axis it comes apart into its parts (anchor: Modus
never unions its parts, every contour is a stroke; O/F/Fe/P 5/5/4/1). (B) Exploded construction
sheet (parts pulled apart by kind, labelled; 4/5/4/2). (C) A weight solid lofted Light to Bold
(4/3/3/3). **Pick A, with B's layers inside it**: the depths are the kinds of stroke, each on its
own sheet, so the exploded view explains the construction.

```
Idea:        Modus is the measure: every letter is a few strokes of the mark. The page takes its own
             name apart into those strokes, in depth, and lines them up again.
Metaphor:    an exploded drawing seen along the line of sight (anamorphosis): parts at different
             depths that read as one thing from exactly one place.
Signature:   the hero: "Modus" as ten white solids on five sheets (stems, diagonals, arch, bowls,
             spine), scaled about the viewpoint so the front view is the word to the pixel. Scroll
             swings the view off axis (the sheets and their counts appear), back into register,
             then runs the weight Light to Bold while the word's measure draws under it. One
             driver: motion/modus-hero.ts (raw WebGL, one program).
Emotion:     a quiet "oh": something solid turns out to be parts, then clicks back.
Motion verb: line up. Parts slide along the line of sight and lock into register; the brand's
             "part" grammar, in depth.
Screenshot:  the five sheets in a 3/4 view, the strokes standing on them, "4 stems · 2 diagonals"
             hung at their corners.
```

Composition (a different family per plate):

```
1 HERO · sticky 3D stage (340svh; 300 on phones): name, lead + spec bottom left, count bottom right
2 NAME · poster + ladder: "Modu[o→s]" huge, the last letter turning over along the 45° diagonal;
         title and line left, the word ladder (modus, modulus, module, Moduo, Modus) right
3 MEASURE · plate: title left; the mark's stroke and four letters with the part that is the
         stroke lit (stem, bar, arch, kreska), the rest stepping back
4 WEIGHTS · bleed poster: the brand line at the five named weights, each line one step in, so the
         starts climb the stroke's 45°; under it one word on the axis (pointer, scroll, slider)
5 WINDOWS · "modular" huge; a 45° edge sweeps the windows open; the switch
6 POLISH · the pangram drawn from outlines, letters in Ash, the nine Polish marks in Paper,
         dropping onto their letters
7 FIGURES · the visitor's own time, Light, tabular, raised colon; the app's numbers; two switches
8 GLYPHS · every character as one listbox (arrows move, one tab stop) with a sticky inspector
         drawing the glyph's strokes, outlines, points and metrics at any weight
9 TESTER · your text, size, weight, four features
10 IN USE · the sentence at 13 to 36 px, and the Tasks picture
11 SPEC · the rows, the credit, "Set in Modus." and the way on
```

Decisions:
- **The hero is the type page's one exception to "no 3D" (67).** It is not imagery: it is the
  typeface's own outlines, extruded from the font data the page ships, white on Canvas, no hue,
  no glow. The rest of the page is flat type.
- **The front view is exact.** World units are CSS pixels and the screen is the plane z = 0; each
  sheet is scaled about the true viewpoint, so the 3D word lands on the drawn word to the pixel,
  at any weight (the masters are compatible, so every weight is a mix in the vertex shader).
- **The word arrives off axis.** On load the sheets fade up seen from the side and slide into
  register (in-out ease, about 2 s); the drawn SVG word waits hidden, and shows if WebGL is
  missing. Under reduced motion there is no scene: the name is a drawing with its joins showing.
- **Idle:** the word breathes a few units of weight; moving the pointer pulls the strokes out of
  register, and they lock again when it stops. The weight plate's word breathes between 500 and
  600 until touched; the clock ticks. All on the GSAP ticker, paused off screen.
- **Labels hang on the sheets' corners**, never on the strokes, and never leave the page edge.
- **In register, the word stands on its measure.** Cap height, x-height and baseline are drawn
  under it at rest and at the end (inverting where they cross a stroke); they leave while the word
  is apart. Phones keep the lines and drop their names, which would sit on the letters.
- **In register, the joins show.** Each stroke carries a Canvas seam just outside its edge, a hair
  behind its face (`uSeam`), so from the front the word reads like the still drawing: strokes laid
  over strokes. The seams are a deliberate 9 font units (about 3 px on a desktop hero, never under
  1.5 px) and thin to nothing as the word comes apart. (Critic pass 1: the plain white word read
  weaker than the reduced-motion drawing; pass 2: hairline seams read as rendering faults, so they
  are now cuts, not hairlines.)
- **Faces are triangulated at the weight on screen.** One triangulation made at the middle weight
  folds a few slivers over at Light or Bold, so the driver re-runs earcut (a few hundred points)
  whenever the weight moves.
- **Phones read the lead under the word**, the scene's later words at the foot, and a one-line
  cue ("Scroll, and the word comes apart into its strokes") where the screen would otherwise be
  black.
- **The measure plate is the full width** under its title and words, so its five letters are drawn
  large enough to read the stroke in each. On a phone it is two columns, and the stroke, the unit,
  leads across both as a row (the figure, its label and note beside it); the four letters pair up
  under it (a lone card in the first row's left half read as a hole, 30 October).
- **The weight staircase on a phone is "One window."** five times: the whole brand line ran off
  the screen at any size the stairs could keep, so each step is the line's first two words, at a
  size the five steps fit the screen's width.
- **Every control on the page is the site's button**, with its 45° sweep: the Windows switch, the
  figures' and the tester's switches. A pressed one is filled, and its sweep runs in a dark grey so
  that under the pointer it dims but still reads as on.
- **Keycaps are Modus by name.** A `<kbd>` falls back to the browser's monospace (a slab-serif
  Courier) unless the family is set outright; Modus draws the Mac key legends itself.
- **QA:** two outside critics, evidence only. Pass 1: 7.6 (Design 7.5, Usability 7.5, Creativity 8,
  Content 7.5). Pass 2: 7.65 (7.5, 7.5, 8, 8; the type page alone 7.5 / 8 / 8). Their top
  remaining items are site-wide and older than this pass: the cookie card covering reading
  columns on inner pages, empty columns on about and the module pages, and text links whose hover
  only nudges.
- **The two dashes on the page are glyphs, not copy.** The glyph set shows every character Modus
  draws, the en and em dash included; the audit's dash warning on `/modus` is that list.
- **Removed accessory:** the closing line used to gain weight as it scrolled in. The hero and the
  weight plate already show the axis; the last line now simply arrives.
- **Every figure on the page is drawn from the font's own outlines** at build time
  (`scripts/modus-data.mjs` reads the two UFO masters into `src/data/modus/`; `lib/modus.ts`
  mixes, lays out with kerning, flattens). The inspector fetches the glyph set (60 KB gzipped)
  only as its section comes near.
- **Small text is 450.** Modus's Light master makes 12 to 14 px text thin on black; the axis
  allows a text grade without a second file.
- **Not claimed:** that the app uses Modus (it is still set in Geist), that the face is for sale,
  or who drew the mark. The credit reads "Drawn by Mike Grochowski, with our coding agent".
- **Modus 1.1 (30 October 2026):** c and C no longer crowd the next letter (kerning had counted
  their open side twice), the free ends of c, C, 2, 3, 5, 6 and 9 come further round and end square
  to the stroke, ® and © hold the face's own R and C, and corners round at 0.3 of the stroke (was
  0.27).
- **Modus 1.2 (30 October 2026):** Mike: the glyphs looked "not fully
  finishing"; every free end now reaches its letter's outer line, so nothing stops short: the base
  of 2, the top of 3 (it now comes round like the 2's), both ends of 5, the top of 6 and the tail
  of 9, the lower ends of c, C and e, the top of G, the tail of g, both ends of s and S, the bars of
  z and Z, and € (now C's round). The t's tail was the other way round: it ran past the bar, and now
  ends under the bar's nose (2,058 kerning pairs, 35 KB).
- **Oudom 1.3 (3 November 2026)** is what the page ships. Mike caught the colophon's zoom ("the
  stem of this d", then the mark's stroke laid over it) as a lie: the stem's top was the face's
  softer corner, so the stroke stuck out above it. Now every end cut at 45 degrees ends in the
  mark's own corners: on a straight stroke (every stem, bar, the 1's nose, the kreska, quotes and
  comma) the corners of the mark's stroke exactly as drawn, scaled to the stroke; on a curved one
  the mark's radius and handle. Stem tops reach their line plus the usual overshoot (b d h k l and
  the capitals' stems a few units taller); bars keep their 1.2 lengths, so no letter changes width;
  the kreska, quotes and comma come out a little longer, as the mark's stroke is. The page's
  numbers follow: 2,043 kerning pairs, 38 KB. After any font change: copy the woff2 (renamed to
  Oudom, §16), rerun `scripts/typeface-data.mjs`, rebuild.

## 9. The product pages (27 October 2026)

Mike: "create entire set of missing subpages and nice to have subpages with outstanding sales
level copy and top notch design … fully production scale top marketing top seo product page".
Every "Soon" in the footer that is ours to build became a page, plus the pages a product site is
expected to have. Facts come from the repository (surveyed 27 October: the MCP server, the
security posture, integrations, import and export, platforms, shortcuts); nothing is claimed that
the code doesn't do.

| Family (the hero's chain) | Pages |
| --- | --- |
| Product | `/ai` AI and MCP · `/integrations` · `/security` · `/download` · `/compare` |
| Resources | `/help` help center · `/import` import guide · `/mcp` MCP docs · `/shortcuts` |
| Moduo for | `/for/freelancers` · `/for/founders` · `/for/teams` |
| Company | `/press` press kit (with About, Manifesto, Colophon, Typeface) |

The kit every page uses (`components/page/*`, `styles/page.css`, `data/pages.ts`, `lib/seo.ts`):
- **PageHero**: the module pages' grammar. The page's name at display size, the line and words
  bottom left, the family's chain bottom right (strokes are the family's pages, this one lit).
- **Head**: a section's title on line 1 and its words on line 9 (or stacked under it).
- **Related**: the page ends on three pages to read next, cards whose two strokes close into a
  window under the pointer. The footer then carries the waitlist form.
- **Code**: text to copy, in Geist Mono, with a Copy button that confirms in place (`motion/copy.ts`).
- **SEO**: a unique title and description, BreadcrumbList on every page, FAQPage where a page
  shows questions, HowTo where it walks through steps, SoftwareApplication on download.
- Each page's copy lives in `src/data/pages/<page>.ts`; its pictures in `components/<page>/`; its
  one driver, if it has one, in `motion/pages/<page>.ts`, loaded only where `[data-pg]` names it.

Rules held on every page: one signature moment and quiet around it; the product is the only
picture (the app redrawn, or hairline diagrams built from the stroke); inner pages hold still at
rest; named competitors only on `/compare` and `/import` (brand 62); no eyebrows, no gradients,
no icons as decoration.

Each page's signature, as built:
- `/ai`: **the key's reach.** The app's API-key card (seven modules, None, View or Edit) beside all
  105 tools as chips; changing a level parts the chips in or out and the count follows ("68 of
  105 tools open"). Tools that also need Edit elsewhere are dashed, as the server rules them.
- `/mcp`: a reading page with a rail: the connector, sign-in, keys, levels, limits, every tool.
- `/security`: **the map.** Four places on one line (your mail provider, your computer, Moduo in
  London, your assistant), each wire labeled with what crosses it; "Follow" lights one thing's
  path (Anna's email, the task it became, your assistant's question).
- `/press`: **the logo, measured**: clear space drawn with the lockup's own "o", the smallest
  sizes at size, the files on their grounds, six struck misuses, the lines with Copy.
- `/download`: **one window, three frames.** Home in a Mac, Windows or browser frame; switching
  passes the 45° band over the window. The visitor's own door gets the filled button.
- `/integrations`: the six module strokes with what feeds each one wired above it, and an index
  whose rows close two strokes into a window under the pointer.
- `/import`: **the move.** A Notion export's files wired at 45° to the note tree they become,
  beside the import dialog with Undo.
- `/help`: search that answers as you type over 42 questions, all in the HTML.
- `/shortcuts`: **a live keyboard.** Held keys light and the readout names the chord; until you
  press or tap, the row in the middle of the screen waits on the board. Phones keep only the
  readout in sight (the keyboard would cover a third of the screen).
- `/compare`: **where things live.** One morning in a stack (16 places, 10 copies) collapses into
  Moduo's chain (6 places, 0 copies, 5 links); then app-by-app "keep it if" rows and the bill.
- `/for/*`: **the day as a chain.** Six moments joined by the gesture that links them, with one
  sticky picture that changes with the moment in view.

Decisions from the first outside critic (7.55: Design 7.5, Usability 7.5, Creativity 7.5,
Content 8):
- **The consent card is one low row**: the question, the policy link, Decline and Accept. Its
  explanation is read out with the question and lives behind the link. It covered content in
  most desktop frames.
- **The first Tab finishes every arrival on the page** (`engine/reveal.ts`), so no link waits,
  hidden, for a scroll.
- **Under a hero the first section starts close**, so its head shows on the first screen and no
  hero ends on an empty band.
- **A chosen filter doesn't answer the pointer** (`[data-one]`): its sweep read as disabled.
- **Small text on raised fills is Mist at 86%** (`--c-subtle`), never Ash: Ash fails AA there.

Decisions from the second outside critic (7.55 again, a fresh juror; compare named the weakest
page):
- **The links are drawn on `/compare`.** Once the chain stands, a leader rises from each window
  through the strokes (inverting what it crosses, the home scene's rule) to the link's name, set
  on the stroke's 45° so five names fit at every width. The plate is shorter.
- **The reader's scroll moves the morning** (one number, `--t`, every part reading its own
  stretch of it), from the plate's top at mid screen until its middle is; a button takes over
  once pressed. A timed play left a half-formed chain on whatever frame you stopped at; now every
  frame is a step of the story, and the stack's names hold while the copies close.
- **Text links that lead somewhere answer with a stroke** (`.go`): under the pointer, and on the
  row you are reading in a rail, the real stroke slides in before the words and they step aside.
  The 404's way home and every long page's rail use it. Back links draw a line back from their
  arrow; inline links also brighten.
- **Reference pages open compact** (`PageHero compact`: help, import, MCP docs, shortcuts): the
  name at section size beside the chain, so the search, the guide or the keys start on the
  first screen. The product and company pages keep the display name.
- **Help's topics stay in reach on a phone**: one row under the header that scrolls sideways.
- **13 px is the smallest running text** (`--t-xs`); the footer's specimen notes are 12 px.
- **The "Moduo for" stage centres its pictures with the grid**, never `translate`: GSAP owns
  their transform and folded the CSS one away, which left every card cut at the panel's edge.

## 10. Log in (`/login`, 28 October 2026)

Mike: moduo.app today sends people straight to the app's sign-in at app.moduo.app; this site
needs that door too, with the left half of the reference he showed (a butterfly rendered as an
animated ASCII specimen under a tracking instrument) made from Moduo's mark.

- **The session stays where it lives.** The app never takes a session from a URL
  (`apps/app/src/lib/auth-url.ts`: a fragment is a login CSRF, decision data.md 2026-10-08), so
  this page can't send or check the code itself. Its form hands the address to
  `app.moduo.app/auth?email=…` (a plain GET without script). The app ignores the parameter today:
  until it prefills the field from it (and only prefills, never sends a code from a link), the
  address is typed twice. The words are the app's own sign-in screen's, so the two read as one
  step.
- **The specimen** (`components/login/Specimen.astro`, `lib/specimen.ts`, `motion/pages/login.ts`):
  the mark extruded one corner radius deep, turned in front of an orthographic camera and read
  out as a grid of Geist Mono cells. One ray per cell through a signed distance field of the
  mark says face, side wall or nothing, and how much light it sends back; lit face cells are
  boxes with a letter cut out (`0OMDUXS#=/`: the name's letters, a zero, the stroke's slash),
  walls and the dark side are small marks. A grain fixed to the surface turns with it. It runs
  as footage, 30 frames a second, each letter held on its own phase.
- **Every number in the corners is live**: the cycle and what the mark is doing (SWAY, SPIN,
  DRAG, LOCKED), the frame of the cycle, the light threshold, the share of cells that changed
  this frame, the grid, yaw and pitch. The foot names the rule the mark is built on:
  `VISIBLE = (L ∪ R) XOR M`. Tracking boxes on the two windows came out on Mike's call
  (28 October): they cluttered the mark.
- **Calm: it sways, then spins slowly.** A 24 s cycle: about nineteen seconds of a slow sway, 18°
  either side of the front, then one full spin over five seconds, eased at both ends. Letters
  hold twelve frames and about 3% of cells change a frame; the dust drifts, the pitch breathes
  on a 19 s period. A plain turn left the mark edge on (a thin slab of dots) in about 40% of
  frames, which the blind critic flagged; now it is edge on or showing its mirrored back for
  under a tenth of the cycle (tested). Drag turns it further, with carry, and it eases back to
  the front; horizontal only, so a phone still scrolls.
- **A valid address locks it**: it squares up to face you, the threshold drops so the whole
  face lights, the readout says LOCKED. Continuing lights every cell, walls too, then hands over.
  Typing stirs the letters.
- **Brand exception, decided**: the mark here is a 3D solid drawn in type, against "the logo is
  never distorted" and "no 3D" (67, 69). Mike asked for it on 28 October and Maciej approves the
  site's calls; it is the one place the mark is a specimen rather than a logo, as the type
  page's 3D hero is for Modus.
- One task, so no header or footer (`Base bare`), and no lockup: the specimen is the mark, so a
  logo over the form only repeated it (removed on Mike's call). "Join the waitlist" sits top
  right (it says "On the list" once you are); the way home is the first link at the foot, beside
  the legal links. "Log in" is in the header beside the one action, in the phone menu and in the
  footer's product column.
- Reduced motion: one still frame three quarters on, redrawn when you drag or type. No script:
  the mark itself, quiet, and the form still works.
- Blind critic, 28 October: 7.15 (Design 7, Usability 7.5, Creativity 7, Content 7; developer
  areas 7 to 9). Fixed after it: the edge-on frames and the column's three edges (since then the lockup is gone). Kept on
  purpose: the instrument's terms (THR, HOLD, the XOR line) are the look Mike asked for, the
  primary button's hover is the site's XOR sweep, and the title is the app's own words (an
  invite does create the account).

## 11. The hero: First light (28 October 2026)

Mike, of the clean product poster: it was "completely missing character - creativity,
originality, art", perhaps for want of "some animated background or some breakdown with animation
or some colors some shaders", with nine references (a desk in a meadow under a giant moon, a glass
orchid over a serif word, a mirrored monolith in a lavender wood, light through a gap between two
rock towers, a Game Boy in a field of flowers, a blurred landscape behind a product card). "Just
surprise me."

What the references share is not a style but a picture: one object in a place, at an hour, lit by
one light. Three territories:

| | A. First light (the mark and the sun) | B. Ten windows go dark (the campaign line) | C. The overlap field (the rule as weather) |
| --- | --- | --- | --- |
| Idea | The light gets through the mark only where its strokes overlap: the windows. | A night facade with ten lit windows, each an app's glow; they go out one by one and one window stays lit. | A live field of drifting strokes; wherever two overlap they cancel into a window of light. |
| Anchor | The mark's construction: its windows are where modules meet ("where they meet, something opens", brand 12). | "Fire ten apps." | The XOR rule. |
| O / F / Fe / P | 5 / 5 / 4 / 1 | 3 / 4 / 4 / 3 | 3 / 3 / 4 / 2 (and abstract imagery, which brand 67 is most against) |

**Pick A.** Only Moduo's mark has windows, so only Moduo can have this light.

### First cut: the monument (kept as history)

The mark as a dark monument on a ridge before sunrise, the sun behind its right stroke, two white
shafts through its windows falling at the stroke's 45° through mist onto Home; on scroll the
light went out and the stone filled with light to Paper. Blind critic: 7.4 (Design 7.5, Usability
7, Creativity 7.5, Content 8); fixed after it: the scroll handover (a cut), the missing hero
action, the intro's length. Files: `docs/local/landing-backups/2026-10-28-before-osaka/`.

### Second cut: Osaka (Mike's direction, the same day)

Mike loved the concept and sent the picture he wanted (an office high over Osaka at golden hour,
the castle and the river below, the mark on the desk in glass with the sun breaking in it): "the
sun is shining directly into the moduo mark which is breaking into a single stroke working as a
prism shard, reflecting the prismed light into the product mockup, and the product mockup borders
should absorb this prismic light"; "the only issue is I have no idea how to later transform the
single stroke back to the full mark, because we have the scroll animation with it".

**The answer: the single stroke is the mark, folded.** Its three strokes stand one behind the
other; glass follows the mark's own rule by parity. Where an odd number of strokes overlap (one,
or all three) the glass splits light into a spectrum; where exactly two overlap (the mark's
windows) the second prism undoes the first, as in Newton's second-prism experiment, and the light
passes whole. So scrolling just slides the side strokes out to the mark (brand 54's reveal,
"separation reveals"): the windows open, the rainbow gives way to two white shafts through them,
the right stroke covers the sun, and from there the earlier handover runs as built (the stone
fills with light to Paper, the scene's canvas takes the mark on the same pixels and grows it).

```
Idea:        An office over Osaka at golden hour. On the desk, one glass stroke of the mark
             catches the sun and splits it; the colors fall on the app, and its frame takes them
             in. The stroke is the mark folded: scroll, and it opens into the mark, the colors
             come back together into white light through its windows.
Metaphor:    a prism on a desk (one stroke splits the light) and Newton's second prism (two
             overlapping strokes undo it): the mark's XOR rule, by parity, in glass.
Signature:   the intro (first visit): the room comes out of the dark with the mark standing on
             the desk, the sun behind its right stroke and white light through its windows; the
             mark folds into one stroke, the sun comes out from behind it, and the spectrum runs
             out of the foot over the desk onto the app's window, whose frame lights with it. On
             scroll the fold opens again. One driver: motion/first-light.ts; the scene:
             lib/first-light.ts.
Emotion:     the warmth of the last hour of a working day, and a small "oh" when the stroke opens.
Motion verb: fold and open (the brand's "overlap cancels, separation reveals").
Screenshot:  the dark glass stroke on the desk, the sun beside it over a soft Osaka, a spectrum
             fanning from its foot onto Home, Home's frame lit in colors.
```

The first Osaka build drew the room and the city in a shader too (procedural skyline, castle,
river, depth of field). Mike, of it: "you had to generate an actual background image like this,
not code the image", with the photograph he had made (an empty office over Osaka at sunset, the
castle and the river below, a laptop and a mug on a dark desk). The coding agent has no image
generator in this setup, which it should have said before drawing one in code. The procedural
build is kept in `docs/local/landing-backups/2026-10-28-osaka-procedural/`.

### Third cut: the photograph (built)

How it's built:
- **The photograph is the world** (then `public/hero/osaka-office.webp`, 1678 × 962, from Mike's
  image; since the fourth cut, the clip's first frame). `PHOTO` records its size and what was measured in it: the sun at (1153, 355),
  the desk's back edge at y 636. The page lays it out like `object-fit: cover` (`cover()`,
  tested), centered on wide screens and 86 % across on phones, so a phone sees the sun, the
  towers and the desk.
- **The glass stands on its desk** at a place set in photo pixels (`PLACES`): wide screens right of
  the laptop, the sun just above its left side, as in Mike's picture (box 1096, 404, 340 wide);
  phones a little further forward, in the part a phone shows. The driver moves the page's mark
  box there (`[data-light-mark]`), so the scene below still grows the mark from the same pixels.
- **What is drawn live** over the photo (one pass, `MAIN`): the dark glass refracting the photo
  behind it a little split by channel, its rim gold where it faces the sun and spectral where it
  turns away, the light it carries down to the foot, its reflection on the satin desk, a soft
  sunbeam from the sun into its flank with dust in it, the sun breathing, and the spectrum out of
  the foot. The spectrum falls away from the sun (down the mark's other 45°, `FAN`) and lands on
  Home's top edge, whose frame takes the colors in (`fanAt`, `.hwin__prism`). The pointer turns
  the spectrum across Home's tabs and it drifts a little at rest (`FAN_TURN`).
- **Stills** (`first-light-wide.webp`, `first-light-narrow.webp`, about 92 KB each): the photo
  with the glass and the spectrum rendered in by the same shader (`scripts/first-light-poster.ts`),
  cropped with the same object-position. Shown under reduced motion, without WebGL, if the live
  scene can't start within 3 s; the live canvas sits over them.
- **Legibility:** the words sit on the photo's dark wall on a laptop; a CSS dimming over the
  layer (`.scene__light::after`: the header's band, a ramp over the words' half, the foot into
  the page) keeps the subline readable where it crosses the window. Phones read the words over
  the sky, on a stronger scrim (`.hero::before`).
- **Scroll** as before (`HERO_LEAD`, `HERO_BEATS`): the whole first screen holds (the room is a
  sticky layer, `.scene__light`; interlock.ts counters the scroll for the words and Home: Mike,
  "headline should not scroll up when the single stroke turns into the mark"); the stroke opens
  into the mark, white light through its windows; the room goes dark; the stone fills with light
  to Paper; the scene takes the mark; the words fade where they stand.
- **Intro** 2.5 s on a first visit on a GPU (the room out of the dark with the mark standing open,
  the fold, the spectrum running out); otherwise a 0.7 s fade on the folded stroke.
- **Cost:** home is now about 335 KB (the photo plus one still; the other still is only fetched on
  the other kind of screen). Throttled phone LCP 2.1 s, CLS 0.
- **Better source:** the photo is 1678 px wide, so on a 2x laptop or a 2560 px screen it is soft.
  A 3200 to 4000 px export of the same image drops in as `osaka-office.webp` (update `PHOTO.w/h`
  and the measured sun and desk if the framing changes, then run the poster script).

### Fourth cut: the clip, and the glass in depth (built)

Mike, the same day: "let's use it as a gif instead of the flat image" (his golden-hour clip of the
same office, its sun pulsing and its rays turning), "make the stroke behave correctly with the sun's
movement", and "the strokes together as the Moduo mark should be more 3D, have more depth". The
attachment arrived as a file icon only; the clip used is `~/Desktop/golden-hour.mp4` (1920 × 1080,
30 fps, 20 s), the source of his GIFs (`golden_hour_bg.gif` is the same footage, same grade).

- **Not a GIF.** The GIF is 33 MB at 256 colors; the page plays the clip as video instead:
  `scripts/first-light-video.ts` makes a seamless 19 s loop (its last second cross-fades into the
  first) and encodes VP9 WebM (856 KB; 528 KB at 720p for phones) and H.264 MP4 (1.35 MB; 632 KB)
  for browsers without VP9, plus the first frame (`osaka-office.webp`), the stills' base. The
  video loads only with motion (the driver gives it a source), muted, looping, inline; it pauses
  off screen and once the room has gone dark.
- **The live scene reads the clip.** Each new frame is uploaded as the shader's texture, so the
  glass refracts the moving room. If the clip can't play (Low Power Mode, an error) the first
  frame is used; a software renderer gets that frame too, at half resolution.
- **The glass follows the clip's sun.** The same script measures the sun ten times a second
  (`src/data/first-light-sun.json`: its centre, which drifts about 14 px, and its power, 0.9 to
  1.07 of average); `sunAt(video.currentTime)` feeds the shader, so the rims, the bevels, the
  light inside the stroke, the sunbeam into it and the spectrum out of it brighten and dim with the
  sun's pulse, and the rims face where the sun is.
- **Depth.** The glass is a solid: its front face is the mark's rule; its back face stands
  `DEPTH` behind it (up and to the left, the camera looking a little down from the glass's left),
  46 units folded, 72 open. The walls between are found by slicing (28 slices, the outline refined
  by ternary search, the visible wall surface by bisection, its normal taken from the nearest
  stroke's own edge so it never flickers where edges cross). Walls catch the sun where they face
  it, with a bright line where the back face ends; open, the windows become tunnels and the light
  comes through what is left of them.
- **Placement** rescaled to the clip's frame (×1.144 from the photo): wide (1254, 452, 389 wide),
  phones (1268, 585, 343 wide); the sun on average at (1307, 393), the desk's back edge at y 700.
- **Cost:** 60 fps on an M4 Pro at 2x up to 2560 × 1440 with the clip playing, no dropped video
  frames; the canvas redraws only when the clip has a new frame (30 fps) or something moves.
  Weight with motion: about 340 KB of page plus the clip (856 KB or 528 KB).

### Fifth pass: the light's path (28 October 2026)

Mike's five notes on the clip build, and what changed:
1. **The glass on the right, facing the mockup's centre; the sun's rays pointing into it.** The
   spectrum is aimed at the centre of Home (measured live; on a laptop down and to the left, about
   the stroke's 45°; on a phone nearly straight down) instead of away from the sun, and opens wider
   (half angle 0.3). The sun's own rays are drawn now: from the clip's sun, only the ones that
   reach the glass (each pixel looks on along its ray; if the glass lies ahead, the ray reaches it),
   streaked like the clip's rays and turning slowly, brightening with its pulse. So light goes in
   from the sun and colors come out toward the work. The stroke stands a little higher on the desk
   (wide 428, phones 545 in frame px) and Home sits a little lower (its band 20svh), so the light
   has room to fan.
2. **The mockup takes the light in.** Nothing of it reaches the window's content: the spectrum and
   the mark's white shafts stop at Home's top edge (`uStop`), and the wash that carried the colors
   down the window is gone. The frame's border lights in the spectrum's colors along the stretch
   the light lands on, glowing, and a little way round from there.
3. **The mark's windows are clear.** They show the clip behind them as it is; the tunnels' walls
   are near-clear glass with thin lines at their edges; the outer walls are see-through glass too
   (the room at 38 %, a sheen where they face the sun).
4. **The light follows the rounded frame.** The straight 2 px line on the top edge is gone; the
   border light is a ring with the frame's own corner radius (`--win-r`, measured from `.ap__win`).
5. **The header stays clear over the hero.** On a page with a hero picture (`[data-light]`) the bar
   turns solid only once the picture has gone by (motion/header.ts), not 40 px down.
6. **The glass faces the middle of the screen.** (Mike: "they are facing the right direction and
   should face left / mid of the screen".) Its depth now runs up and to the right, so it shows its
   right side and top and its face turns left, toward the mockup; the mark itself is never
   mirrored. The far sides, away from the sun, glow with the light that came through the glass to
   them, so the depth still reads on the shaded side.
7. **No drawn rays; the open mark's light goes to the middle too.** (Mike: "remove the custom sun
   stroke-projectiles"; "the mark is still shining to the right instead of the centre".) The rays
   drawn from the sun into the glass (item 1) are gone; the clip's own sun does that work. The two
   white shafts the open mark lets through its windows are aimed along the spectrum's line, at
   the mockup's centre, instead of away from the sun, and stop at its edge.
8. **Calm.** (Mike: "ultra clean, calm and chill, not busy"; the mockup "too cut, almost no
   context"; "remove the Join the waitlist button, it's already in the nav".)
   - The hero's button is gone; the header's is the one action on the first screen (the scene
     still ends on one).
   - The line is a step smaller (5.5rem at most, was 7.75) and a weight lighter (Modus 500, was
     600), closed up to -0.035em at 0.98 leading; the words under it are at reading size
     (17 to 20 px), Modus 400, in the reading grey.
   - Home shows its main part: inset one column each side (cols 2 to 11) and given the lower 38 %
     of the screen, so its bar, Tasks, the day and the inbox are in view (phones: 30 %, the
     inbox and its rows).
   - To make that room the room is lifted (`--lift`, 15svh; 9 on phones): the clip, its stills
     and the live canvas sit higher than the hero, so the desk the glass stands on ends above
     Home; under it is the page's black. The driver places the glass and the light in the
     layer's coordinates and the mark's box in the hero's. The header's scrim moved with it (the
     screen's top is --lift into the layer).
9. **The room's layer leaves with the hero.** It is sticky across the whole scene (with a
   negative bottom margin so it takes no room), so at the scene's end it stayed pinned and its
   dark canvas covered the next section's top ("Six modules. One window."). Past the hero's lead
   it is hidden (`.is-gone`, motion/first-light.ts), and shown again on the way back up.
10. **Phones (28 October).** (Mike: "make it all look stunning and correct on mobile phones".)
    - **A phone held upright gets its own frame of the clip:** the castle and the river on the
      left, the sun on the right just under the words (it used to sit behind the subline, under
      the words' scrim and the wall's darkening, so a phone never saw the light's source), the
      glass on the desk between them, its spectrum running straight down onto Home
      (`PLACES.narrow`: crop 63 % across, top-aligned; the glass at 997, 475, 300 wide).
    - **Zoom instead of shifting.** To bring the sun below the words without exposing a black
      band at the top, the frame is zoomed about its crop point (`--z`: 1.045, short phones 1.12),
      on the still and the clip in CSS (`scale` with that transform-origin) and in the live scene
      (`cover(…, zoom)`, which reads `--z`), so all three land on the same pixels.
    - Phones drop the wall's sideways darkening (the words have their own scrim, a little longer:
      42svh); Home takes 25.5svh (short phones 19.5svh, with the line and words a size smaller)
      so the light has room to land.
    - **A phone on its side uses the laptop's frame** (`NARROW` is now portrait only): the wall
      behind the words, the glass on the desk to the right, the room lifted 14svh, Home 30svh.
    - **The scene on phones:** the ribbon stands in the middle of the room under its words, so
      the stage no longer leaves with an empty lower half (the black gap before "Six modules"
      halved); the plate's chain sits a little higher.
    - Checked at 360 × 780, 375 × 667, 390 × 844, 430 × 932 and 844 × 390 on the GPU, and the
      crawl's phone pass on every page type (no overflow, no small targets, no axe violations,
      throttled LCP 1.0 to 1.9 s, CLS 0).

Decisions:
- **No location in copy** (brand 230): Osaka is only in the picture.
- **Brand exceptions, decided:** a 3D mark in glass, color, a photograph that isn't the product
  (against 14, 67, 69); Mike asked for it and Maciej approves the site's calls. The mark is never recolored: the
  glass is dark, the colors are the sun's.
- **The hero's action stays** ("Join the waitlist" under the words). (Removed in the fifth pass,
  item 8: the header carries it.)
- **Fixed on the way:** the desk's light used `exp(-(y - desk))` above the desk too, which
  overflowed to infinity and blacked out everything above it once mixed by 0; every such term is
  now clamped. The frame's ring mask was written with the standard `mask` before the prefixed
  one, so Chrome painted the whole window in the spectrum; the standard pair now comes last with
  `mask-composite: exclude`.
- **Critic pass 1 (Osaka, procedural): 7.35** (Design 7, Usability 7.5, Creativity 7.5, Content
  8; developer areas 7.5 to 8). Its reading: the stroke splits sunlight over the product, and on
  scroll the prism turns back into strokes and the M. Fixed after it: the spectrum flooding Home
  (the mask bug), the window's edge cutting the words, no incoming light, a still scene with a
  pointer that moved only the backdrop. No outside critic has scored the photograph build yet. Not taken: the hero button's hover (the site's XOR sweep,
  section 2) and the cookie card (site-wide, older than this pass). Its one doubt, that a prism
  splitting one light into many reads against "many apps into one", is answered by the scroll:
  the folded stroke splits, the open mark makes the light whole again; the copy never states it.

### Sixth pass: the light, live (28 October 2026)

Mike's three asks: could the sunbeams touching the stroke be detected live, so the prism's light
is in motion the whole time; more depth in the glass and the mark; and a stroke-to-mark
transition "ultra advanced yet clean, soft and chill".

1. **The rays read off the clip, live: built, then removed the same day** (Mike: "too heavy").
   What it was: ten probes down the stroke's centre line; each new frame drawn small and read
   back (about 2 ms, so at most twelve times a second), each probe reading how bright the clip
   was along its line back to the sun, a ray being how much brighter that line was than its
   running mean over 5 s; the rim, the light inside the glass, each band of the spectrum and the
   mockup's frame followed the rays. (A first take compared each line with the lines beside it:
   the probes' lines were 7° apart, the same as the offset, so a broad ray read as bright on every
   other probe and the glass broke out in blotches.) It is gone without trace: no readback, no
   probes, no uniforms; the glass's light is even again and moves only with the sun's pulse from
   the track. What stayed from the work is the light that comes in through the sun-facing side
   and scatters into the smoky glass, warm where it enters, cooler deeper in (`dIn` walks from the
   pixel out toward the sun to that side, so it holds for any sun and the open mark too), now at
   one quiet level. The build with the meter is in
   `docs/local/landing-backups/2026-10-28-prism-live-meter/` should it ever be wanted.
2. **Depth.** The walls are brighter at their front edge than at the back and reflect the room
   they face (the sky over the top, the towers at the side), with a warm smoke tint (a neutral
   wall beside the orange sky read green). The glass casts a soft long shadow on the desk away
   from the sun, toward you, with the contact under its foot, and the spectrum falls inside it as
   it does under a prism; the lit rim reflects in the desk. The glass turns a hair with the
   pointer and breathes at rest (`GLASS_TURN`: its depth's direction and length), so its volume
   reads as you move.
3. **The transition.** The sides no longer slide out as one: the left leads and the right follows
   (`offL`, `offR`), each lifting 16 units on the way and settling, so the opening reads as two
   moves; at 0 and 1 they stand exactly where the mark's rule puts them. The spectrum's colors
   draw together and whiten as the mark opens (the second stroke undoing the first) before the
   white light comes out of the windows; while the stone fills with light a soft glow stands
   around it in the dark room and settles. The lead is longer (`HERO_LEAD` 9 %, was 6.4; the
   scene is 484svh past the first screen) with the opening over its first 56 %, and the opening
   lags the scroll a little (`scrolled.eased`, 130 ms), so the sides move like something with
   weight; the dark and the Paper follow the scroll as it is, so the hand-over still lands on
   the pixel (checked at 0.086, 0.09 and 0.094 of the scroll). The intro's fold takes 1.5 s
   (was 1.3).
4. **Checked:** 60 fps at rest at 1440 × 900 @2x and 390 × 844 @3x; the hand-over; phones (the
   narrow frame's sun is up and to the right of the glass, and the light comes in on that side);
   the stills re-rendered with the new look; no console output. The JSON sun track still says
   where the sun is and how it pulses (measured once, exact).

### Seventh pass: the sunset clip (30 October 2026)

Mike: "I have a new hero section background, let's replace it; find on desktop
sunset_osaka.mp4". A drawn sunset over the city from the same office, 1920 × 1080, 24 fps, 30 s:
the laptop and a chair at the left, the sun low on the horizon at the right, the desk a strip
along the foot of the frame. The same pipeline took it (`scripts/first-light-video.ts`, now
reading the clip's own length and frame rate; the loop is seconds 1 to 30 with the last second
crossed into the first) and the stills were re-rendered. What changed in the scene:
- **The frame is lifted.** The desk in this clip is a strip along the foot of the frame
  (y 900 of 1080), which on its own sat under Home on every screen, so a first cut stood the
  glass over the city with its foot at Home's edge; Mike: "the stroke is weirdly positioned,
  previously it was sitting on the desk… move the background more up or something". Each
  placement now lifts the frame (`Place.dy`, a share of the layer's height; the CSS
  `translate`s the clip and the still by it, `cover()` does the same): wide 18.5 %, so the
  desk's back edge lands where the golden-hour clip's did (583 px on a 900 px screen), narrow
  18.5 % too (first cut 7 %: see the phone fix below). The top of the sky is cropped; nothing
  shows under the frame's foot, Home covers it.
- **The glass stands on the desk again** (`PHOTO.desk` 900): wide at 1365, 620, 400 wide (a
  touch wider than the 389 of the golden-hour clip, so its top comes nearer the low sun), the
  sun just above its left side as before; phones at 1154, 696, 300 wide, on the desk's far
  edge left of the sun, the crop anchored at 0.74 so a phone sees both. The words now sit on
  the dark chair and laptop at the left, which reads better than the clouds did.
- **The sun's power is held to 0.7 to 1.3** in the track: the drawn sun flares to 1.5 and
  dips to 0.56, more than the glass's beam and the sun's breathing are tuned for.
- **Weight.** The drawn frame carries far more detail than the photograph: at the old settings
  the 1080p copy was 7.7 MB, so the copies are a step more compressed (x264 crf 29, VP9 crf
  40) and keep the source's 24 fps: 1080p 5.0 MB mp4 / 3.8 MB webm, 720p 2.4 / 2.1 MB (the
  golden-hour clip was 1.4 / 0.9 and 0.65 / 0.5). The clip is fetched only once the scene
  runs (`preload="none"`), so first paint and LCP are unchanged. The old clip and stills are
  in `docs/local/landing-backups/2026-10-30-hero-golden-hour/`.
- **Phones, fixed the same day.** Mike, with a 393 × 852 screenshot: "the hero is not working
  properly on mobile". At 7 % the desk and the glass's foot were still under Home on a phone
  (the desk's back edge landed 50 px below Home's top edge), so the glass hung over the city,
  cut off by the window. The narrow placement now lifts the frame 18.5 % as well: on 390 × 844
  the desk's back edge lands 50 px above Home, the glass stands on it with its foot in view and
  its light falls the short way onto Home; the sun sits just under the words, right of them.
  Two things followed. The spectrum is aimed at the centre of the part of Home in view
  (`light-frame.ts`): on a phone the window is wider than the screen, so its own centre pulled
  the light off the right edge. And the phone's scrim behind the words is no longer a band of
  the screen's height (48svh, which dimmed the sun on a tall phone and ended above the last
  lines on a short one, where the sun's glow then sat behind "in one window"): it is a grid item
  under the words' two rows, as tall as they are on any phone, bleeding to the screen's top and
  edges and fading out 5 rem below the last line. The narrow still was re-rendered (`stop` 960,
  Home's top edge in frame px at that size). Checked at 390 × 844, 393 × 852, 375 × 667,
  412 × 915, 844 × 390 and 1440 × 900, live and under reduced motion.

### Eighth pass: the room defocused (30 October 2026)

Mike: "idk why the hero still looks very busy, very unclean, but I have no idea why, can not
define my point of view; can you help making it look better, cleaner, softer, more chill?" Read
cold from the screenshots, five things were shouting at once, and the first was the loudest:
- **The drawn frame is all detail.** Every window of the city lit, every cloud edged, the
  laptop and chair cut sharp: a picture with no depth of field, so nothing in it is quieter
  than anything else, and the words, the glass and Home all compete with it. The web copies are
  now defocused as a lens focused on the desk would leave the city (`scripts/first-light-video.ts`,
  `LOOK`: a 5 px gaussian blur at 1080p, contrast 0.93, saturation 0.84; the sun's track is still
  measured on the clip as it is). The sunset is a mood behind the words, the city a soft field of
  lights, and the one sharp thing in the frame is the glass, which the shader draws over the clip.
  Three amounts were tried as a CSS filter on the live canvas before encoding: 3 px kept the
  busyness, 10 px turned the room into blobs, 5 to 6 px kept the room and lost the noise.
  A side effect: the copies are a third of their size (1080p 1.7 MB mp4 / 0.6 MB webm, 720p 0.8 /
  0.4 MB; they were 5.0 / 3.8 and 2.4 / 2.1), since the detail was what cost.
- **The wash was heavy and ended mid-screen.** The words' side was dimmed by 0.6 to 0.42 at a
  third of the width, out by 58 %: a dark half and a bright half with a muddy seam. Now 0.46 to
  0.3 at 30 %, out at 66 %, and the top band 0.5 to 0.22 (was 0.62 to 0.28), both over the quiet
  clip, which needs less help. The phone's scrim stepped down the same way (0.6 to 0.48).
- **The glass's rim read as neon** against a soft room: its strength is held a third under
  (`rim`, lib/first-light.ts), the hot point at its foot 0.8 (was 1.1), the spectrum on the desk
  1.35 (was 1.7), the light Home's frame takes in at seven tenths.
- **Too much moved at rest.** The dust at 0.4 (was 0.6), the spectrum's shimmer 0.12 (was
  0.18), the pointer's idle drift of the glass and the spectrum each a third lower, and the sun's
  pulse held to 0.8 to 1.2 (was 0.7 to 1.3).
- **Unchanged:** the line, the lockup, the sub, Home and its place, the glass's place and the
  scene's beats. The picture is the same picture, focused differently.

Checked: 34 tests, build, typecheck; the home shoot clean (no console errors, no failed
requests, no axe violations, CLS 0, LCP 0.43 s laptop / 1.9 s throttled phone, 60 fps on both,
where the phone had dropped to 50 with the heavy clip). The busy copies of the clip, the stills
and the sun track are in the session's scratch folder only; the pipeline reproduces them from
Mike's source with `LOOK` removed.

## 12. First light, typed: built and removed (28 October 2026)

Mike, after the sixth pass: "give it a shot with some different direction, completely from
ground zero: redraw this, or a generally similar background scenario, in ASCII, with colors and
sunbeams animation and stroke and prism and stroke animating to mark, everything entirely; apply
it as a separate hero section version, switchable on the top nav bar." Then, with it built and
scored: "nvm remove this ascii concept."

What it was, for the record: the same hour and the same rule set in characters. A hand-made
drawing of the room, 192 × 72 cells of the clip's frame (the window and its mullions, the far and
near city with lit windows, the castle on its stone base, the river, the trees, the desk, the open
laptop with a blinking cursor, the mug), with the sun, its rays, the glass stroke, its spectrum and
the mark drawn live per cell; two WebGL passes (the picture at the grid into a texture, then the
cells set in Geist Mono from a glyph atlas, the glass in cells half the size); the intro as a print
out from the sun; the scroll as the photograph's, with the vector mark rising through the typed
one for the hand-over; a Photo / ASCII switch in the header and the phone menu, the choice kept and
`?hero=ascii` setting it. It ran at 60 fps on desktop and phone with no clip to decode. A fresh
critic scored it 7.5 (Design, Usability, Creativity and Content all 7.5) and, before the glass was
set in finer type, could not find the object in the typed picture; after that it was the first
thing in the frame. The whole build, with a rest frame, is in
`docs/local/landing-backups/2026-10-28-typed-hero/` should it ever be wanted back.

What stayed: the hero's driver is now two files. `motion/light-frame.ts` holds the frame's
layout and the mark's box, the spectrum's aim at Home and the light its frame takes in, the
scroll's beats, the intro's look and the pointer; `motion/first-light.ts` draws the picture with
them. The same behaviour as before, checked again after the removal (the rest frame, the
hand-over, 60 fps, no console output). `Place` in `lib/first-light.ts` is a plain shape now, not
the literal type of the two placements.

## 13. The hero: Dusk (30 October 2026)

Mike, with a study built earlier the same day (a pinned split stage, words on black on the left,
a plate on the right with a shader sky and Moduo's Home leaning back in it, one camera moving
through the window as Anna's email became a task, a booking and a thread): "refine it and deliver
as stunning production ready version with fresh storyline, clean and highly optimized animations
and transitions; shock me completely." The study is the direction; this is the build. First light
(§11) is kept in the tree (`lib/first-light.ts`, `motion/first-light.ts`, `motion/light-frame.ts`,
`components/home/HeroWindow.astro`, `public/hero/*`) but no longer on the page; the files that
changed are backed up in `docs/local/landing-backups/2026-10-30-before-dusk/`.

### Concept card

```
Idea:        One email, from before dawn to sunrise. Behind Moduo's Home the sky runs from night
             to first light while one email becomes a contact, a task, a booking and a thread,
             each chapter told by the camera moving through the one window.
Metaphor:    an early morning at the desk: the window (Home) hangs in the sky like a pane of
             glass; the sun comes up behind it and lights its edge.
Anchor:      the five links the interlock (§1) already tells, now shown in the product itself,
             in the order they happen; and the line "What You touch stays in touch" (§5), which
             the story proves and the last chapter answers ("Still in touch.").
Signature:   the camera flight through the live Home, chapter by chapter, ending in a pull-out
             at sunrise with the window whole and its rim lit; then the mark in the window's own
             title bar grows out of it into the scene (the interlock's monument mode).
Emotion:     quiet, early, warm; a small "oh" at the key press, another at the pull-out.
Motion verb: glide (the camera, with weight) and arrive (rows, cards, events slide in).
Screenshot:  chapter 7: the whole window hanging in a dawn, the sun under it, "Still in touch."
```

Genericness test: a generic answer to "a hero with a product mock-up and a nice background" is
a centred window over a gradient blob with fade-ups. Changed from that: the picture is one
continuous shot the scroll drives (no cuts between seven frames), the story is in the product's
own UI and not in captions over it, the background is a time of day with a meaning (the work is
done before the day starts), and the hero hands its mark to the next section instead of ending.

### The story (data/site.ts `dusk`)

Seven chapters, each a line in Paper and a second thought in the reading grey (0.9 em of it), two
short lines each so they fit a phone (at most 16 characters a Paper line, 20 a grey one):

1. What You touch / stays in touch. · One email lands / before dawn. (the hero's line, §5; under
   it the two sentences of what Moduo is, which paint with the HTML)
2. Anna writes in. · Phase 2 is a go, / if Thursday works.
3. Moduo knows her. · Her whole history / is one card away.
4. Make it work. · Press T. Her email / is now a task.
5. Her time, / your day. · Three slots go out. / Anna takes 14:00.
6. Everyone's in. · It lands in chat. / No forward needed.
7. Still in touch. · One email, one key, / and the sun's up.

Each chapter's button in the row under the words (seven strokes, the current one in Paper and a
step larger, then "n / 7") scrolls to it. The one action, the waitlist button, stays under them
on every chapter. Every claim is shipped behavior (§0 assumptions): T on an email, the contact
roll-up, booking pages, a channel linked to the client. Alternative openings Mike has weighed
(round 6's "One window makes / light work.", 2026-10-29) drop in by editing the first chapter.

### How it is built

- **One section, one scroll.** The scene (`components/home/Scene.astro`) is `100svh + 660svh +
  440svh` tall (`lib/scene.ts`: `DUSK_SVH`, `SCENE_SVH`, `HERO_LEAD = 0.6`). The interlock holds
  the hero on screen for the first 60 % (its monument mode, unchanged), the hero's driver
  (`motion/dusk.ts`) reads the same ScrollTrigger and maps the lead to p 0 → 1, seven equal
  chapters (`lib/dusk.ts` `chapterAt`).
- **The camera is scroll-driven, with weight.** Keyframes (`KEYS`): rest; the top of the inbox;
  Anna's row and her card; Anna's row; the Tasks widget (half a chapter later, as the task
  lands); the calendar; the chat; the whole window. Each is a pose (scale, x, y, two rotations)
  computed from layout once per refresh (`framePose`, `restPose`, `allPose`, tested), blended
  between keyframes over the first 36 % of a chapter (`MOVE`) so most of each chapter holds a
  composed frame, then eased toward on the ticker (a lerp, about 0.4 s to settle) and leaned a
  hair toward the pointer. Nothing is measured per frame.
- **Beats are time-based,** keyed to keyframes, so they read at any scroll speed: Anna's email
  arrives and glows; a cursor finds her name and her card pops with its numbers counting; the T
  key appears over the row and presses; the task flies from the row into Today; three dashed
  slots appear and Anna's cursor takes 14:00; the booking lands in chat, Jamie types and answers.
  Scrolling back sets each keyframe's finished state at once; a fast scroll forward lands the
  skipped states and plays only the current beat.
- **The sky** is one WebGL pass at half the device's pixels (`lib/dusk.ts` `SKY_FRAG`): a
  zenith and a horizon colour from four stops each (night, blue hour, rose, gold) by `uDay`, the
  sun rising from under the horizon to just over it with a soft bloom that never clips (a
  roll-off before output), a drifting warped-fbm cloud band, hash stars that fade with the light,
  a vignette and grain. The day follows p with night lingering (`dayAt`); `--sun` (`sunAt`) lights
  the window's rim on the sun's side (a conic ring in the rim's `::after`) and a warm glow behind
  it, both opacities, never a shadow or a blur on scroll. Without WebGL the plate's CSS dawn
  stands. Under reduced motion nothing scrolls or moves: the chapter row is a set of tabs, and
  each swaps the words, the window's state as it stands at that chapter's end and one still of
  the sky at that hour, at once (the props, cursors and keys, stay out of the stills). Without JS
  the first chapter stands over the dawn with the window whole.
- **The words' column** is one stack centred on the plate: the chapter's lines, and a fixed step
  under the block (which keeps the first chapter's height) the chapter row and the one action, so
  the action never moves while chapters change. A stroke in the row answers the pointer by
  stepping along its own axis, and the count beside the row names the chapter under the pointer
  ("4 · Make it work"); the keyboard gets the same.
- **The window** (`components/home/DuskWindow.astro`) is the app's chrome (`frames/Frame.astro`)
  round a dashboard whose widgets answer state classes in CSS. Against the study: no backdrop
  blur on a window the camera moves in 3D and no blur filter on the widgets that step back
  (opacity and a hair of scale carry the depth), the window's tint shows the sky through it, the
  camera layer alone has `will-change`. The focus clock counts (`motion/widgets.ts`); the world
  clock shows the real time in Kraków and Osaka.
- **The hand-over.** At the final pose the window is flat and whole; the driver places
  `[data-light-mark]` on the artwork of the mark in the window's title bar (the svg is measured
  with the camera at rest, since an svg has no offsets), and the interlock grows the mark from
  that box while the hero fades (`heroOutAt` now ends the lead instead of starting at 85 % of
  it). The float and the pointer lean still to zero over the last chapter so the two marks sit on
  the same pixels.
- **Intro** (a first visit): the sky and the window come up out of the dark (the window stands
  up from a lean, 1.9 s), the lines rise under their baselines with the row after them. A revisit
  fades the window in (0.6 s) and the lines stand.
- **Idle:** the sky drifts, the stars twinkle, the window breathes (4 px, half a degree), the
  typing dots hop, the clocks tick. Paused off screen; nothing under reduced motion.
- **Phones:** the words over the plate (the headline at 8.8 cqi, the sub at 14 px, the row and
  the action right under them, so the sky shows on the first screen), the window 210 % of the
  plate's width (270 % under 560 px) so one widget fills the frame at a time, the camera's
  close-ups a step closer (2.6×), the whole-window pose within a 3 % margin. A phone cannot make
  the whole window's text readable; that frame is the picture of everything in one window, and
  the words beside it say so (a decision, after the first critic pass asked for a readable crop).
- **Weight:** the home page adds no media (the clip, the stills and the Osaka photo are no
  longer referenced); the Dusk markup, styles and driver are about 30 KB before compression.
- **The hour under the lines.** Chapters 2 to 7 carry a small reading in the grey (`when`, data/
  site.ts): "05:52 · Email" through "06:41 · Home", the sky's clock in words, in the slot the first
  chapter's sentences take; the window's world clock keeps the same morning (05:52 in Kraków,
  13:52 in Osaka, ticking), not the visitor's time, so the picture and the captions agree.

### The motion pass (30 October 2026, later)

Mike, of the build: "literally entire mockup and animations are full of visual bugs". The stills
the critics and I had read were taken at rest; frames taken every 60 to 120 ms while the wheel
scrolled showed what he saw. What was wrong, and what changed:
- **The headlines overlapped mid-change.** A chapter's lines left upward over 0.65 s while the
  next chapter's rose into the same slot over 1.4 s with a 0.4 s delay, each clipped only to its
  own line box: for about two seconds two chapters' lines sat on top of each other, cut
  mid-glyph. Now a line fades as it moves (opacity with the translate), the leave is quick
  (0.4 s, from 0 to -60 %) and the arrival waits for it (0.28 s delay, 70 ms a line, 0.9 s, from
  +70 %); the first chapter's sentences fade out in 0.3 s and the hour caption fades in after
  the lines. Checked forward and back, frame by frame.
- **The inbox showed through the contact card.** The card's gradient was 98 % opaque, and over
  the camera's composited layers Chromium drew the rows under it at a quarter strength (a solid
  fill covered them; a 98 % fill did not). The card and the flying task are opaque now.
- **A half-cut chip ghosted under the chat's header.** The thread fills from the bottom and the
  older messages run under the header; the top fade showed the "Phase 2 scope" chip at half
  strength in every late chapter. The two Monday messages are gone (one stays, dated Mon), and
  the thread's mask hides its first 1.9 em outright before a short fade, so a cut row never
  half-shows.
- **The horizon was a hard stripe.** The haze line and the land's edge are softer (a wider
  falloff, a lower peak) so the sun rises over haze rather than a bar.
- Verified after the pass: 60 fps on desktop and the throttled phone, LCP 2.06 s on the phone,
  CLS 0, no console errors, no overflow, no axe violations, no hidden hero text under reduced
  motion; typecheck and the 46 tests pass.

### The board, rebuilt (30 October 2026, later still)

Mike, with five crops: "there are like no paddings, no spacing [...] why is it all so low quality?
remove this timezone clock and focus; make every single widget as pixel perfect scalable element
as separate component and puzzle it together into home board and animate it." The window had
been one file of ad-hoc CSS ported from the study, with rows cut by their panels, chips wrapping,
text under the sun's glow, a world clock and a focus ring that told nothing. Rebuilt:

- **Five widgets, five files** (`components/home/dusk/InboxWidget`, `NoteWidget`, `TasksWidget`,
  `ChatWidget`, `CalendarWidget`), each a `Widget.astro` shell (the panel, its header row with an
  icon box, a title and a right slot) round its own content and its own answers to the story's
  state classes; the props in `dusk/Props.astro`; the board in `DuskWindow.astro` is four columns
  (inbox, note, Today over the channel, calendar), its measure one set of variables on `.dk`
  (`--pad` 1.1em, `--row` 2.5em, `--head` 1.9em, `--head-gap` 0.9em, `--r` 1.1em, `--inset`
  0.7em), everything in em so the board scales as one piece under the camera.
- **The world clock and the focus widget are gone**; the focus clock stays in the bar.
- **Trap, recorded:** an `em` inside a custom property is resolved where the property is read.
  `--hour: 2.8em` on the rail came out 0.8× inside an event set at `font-size: 0.8em`, so every
  event sat at the wrong hour and the now-line struck through one; `--row` read inside a 0.93em
  row left a sixth row peeking under the Today list. Rows and events keep the board's em and size
  their text inside.
- **Heights that never change:** the Today list is five rows tall; when Anna's task is born at
  the top the done one slips under the fold, so the widget, the board and the camera's measured
  keyframes hold. Anna's chip row takes no room until a chip is in it. The chat fills from the
  bottom and its past runs under the header (a short fade at the edge); the calendar is ten hours
  of 3 em with a label gutter, the kickoff a two-line event, the slots' line under the rail.
- Checked at 2× in every chapter and in motion (frames every 60 to 120 ms, forward and back);
  the critic pass that follows is on this board.

### The polish pass (30 October 2026, evening)

Mike: "go across hero section mockup and animations and fix all of the paddings, spacings, widget
content positioning, generally the entire UI/UX of it." Read at 2x in every chapter, in motion
and on a phone. What was wrong, and what changed:

- **The board had no inner spacing at all.** The board's reset (`.dk p, .dk ul { margin: 0 }`)
  out-ranked every widget's own margins (0,1,1 against 0,1,0): the gap under each widget's
  header, the note's paragraph and heading steps, the composer's step, the slots' line and the
  card's subtitle were all zero. The reset is `:where(.dk) :where(p, ul)` now, so the widgets'
  measure finally applies. Trap: a reset inside a component must carry no specificity.
- **The leaning window and every close-up were soft.** Two causes, both in Chrome's raster:
  a layer with any 3D in its transform is rastered at its layout size and then scaled (the rest
  pose scales it about 1.5x, so its text went blurry), and the pointer lean and the breath left a
  hair of rotation on the flat close-ups, which kept them 3D too. Now the window is laid out
  `--k` times larger than it is ever seen leaning (1.6 on a wide plate, 1.25 on a phone; the
  camera's scales and the rim's sizes divide by it), the camera renders a flat pose as a 2D
  transform (rotations below 0.01 degrees snap to 0), the pointer moves a flat window in 2D
  (a few px of drift) and tilts only a leaning one, and the breath is the camera's own (4 px on
  the lean, a third of that on a close-up, its tilt only on the lean). The float wrapper is the
  intro's alone.
- **Beats played off camera.** The camera followed the scroll only: a visitor who stopped just
  past a keyframe left it at the old frame while the task flew to Today, or the slots appeared,
  outside the plate. Crossing a keyframe forward now also completes the move in 1.5 s
  (`KEY_GLIDE`), whichever is further along, the scroll or the clock; going back stays scroll
  driven.
- **Keyframes were measured in the wrong layout.** The story changes the board (Anna's row
  arrives, her chips open, today's messages land), and the poses were measured in whatever state
  the page loaded in. They are measured as the story ends now (every state class on, no
  transitions, put back in the same frame), and so is the contact card's place.
- **The scene's mark landed a bar's height under the window's.** On a first visit the measure
  ran while the intro held the float 70 px low and tipped back; the float is neutralised for the
  measure too.
- **Widgets:** Anna's waiting row left its padding as a gap under the inbox header (it collapses
  fully now, padding included); the note's list has its bullets; the calendar shows next
  Thursday, so its now-line (which also struck through the 10 label) is gone, it runs 08 to 19
  so the channel under Today gets the room it needs, its events are solid (an hour line ran
  through "Logo review" like a strike), the kickoff's title is white and its avatars overlap
  less; the chat's older messages step out once today's thread starts, so nothing half-cut sits
  under its header, and a message still to come takes no room, gap included; "Send Maya brand
  notes" fits beside its source chip.
- **Card and frames:** the contact card opens under Anna's row (it covered her subject line),
  and its frame takes the inbox header too; chapter 4's first frame is the inbox header with her
  row; chapter 5 frames the whole day with its date on a wide plate (the afternoon on a phone,
  where a whole day would be too small to read).
- **Motion details:** props still up when the scroll moves on fade out in 0.35 s instead of
  vanishing in one frame.
- **The words:** each chapter sits on the block's foot, a fixed step over the chapter row, so the
  shorter chapters no longer leave a hole between their lines and the row.
- **After a blind critic (7.05; Design 7, Usability 7, Creativity 7, Content 7.5), from its list:**
  the window fades into the plate's edges (a 3.5 % mask on the camera's space, inside the
  whole-window margin), so a word cut by the edge reads as texture; the widgets that step back
  go to 0.28; while Anna's card is open the inbox rows under it step back too, and the card
  starts at the row's own edge with its arrow on her name; Today's fifth hairline is the panel's
  edge; the note reads "Anna Carter: open with the Osaka shoot"; the cursor rests under her
  name, not on it; on a phone the words keep the top of the screen (on their foot they left a
  black band over them) and the afternoon close-up spans the calendar's full width so its hour
  labels stay in frame. Not taken: "a different typeface in the last caption" (measured: the
  same 14 px Modus as the others), the capital in "What You touch" (§5), the sky beside the
  window in the calendar and chat frames and the lit rim at its foot (the window hangs in the
  sky), the whole window on a phone's last chapter (decided earlier), the nine hidden text
  nodes and the "Monday" tab's colour-only hover (both in the Tasks mini, outside the hero).
- Checked after the pass (production build): 60 fps on desktop and the throttled phone, LCP
  2.1 s on the phone, CLS 0, no console errors, no axe violations, no hero text hidden under
  reduced motion; typecheck and the tests pass. The files before the pass are in
  `docs/local/landing-backups/2026-10-30-before-hero-polish/`.

### The plate's background: Waves (30 October 2026, night)

Mike, with a recipe from the 21st.dev Shader Builder: "as the background layer under the mockup
let's add something like that". The plate's sky shader is replaced by "Waves" (`lib/waves.ts`):
the builder's fragment shader verbatim, its packed uniforms as listed (colours #1A1423, #B75D69,
#EACDC2, #FFF5EB in OKLab; speed 30, zoom 41, intensity 49, warp 1, contrast 53, brightness 57,
saturation 100, hue 130°, vignette 0, grain 100, cursor off). The 130° hue turn makes the plum
and rose recipe read light lavender at the top, cobalt through the middle and deep green at the
foot. A fullscreen triangle in plain WebGL1, at the device's pixels capped at 2, drawn on the
hero's GSAP ticker (one clock: it stops with a hidden tab and when the plate is off screen,
instead of a loop of its own); the camera's pan nudges the field's offset for a hair of
parallax. Cost: the field is five octaves of noise and three OKLab mixes a pixel, so it draws
every second tick (30 fps, every third on a phone) and a phone draws at half its capped pixels.
Measured on the throttled phone (software GL): 8 fps at full count, 45 at this setting, 60 at a
third of the pixels, where the grain turned to visible blocks; desktop holds 60. Under reduced motion it draws once. The CSS stand-in under it and the window's rim
and glow are retinted cool to match; the rim still brightens with the morning (`--sun`). The
night-to-sunrise sky (`SKY_FRAG` in `lib/dusk.ts`) stays in the tree, unused: the captions'
hours and "and the sun's up" no longer have a sky to agree with, which is Mike's call to make.

Then Mike, of the window over the light waves: "why does the mockup have this weird outline and
why are the edges of the box blurring?" Both came from the dark sky's styling. The glass rim (a
light 1px border, a gradient band of padding and the lit ring) read as a second outline round
the window, so the rim is now only the window's own edge and its shadow. The edge fade on the
camera's space (from the critic pass) read as a blur where the dark window met the light
waves, so the plate cuts the window cleanly again.

### Critic passes

Blind critics (no code, no notes, the screenshots and the measured report only) scored the home
page 7.65 after the first build and 7.7 after the second pass (Design 8, Usability 7, Creativity
8, Content 8; Semantics 8, Animations 7, Accessibility 7, WPO 8, Responsive 7, Markup 8), each
reading the idea as meant: "the sky is the clock for one email; arrival at night, one keystroke,
everything linked by sunrise". Measured on both passes: 60 fps scroll on desktop and the throttled
phone, LCP 2.0 to 2.1 s on the phone, CLS 0, no console errors, no overflow, no axe violations,
the skip link first and every focus stop visible, no primary target without a hover answer, JS 94
KB gzipped, the page about 292 KB. Taken from the fix lists: the words as one centred stack with
the row and the action a fixed step under them; the phone's words smaller so the sky shows on the
first screen; the whole-window pose within a 4 % margin, centred above the middle, with a horizon
line and the sun rising on it; a deeper night; the chapter marks answering the pointer with a step
and the chapter's name; reduced motion as tabs (no hidden hero text); the hour captions. Left as
decided: the capital in "What You touch" (§5, Mike's), the campaign line as the page title (brand
61), the whole window on a phone's last chapter (its text cannot be readable at 390 px; the words
beside it carry the point). Outside the hero, noted for later: the Tasks mini's "38m" pill over
its timer at 390 px, a drawn cursor in a phone mock, the board's day tabs answering with colour
only, nine hidden text nodes under reduced motion in the Tasks mini and the widget buttons.

## 14. The site pass (2 November 2026)

A pass over every page (the crawl's nine, plus a static sweep of the other fourteen at 1440 and
390 px), fixed from the screenshots, a blind critic (7.4: Design 7.5, Usability 7, Creativity
7.5, Content 8) and a visual sweep:

- **Pricing.** The plans share their rows (subgrid), and the shorter feature lists spread their
  items over the longest one's height; they keep their own step at the top now
  (`align-content: start`).
- **The hero without motion.** The still stands the whole window in the middle of the plate
  (it hung at the top over an empty band of waves).
- **Hovers.** A layout tab on the home board fills a step toward the pressed one (it only changed
  colour); the current chapter mark steps and grows under the pointer like the others.
- **Reduced motion.** The Tasks mini's other half of its moment (the task before, the one leaving
  Up next, the flying minutes) is not laid out at all. Left: the board widgets' Open and Remove
  buttons, icon links that show on a widget's hover or focus, as in the app (always shown on
  touch).
- **The family chain on a phone** (ChainNav ≤ 560 px): every name stands in one row under the
  chain, the current one lit, each a link for the pointer (the strokes stay the accessible
  links; the row is a hidden copy out of the tab order). Only the current name showed before,
  so the other strokes were unnamed.
- **Changelog.** The newest release stands a section's step under the lede (it sat hard under
  it).
- **Integrations.** The last column ("Chat · Fills as you talk") may run into the page margin; it
  wrapped a word a line at the plate's edge.
- **Colophon.** The subject in the first window ("Final deck notes") is set smaller and on the
  windows' middles, clear of their diagonal sides.
- **Legal pages** (lib/legal.ts, the source in apps/landing untouched): "sp. z o.o." and postal
  codes never break across lines; a paragraph inside a table cell runs to the cell's edge.
- **Lists.** Security's and Import's markers are the site's dot (a short rule read as a dash
  before every line). About's ticks stay: they join each line to its spine.
- **MCP.** The table of tools that need two modules takes the column's width like the others.
- **Compare.** The count ends on the box's right edge (left on a phone); the phone's rotated
  app names have room under the box's rounded corner.
- **Import.** The four sources stay on one row, ending on the right edge.
- **Press.** The founders' photos sit on a raised square while they load.

Checked and left: the 404 entry in `failed` is the page's real 404 status; the em dash on /modus
is a glyph in the character set and the en dash on /dpa is in "EU–US Data Privacy Framework", a
proper name; the repeated headings the audit lists are each page's contents and its clauses;
Login's ASCII instrument and its missing lockup (§10, Mike's); "What You touch" (§5); the
reading pages' grey ground (brand decision 37); the 36 px row of Modus's waterfall fading at its
column; the rail's current row stepping in (§5); the cookie bar (dismissed once, and it never
covers the header or a primary action). The phone's 45 fps on the hero is the Waves shader on the
headless software GPU (a third of the resolution reached 60 there, but its grain went blocky).

Second pass, from a fresh critic (7.1: Design 7, Usability 7, Creativity 7, Content 8; a stricter
reader than the first, on mostly the same evidence):

- **FAQ rows.** Under the pointer the whole row stepped in, its stroke pair too, past the rule on
  the right (`.faq__q > span` matched the pair's own span). The question alone steps in now, and
  the pair closes into its window, as it does when the answer opens.
- **The chain's names** got a 24 px hit area round each (a short name like "AI" or "01" was 12 to
  16 px), without moving them.
- **The manifesto's rail** went dark when the names became links: the scroll spy counted them as
  its own links. It reads the strokes only (`.cnav__labels a` excluded).

Left as decided: the cookie bar (both critics ranked it first; it is the consent prompt, it
goes once answered and Accept or Decline are the only ways it should), the overlap scene's frame
between beats, the hero's whole window on a phone's last chapter, Help's compact hero (§9).

**The opening line (3 November 2026, Mike's call).** Dusk's first chapter is now "Your space / to
think, dream / and build." alone, a size up from the story's lines (`min(14.5cqi, 8rem)` on the
desktop, its widest line filling the words column; `min(13.5cqi, 3.75rem)` on a phone), with the
two sentences of what Moduo is under it. Its grey second thought ("One email lands before dawn.")
went with it: the story starts with the scroll, at "Anna writes in." The hero's own "Join the
waitlist" button went too; the header's is the action on the first screen, and the scene's last
beat keeps its own. "What You touch stays in touch." stays the campaign line (page title, OG image).

**The words, rebuilt (3 November 2026).** Dusk's left side moved off CSS class transitions onto
the one clock (`src/motion/dusk-words.ts`, called from `motion/dusk.ts`). Every word is its own
span. A chapter's words rise out of their line's clip one after another, the grey thought a beat
behind the Paper line; on desktop they sharpen out of a slight blur as they come. The words
leave the way the story moves (up going forward, down going back), lifting and fading fast on the
brand's curve, so the next lines rise into clear space. A change mid-flight takes every word
from where it stands, so a fast scroll never stacks two chapters (checked: no stray word after a
fast scroll forward, back and a jitter). The opening is delivered at reading pace: its words rise
as one dim shape, then a light passes over them in reading order, longer words taking longer and
the comma and full stop each a breath. Its two sentences still paint with the HTML, since they
are the LCP (mobile 2.1 s; desktop 0.14 s); coming back to the opening, they follow the line, and
the light passes quicker. Under each chapter the hour rolls only its changed figures, like a clock
(05:52 → 05:53), and the module's name swaps in its own slot. The chapter row arrives after the
line, 1.2 s in. Reduced motion is unchanged: the tabs swap at once.

**The hero steps (3 November 2026, Mike's ask).** Inside the hero one gesture is one chapter
(`src/motion/dusk-steps.ts`; rests from `lib/dusk.ts` `chapterRest`, tested). A wheel push, a
swipe or ↓ ↑ PageDown PageUp Space glides 1.1 s on the brand's curve to the next chapter's rest:
just after that chapter's camera has landed (chapter 4, with its second glide to Tasks, rests
after both). The rest of the gesture is spent on it: a trackpad's inertia, a mouse wheel spun
hard, a long swipe all take one chapter (checked with timed wheel bursts, decaying inertia and
CDP swipes). A fresh gesture early in a glide is kept and taken 0.55 s in, so deliberate
scrolling runs at a steady pace. Down from the last chapter, and up from the first, the page
scrolls as ever. Coming back up into the hero catches on the last chapter, and up from any
chapter's hold goes to the one before. Scrollbar drags, links and Home/End move freely; the next
gesture steps from wherever they left the page. The chapter buttons glide to the same rests. The
engine gained a scroll gate (`setScrollGate`, Lenis's `virtualScroll`; never asked while the menu
stops the scroll, for a pinch, or in a `data-lenis-prevent` element) and `glideTo`. While a modal
dialog is open the page now stays put. Reduced motion is unchanged: native scroll, chapters as tabs.

**Calmer, harder (3 November 2026).** The hero's motion was softened and its paint costs taken
out from under the camera:
- **Glides:** stages glide 1.3 s on a new soft in-out, `ease.glide` (`M0,0 C0.45,0 0.15,1 1,1`),
  because the brand curve's leap moved the whole screen at once. The words change as the step
  starts and the camera follows. A jump across several chapters shows only the one it lands on
  (checked: chapter 2 to 7 showed 2 and 7, nothing between).
- **Words:** they arrive over 1.25 s and leave over 0.75 s, fading over 0.38 s with a 0.3 s gap
  before the next ones rise. Blur is 6 px. The camera's follow is a little softer (0.91 a frame).
- **Board:** widget focus is now an opacity on an edge layer (`.dk-w::after`); the box-shadow and
  scale transitions are gone, because they re-rastered the whole window on every frame of a
  glide and the scale shimmered its text. Dim is now 0.32.
- **Anna's email:** it no longer animates the list's layout. Her row's place is always kept, and
  the list sits higher by her row's height (`--anna-h`, measured in `measure()`) until she lands,
  then glides down; transforms and opacity only, both ways.
- **Beats:** the board's pops lost their bounce (`--spring` is a slight settle; the contact
  card, the key and the keyset use `ease.out`), and props fade out going back as well as forward.
- **Mail inbox:**
  - The widget is titled "Mail inbox".
  - The list reaches past the content by the rows' inset, so the lit row's fill has room round
    its avatar and time.
  - The fill is a rounded layer a hair inside her row's height, so it stays clear of the
    hairlines. The hairlines run at the content's width, and the one under her row hides while
    she is lit.
- **The window's edge:** the edge is an inset ring inside the window's own clip, since the outer
  ring sat on a different curve. The shadow is one wide, soft drop: the tight pair peeked out
  under the rounded corners as a grey crescent over the light waves.

**Safari (3 November 2026).** Mike saw the hero flicker in Safari only. Headless WebKit didn't
show it, so these fix the likely causes, scoped to WebKit (`isWebKit()` in the engine, which
sets `.dusk.is-webkit`):
- **The camera stays 3D:** it keeps a 0.01° turn and `force3D`, because the driver dropped it to
  2D on flat poses, every chapter and on frames where the breath crossed flat in a glide, and
  WebKit rebuilt the window's layer each time.
- **No blur on the words:** an animated blur on text redraws it every frame in WebKit.
- **The plate gets its own layer** (`translateZ(0)`), so its rounded clip is composited rather
  than redrawn round the moving window.
- **The camera hides its back face.**

Chrome is unchanged: its close-ups need the flat 2D path to stay sharp. Text checked sharp in
WebKit at a close-up.

## 15. Moduo in Moduo (3 November 2026)

Mike's direction: every demo picture on the site shows Moduo's own workspace, the two people who make Moduo building it in Moduo, the week of the open alpha. The invented cast (Anna Carter, Maya Brooks, Jamie Ross, Tom Becker, Priya Nair, Lena Kraus, Northwind Studio, Carter & Co, the Osaka shoot) is gone everywhere: the hero, the home sections, the bento cards, the product frames, the use-case pages and the other subpages. The bible the rewrite followed:

### The workspace
- Workspace name: **Moduo** (switcher tile letter "M"). It replaces "Northwind" everywhere.
- Channels: `#open-alpha`, `#design`, `#releases` (lowercase, as the app writes them).
- Projects / tags (keep the existing color variables; just rename): **Open alpha** (violet),
  **Closed alpha**, **Website**, **Mail**, **Design**, **Release**, **Tasks v2**.

### The people (the only named humans)
- **Mike Grochowski**: co-founder, CTO; back end and the core (sync, Mail, the desktop app,
  releases). Initials **MI**.
- **Maciej Grzywacz**: co-founder; product, design and front end (the mark, the UI, Modus
  drawings, onboarding). Initials **MA**.
- In a window the viewer's seat is Mike's unless the copy says "you" to the reader; where a page
  addresses the reader ("you"), keep "You" (initials YO) as the reader, working with Maciej and
  Mike. Never write private facts about either person; only their roles and Moduo work.
- Never show an email address for Maciej. Mike's is mike@moduo.app if one is needed; otherwise
  show "moduo.app".

### Non-person senders (Moduo's own systems; no real third-party brands)
- **Moduo waitlist** (sign-up notices: "9 new sign-ups today"),
- **Moduo releases** (real versions and notes, below),
- **Alpha feedback** (the in-app feedback form: neutral bug reports and requests, never praise,
  never a testimonial, never a named tester),
- **moduo.app** domain renewal, invoices from "Hosting" (generic). Never GitHub, Stripe,
  Cloudflare, Apple, Google or any other real company in demo content.

### True facts you may use
- Closed alpha opened **2 November 2026**; open alpha opens **16 November 2026**.
- Modules in alpha: Home, Email, Tasks, Notes, Calendar (with booking pages), Contacts, Chat.
  Calls (Meet) come with the beta.
- Real releases: **1.4.0** (26 Oct: search in Notes finds what you wrote, with the line it was
  found in; clearer comments in notes; notes open faster), **1.3.2** (23 Oct: calmer Notes, code
  blocks, tables), **1.3.1** (23 Oct: teammates' and agents' notes show up live; calmer layout;
  Markdown paste).
- The site and the app use Moduo's own typeface, **Modus**.
- AI is bring-your-own over MCP; Moduo never trains on your data.
- It is made by two people.

### Invented but honest
Task names, note text, meeting names, chat lines and small counts are demo content about the work
of shipping Moduo, plausible for these two people this week: the open alpha invite email, picking
the first wave from the waitlist, Mail sync, the Windows build, release notes for 1.4.1, the
Tasks v2 (Weight) view, onboarding copy, the changelog, a design review, Modus kerning, the mark.
Keep counts small and unremarkable; never present a number as a metric or a claim (no "1,200
users", no growth figures, no quotes praising Moduo).

### Writing rules (the site's)
- Sentence case, US spelling ("color", "centered"), no em or en dashes in visible text, no filler
  verbs. Straight apostrophes in code are typeset as ’ where the file already does that.
- Keep every line about the same length as the one it replaces (layouts are measured to it:
  ellipses, fixed rows, phone widths). Keep markup, classes, data- attributes and comments'
  structure; change words, names, initials and the comments that name the old cast.
- Mentions render like "{@Maciej Grzywacz}" where the file already uses that syntax.
- Dates: this week is 2 to 8 November 2026 (Mon 2 Nov ... Sun 8 Nov); "today" is Thursday
  5 November where a calendar needs a day (the hero calendar reads "Thu, Nov 5").

### The hero (Dusk) story, for reference (Mike's seat)
1. Your space / to think, dream / and build.
2. Maciej writes. · The alpha invite / needs your eyes. (05:52 · Email)
3. Moduo knows him. · Every thread with / him, one card away. (05:53 · Contacts)
4. Make it work. · Press T. His email / is now a task. (05:54 · Tasks)
5. His time, / your day. · Three slots go out. / Maciej takes 14:00. (06:12 · Calendar)
6. Everyone's in. · It lands in chat. / No forward needed. (06:20 · Chat)
7. Still in touch. · One email, one key, / and the sun's up. (06:41 · Home)
The email: from Maciej Grzywacz, subject "Open alpha invite", snippet "Final copy for the
invite email is in the note. Can you check the links today?" It becomes the task "Review the
alpha invite" (the shorter title fits Today's row). The meeting: "Invite review" Thu 14:00, Maciej and Mike. Channel #open-alpha.

### Held across every picture (checked by a blind read of 56 screenshots, then fixed)
- **Avatars:** Maciej is MA in violet, Mike is MI in pink, everywhere. The app's initials for the
  two of us are the first two letters of the first name, since both full names give MG
  (`usecase/Picture.astro`).
- **Whose seat:** the product frames, the board and the bento are Mike's own view: the top bar
  reads MI, he is "You" in his threads, his self-DM reads "Mike Grochowski (you)", and his
  accounts are mike@moduo.app and hello@moduo.app. Only the use-case pages seat the reader as
  "You" (YO).
- **The one plan:** the invite goes to the first wave on 16 November and the rest a week later.
  The review is Thu 5 Nov at 14:00 with the "Invite copy" note, in `#open-alpha` (2 people).
- **Titles kept short enough for their rows:** "Review the alpha invite", "1.4.1 notes",
  "Windows build", "Notion export".

## 16. Oudom: the typeface renamed (3 November 2026)

Mike's idea: read the product's name backwards. **Moduo → oudom.** The face was Modus (§8). That
name collides with a 2001 GarageFonts sans, and the word is common. No typeface called Oudom
turned up: the nearest are Thom Niessink's Oduda and Odudo, different names. It's an extended
web search, not a trademark search; the trademark search still comes before any licensing.

### Why the name holds (researched past Mike's brief)
- **It keeps the brand's rule.** Moduo is mod and duo, sharing one d. Backwards, oudom is oud and
  dom, sharing the same d. The d is the one letter that stays where it was, third of five.
- **The forme, corrected.** A mirror does not give "oudom": mirrored, the d is a b ("oubom").
  What gives oudom is metal type:
  - Type is cast in mirror image, so a forme reads backwards.
  - A compositor reads each line from the far end, piece by piece, and each piece is still its
    own letter: o, u, d, o, m.
  - The page shows both states, the mirrored line first and the read one after. It does not
    claim that a window or a mirror makes the word.
  - The b/d (and p/q) mix-up of mirrored sorts is well attested. That it gave "mind your p's
    and q's" is one theory among several, so the page doesn't say it.
- **dom:**
  - Polish for house and home: Proto-Slavic *domъ, from PIE *dṓm.
  - English timber goes back through Proto-Germanic *timrą to PIE *dem- ("to build").
  - Latin domus is a cognate of both.
  - Sources disagree on whether *dem- meant "build" or "house", so the page says only: "It
    shares an old root with Latin domus and English timber, a root that meant to build."
- **oud:** Arabic al-ʿūd gave the lute its name (Occitan laüt, Spanish laúd, French luth,
  English lute). It is usually read as "the wood"; that is debated (Persian rōd/rūd and Syriac
  readings exist), so the page says "usually read as the wood".
- **Wood and house.** oud (wood) + dom (house, from a root for building): a joiner's word. The
  first brief for this face asked for "joiner", and the family's first files were Moduo Joiner.
- **A real name.** Oudom is a Lao and Khmer man's name, from Sanskrit uttama, "the highest"; Thai
  has Udom. The page says so plainly, in a note, rather than leave it to a search.
- **Saying it:** "oo-dom", as the Lao name is said. It goes in the hero's spec line and in the
  spec table.
- **Sources:**
  - Wiktionary: timber, Proto-Germanic *timrą, Proto-Slavic *domъ.
  - The Texas Indo-European Lexicon, *dem- ("to build, timber; house").
  - Etymonline and Wikipedia: lute, oud.
  - Behind the Name: Oudom.

### What changed
- **The route:** `/typeface`. `/modus` redirects there, and the sitemap drops it.
- **The font:**
  - The file is `public/fonts/oudom-300_700.woff2`. Its name table was renamed with fontTools
    (scratch venv): "Moduo Oudom", PostScript ModuoOudom-Light. The outlines are unchanged.
  - The CSS family is `Oudom`, with `Oudom Fallback` behind it.
- **The sources:** the UFO sources in `docs/local/Moduo Joiner/nib` still say Modus, and
  `scripts/typeface-data.mjs` maps the name. The next font build needs the family renamed in the
  generator, or it ships "Moduo Modus" again.
- **The code:**
  - `components/typeface/*`, `motion/typeface*.ts`, `lib/typeface*.ts` and `data/typeface/*`
    (was modus).
  - The data export is `typeface`, and the frames' prop is `specimen`.
- **The hero:** the word is Oudom. It is three stems, three arches and three bowls, nine strokes,
  so the scene now has three depth layers.
- **The signature, `components/typeface/Name.astro` + `motion/typeface-name.ts`:** one pinned,
  scrubbed timeline over 640svh, in seven beats:
  1. moduo, set as a line.
  2. Each letter takes its piece of metal, a sort with its nick, and the line turns over: the
     forme, oubom.
  3. Each piece turns back, from the far end: oudom.
  4. Two mark strokes draw in under it, oud and dom. They overlap on the d, and the mark's window
     opens there as a hairline parallelogram.
  5. ou steps back, and dom is glossed.
  6. om steps back, and oud is glossed.
  7. "Set in Oudom": three readings, and the note on the name.

  Without motion it is one still drawing: the read line, the rule, both glosses and the story in
  order.
- **Copy:**
  - The weights sample is "Joinery".
  - The spec gains "Say it" and "Earlier names (Joiner, then Solidus, then Modus. Oudom since
    3 November 2026)".
  - The colophon's "What's left is a measure" step is now "What's left is an outline" and names
    no face. Its ghost word is gone.
  - The name step ends on the reversal, and the readings call Oudom "our name read from the far
    end".
  - The footer, colophon credit line, OG images, JSON-LD, pages index and press "Related" link
    are updated.

## 17. The colophon, rebuilt as back matter (3 November 2026)

Three readings were weighed:
1. **The press**, from the profession's material: printing. Picked: it is the one territory the
   credit line already lives in ("Set in", a colophon, Oudom's forme story). Moduo's own colour
   names are printerly: the ground is Canvas and the ink is Paper.
2. **The device**, the printer's mark: Aldus signed with a dolphin and an anchor, and we sign
   with the Moduo mark. It became chapter two, not the whole page.
3. **The far end**, reading the site backwards. Dropped: it means scrolling against the visitor.

```
Idea:        the credit line, printed the way a printer printed a colophon, then the colophon itself.
Metaphor:    a hand press and a book's back matter (the device, an index, the colophon).
Signature:   the forme (the line set backwards in metal: sorts with their nicks, quads for the
             spaces, the device as a cut) is inked by a roller, a sheet comes down, the press
             leans on it, the sheet lifts and turns over: the line reads right, the device under it.
             One driver per section (motion/colophon-press.ts; the device story is motion/colophon.ts).
Emotion:     the small thrill of a proof coming off the press.
Motion verb: press and turn (the scroll inks, lowers, presses, lifts).
Screenshot:  the mirrored forme half inked, the roller across it.
```

The page, in order:
1. **Press** (`components/colophon/Press.astro`): the h1 is the line itself, readable from the
   first frame beside the forme, so it is the LCP. Then four beats: Set, Inked, Pressed, Read.
   "Read" carries what a colophon is: Greek for the finishing touch, how the book was made and
   by whom.
2. **The device**: the old stroke story, unchanged in substance (one stroke, cancel, outline, the
   mark appears, set as a set, the name keeps the rule both ways, so does the product). It now
   opens as a chapter: "Our device is one stroke." (an h2; the page has one h1).
3. **Read it once more**: unchanged.
4. **The index**, "Where the stroke lives": unchanged.
5. **The colophon itself** (`components/colophon/Edition.astro`): centred, set as books set
   theirs. The parts:
   - Type, Pictures, Ink (Paper, #fafafa), Paper (Canvas, #000000), Measure, Shape, Rule,
     Press (Astro, Cloudflare), Motion (GSAP and Lenis, one clock), Hands.
   - The edition, "Printed" with the build's own date, the week of the open alpha.
   - The device last, the mark, linking to the type page.
   - Then the sign-off and the way out.

Decisions:
- **Idle:** the light drifts across the metal at rest (`--glint`, on the ticker) while the forme
  is on screen and not yet covered. Nothing else moves until the scroll does.
- **Under motion the sheet lies over the forme.** Its blank side is thin enough that the inked
  type shows through, and the caption under the plate swaps from "The forme" to "The sheet".
- **Without motion** the forme and the printed sheet stand one over the other, the beats in
  order.
- **The stage clips its own overflow:** the sheet's first tilt reached past the viewport.
- **Printing facts kept to what holds:**
  - Type is cast in mirror image, and spaces are quads set lower, so they don't print.
  - The nick orients the piece.
  - A Linotype casts a whole line as a slug.

## 18. The colophon, again: read closer (3 November 2026)

Mike's notes on §17:
- The press opening read as AI slop.
- The canvas story's set step was chaotic: mod and duo slid over the mark.
- The name step's words ran off the screen.
- The product step needed more invention.

So the press and its driver are gone (`Press.astro` and `colophon-press.ts` deleted), and so is
the canvas story (`motion/colophon.ts` rewritten).

```
Idea:        the credit line, set small as a book sets its colophon, then read closer until one
             stroke of one letter fills the screen: what every shape here is made of.
Metaphor:    a reader's loupe over the last page of a book.
Signature:   the zoom. The line, drawn from Oudom's outlines (an SVG whose viewBox the scroll
             scrubs on a log scale, so it stays sharp), closes in on the d of Oudom. The joins
             between strokes show on the way, and a 45° guide lands on the stem's cut at the end.
Emotion:     a whisper that turns into a monument.
Motion verb: close in, then one calm move per figure.
Screenshot:  the d's stem filling the screen, the 45° hairline along its cut.
```

The page, in order:
1. **Closer** (`components/colophon/Closer.astro`):
   - The h1 is the line, small and centred, with the device under it.
   - The drawing is laid exactly over the h1's first sentence (measured, px per font unit) and
     takes over as the scroll starts.
   - Two readings appear on a black ground of their own, so they read over the white letters.
2. **The device** (`components/colophon/Device.astro`): words on the left, one composed figure at
   a time on the right. The step nearest the reading line (55% of the screen, or 72% on a phone,
   where the figure holds the top half) puts its figure on, and CSS plays that figure's one move
   and holds it. The strokes are Paper with `mix-blend-mode: difference`, so two in one place
   cancel live as they move. The figures:
   - **The mark:** it parts from one stroke.
   - **One stroke:** its construction draws in.
   - **Cancel:** the second stroke slides over, a window opens and holds, then both cancel to
     their edge.
   - **Outline:** the template, with a stem, an arch and a bowl of Oudom (from the font) coming
     out of it.
   - **The mark appears:** three strokes in one place, pulled apart.
   - **The set:** names land, then each window is read. On a phone the two readings take a line
     each.
   - **The name, both ways:** moduo over oudom, each with its two halves as strokes overlapping
     on the d. The copy was cut to two short sentences, so it fits.
   - **The product:**
     - Two apps (Email and Tasks) apart, each with its own copy of Maciej's email; the copy is
       9:40, "Copy of: Open alpha invite".
     - The modules meet, the copy goes, and the one email sits in their window with both
       modules' tags.
     - The count turns from "2 apps, 2 copies" to "1 email, 0 copies".
3. **Read it once more**, **the index** and **the colophon** (`Edition.astro`) stay as they
   were.

Decisions:
- **No idle at the top:** the opening is still at rest on purpose (a book's last page). The zoom
  is the life, and the device's figures move when they come on.
- **Without motion:** the line stands at its size, the two readings under it, and every figure
  in its final state, two to a row.

**After the blind critic (7.15):**
- **Phone story:** on a phone each figure now stands inline above its words and plays as its step
  reaches 62% of the screen. The held figure had overprinted the scrolling text.
  - The figures are drawn once (`components/colophon/Figs.astro`) and placed twice: held in the
    stage on a wide screen with motion, inline otherwise.
  - Still, on a wide screen, each step is a spread: words left, figure right.
- **Set figure:** its caption is gone (the formula is in the words), so the readings no longer
  collide.
- **The email:** it hangs under the strokes on a line from the window, so the window stays in
  sight.
- **The opening line:** set at display size (`clamp(3rem, 1rem + 7vw, 8rem)`), so the zoom starts
  from a poster.
- **The guide:** shortened, so it stops before the caption.
- **The captions:** they fade quickly, so their black ground never shows the letters through.

## 19. The colophon as one scene (3 November 2026)

Mike loved the read-closer opening and asked that the whole story continue from it as one
animation. The order he gave: the d of Oudom, the stroke, two strokes, three, the modules, and
Home. The device steps (`Device.astro`, `Figs.astro`) are gone; the story now lives in
`Closer.astro`, driven by `story()` in `motion/colophon.ts`.

**One drawing, one camera.**
- **The drawing:** one SVG in the font's units holds the line (from Oudom's outlines) and a
  "world" of strokes. The world is a group in the mark's own units, scaled so the first stroke's
  width is the stem's and its top sits on the stem's top.
- **The camera:** the viewBox, so everything stays sharp. It moves through keyframes
  (`between()`): the width on a log scale, the centre following the width, so every zoom closes
  in or pulls back at an even pace. Each view is fitted to the screen's shape, with room under it
  for the words.

**The story, on one scroll (1050svh).**
1. **Read closer:** the line, small as a colophon, closes in on the d. Its joins show; a 45°
   guide lands on the stem's cut.
2. **One stroke:** the stroke lies over the stem whole. Then the letters go and its own foot
   shows, and the camera pulls back to it.
3. **Two:** a second stroke slides in from the right; one window, a link. Mod and duo; Maciej
   and Mike.
4. **Three:** a third comes from the left, and it's the mark.
5. **Six:** three more come in, and the six modules are named, staggered so the names don't
   crowd.
6. **Home:** the chain opens and each stroke becomes its module's widget, with the windows lit
   as the links between them (see "Home, as the chain itself" below; the first version, a board
   of widget icons, is gone).

**Why three, as the page says it:** it's the fewest strokes in which one is joined on both sides.
The middle holds two windows, the first chain, and three strokes read as an m. The brand's own
meaning is "overlap is connection" (brand brief §3). The six-stroke chain, its five windows as
the five links, is the home page's interlock. The module contract is real: every module links,
ships its assistant tools and gives Home its widget (AGENTS.md, module contract).

**Idle:** while the chain is on screen, from two strokes to six, the strokes breathe a hair apart
and back on the ticker, so the windows breathe too.

**Without motion:** the line at its size, the device, and the seven beats as a strip, each with
a small figure: one stroke, two, the mark, six, the board.

**After the blind critic (7.35):**
- **Captions:** they sit on a band at the stage's foot that the drawing fades under, not on
  boxes over it.
- **The stem:** the stroke takes its place in one frame, so no two shapes show at once.
- **Captions run back to back,** so there is always one on screen.
- **Flying home:** the strokes stop cancelling, so there are no black pills, and the widgets'
  words wait until they land.
- **Home shows its links:** hairlines run between the widgets in reading order, and each widget
  has its real link line ("Task: Review the alpha invite").
- **On a phone** the module names are left to the words; they were too small to read.
- **The h1** is "Set in Oudom." alone, the sentence under it is a `<p>`, and the line stays on one
  line at every width.
- **The edition's type link** is quieter at rest, so the pointer visibly lights it.

**The d to the stroke, as a flow (Mike: smoother, then "cleaner, without a morph").** The cut is
gone, and nothing changes shape. The stroke lies inside the stem from the close-up on: its top
edge sits on the stem's cut, its sides on the stem's sides, and it's drawn under the letters,
so it can't be seen. Then one camera move pulls back from the stem's top to the stroke while the
letters, the stem with them, fade out together. What's left is the stroke, which was there all
along. The joins' hairlines go just before, so no seam shows.

**Home, as the chain itself (Mike: the board was poor; keep it in the flow).** The board, the
flight and the widget icons are gone. Home is the six strokes the scene already has:
- **The chain opens.** The strokes slide apart to 1.45 offsets, and their fills go dark with
  a paper outline, so each one reads as a pane.
- **Each stroke is its module's widget:** the name, then two lines from the open alpha week
  ("4 new / The invite", "Alpha plan / 3 of 5 done"), clipped to the stroke's shape.
- **The five windows light up** as paper lenses where neighbours still overlap. Each has a
  node and a hairline down to the link it stands for ("The invite email, now a task" through
  "Maciej, in # open-alpha"), on two staggered rows.

The overlap that made the mark is now visibly the link between two widgets, so the last beat
says what the first five built. On a wide screen the camera frames the whole opened chain. On a
tall one it walks along the chain one widget at a time with its link, then steps back to show
all of Home as the last pose. The reduced-motion still is the same opened chain with its windows
lit.

**After three, back to the colophon (Mike: up to three it's right; after it the page drifts
into telling the product).** The six modules and Home are gone from the colophon: a colophon
says how the book is made, not what it's about, and the product has the home page for that.
The story now folds back on itself, and every step is about the type and the mark:
- **And back:** the mark folds by its own rule. The right stroke slides onto the middle and both
  cancel (only a hairline shows where their edges were); then the left slides on, and three in
  one place leave the one stroke. That's the edition's Rule row, done in front of you.
- **Read again:** the camera pulls back from the stroke to the line. The letters come back
  around it, the stroke lying exactly in the d's stem again, so nothing morphs here either.
  The line ends where it opened, with its joins faintly showing, and the kicker, the sentence
  and the device return. The page then reads the line word by word (the readings) and ends
  with the edition.
- **Removed:** the module names, the opened chain, the widgets, the lit windows and their
  links, and the phone walk.

**The colophon as an endless scene (Mike: keep it, make it the whole page, add a chain and the
blank).** The page is the scene and nothing else: the readings, the index of places and the
edition block are gone, and their facts now live in the beats. Nine beats on 1450svh:
read, stem, one, two, three, then:
- **More than three:** two strokes come in from the right, and the five strokes are the company
  pages (About, Manifesto, Press, Colophon, Typeface), named above, the others dimmed, this one
  lit: the grammar of every page hero's chain. The caption says when the site uses more than
  three: wherever there's a row to move along (page families, the manifesto's six parts,
  pricing's people). Past three it's never the mark.
- **The blank:** the two go, the left steps aside (2.3 offsets: it touches nothing, which is the
  404's "nothing opens"), and the right lies on the middle: both cancel, and the outline fades in
  where they lie. The hidden part: an outlined mark is on the press kit's misuse list, but the
  blank isn't drawn, it's what two leave behind; on the pricing page it is Free.
- **And back:** the left slides on and the blank fills: three in one place leave one. "Odd shows,
  even cancels" is the whole rule.
- **Read again:** out to the line; the credits (set by Maciej and Mike, printed with Astro, moved
  with GSAP) are in this caption, the colophon's own job.

**Endless:** the last frame is the first, so the scroll wraps. `setEndless()` in
`engine/scroll.ts` turns Lenis's `infinite` (and `syncTouch`, so touch wraps too) on for this
page and off when it goes; Base's `endless` prop marks the html so the footer steps out with
motion. The ScrollTrigger has no scrub lag (a lagging scrub would replay the story at the
wrap), and the h1 and the drawing swap in one frame at both ends instead of crossfading (two
half-see-through copies of one line read grey). The joins and the last caption go before the
end, and the cue comes back, so the wrap has no seam. Checked with wheel and touch, both ways.
Without motion nothing loops: the beats are a strip of figures (five strokes for the chain, an
outline for the blank), the loop sentence is hidden, and the footer is there.

**More than three, cleaner (Mike: better visualization, less text).** The dimmed strokes and the
two rows of big names are gone. The five strokes stay as the mark's rule draws them, pure white
with black windows, and each page is named small over its stroke's top in one row (at its foot it ran into the caption on a wide, short screen), Colophon in
Paper, the rest in Ash (hidden on a phone, where the caption says it). The caption is one line
of thought: "Past three it's never the mark: it's a chain, one stroke a page. These are the
company pages, and you're on the fourth."

**The window (Mike: a phase on the window between strokes; the chain can be the app's modules;
better copy).** A tenth beat after three, laid into the timeline as a pause (WIN 0.66, DW 0.14
beats; the section is 1600svh) so every other beat keeps its timing: the driver reads the
story's time with the pause taken out (`oq`). The camera steps in to the mark, and a 45° band,
the buttons' sweep at the mark's size, passes over it and turns it inside out: the strokes to
hairline edges, the two windows solid in Paper (each side stroke clipped by the middle one is
exactly its window). A second band turns it back. Two clip paths do it (`cz-norm`, `cz-turn`,
bands between x + y = lo and hi in the strokes' units), so nothing is ever half see-through: a
fill-opacity swap read as muddy grey. Its story: nobody drew the window, it's what two strokes
leave where they meet; it's the mark's meaning (where two parts meet, something opens, brand
decision 12); and the small mark's rule (13) thins the strokes rather than let it close.

"More than three" now says the chain is the app's modules too. Every caption was rewritten
shorter and plainer.

**Read again, without words (Mike: cleaner without it).** The last caption (the stroke back in
the d, Oudom's name, the credits, "keep scrolling") is gone: the line coming back whole says it.
The end is the opening frame and nothing more.

## 20. The type page as one sheet (3 November 2026)

Mike, after the colophon: "inspired how cool and clean effect we achieved in /colophon now let's
do the same with /typeface: less mess, one infinite animation that connected across all subpage
sections making entire content to flow". The page had eleven plates, each with its own idea (a 3D
hero, the name, the measure, weights, windows, Polish, figures, the glyph set, a tester, in use,
the spec), 21 screens long. Now it's one endless scene and nothing else, like the colophon.

Concepts considered:
- **A. One sheet.** A printer's type specimen is one sheet: the name at its head, then a
  pangram, figures, every glyph, the imprint. The camera reads the sheet: in place on the name,
  closer to an accent, along to the figures, back far enough to see the whole sheet, and up to
  the name again. Anchor: a specimen sheet is how type has always been shown, and the colophon
  next door is the book's back matter. 5 / 5 / 4 / 2.
- **B. One line.** The page as a single endless line of type the camera travels along. Fits the
  "read from the far end" story, but it's a horizontal gallery at heart. 4 / 4 / 4 / 3.
- **C. The stroke builds the face.** The mark's stroke stood up, bent and closed into letters.
  It's the colophon's own beat run the other way. 3 / 5 / 3 / 2.

**Pick A.** It gives every old plate a place on one drawing, so nothing cuts, and its last
frame (the whole sheet) is the screenshot.

```
Idea:        Oudom's page is one specimen sheet, read by one camera that never stops.
Metaphor:    a printer's type specimen, read with a loupe: close, along, back.
Signature:   the name turns round its d like a wheel and reads moduo; the last pull back shows
             the whole sheet, and the camera dives into the name again.
Emotion:     the colophon's calm: one thing on screen at a time, and nothing cuts.
Motion verb: read. The camera reads closer, along and back; the type changes in place.
Screenshot:  the whole sheet on black: oudom, the pangram, the clock, every glyph, the imprint.
```

One drawing (`components/typeface/Sheet.astro`), one driver (`motion/typeface.ts`):
- **The drawing** is one SVG in the font's units: the head (oudom, one path per stroke, redrawn
  from the two masters whenever the weight moves), the pangram with its marks apart, the clock
  from the tabular figures and the raised colon, the glyph set as SVG text in Oudom, the imprint.
- **The camera** is the viewBox, keyframed with the colophon's `between()` (log width).
- **Endless:** the last frame is the first. Lenis wraps the scroll; the footer steps out.
- **Without motion:** the h1 and its lead, the sheet as a still figure, the beats as text.

**The story, on one scroll (1800svh, endless).**
1. **The name** is the h1, set lowercase as the wordmark sets moduo. The drawing lies over it to
   the pixel (its box is the name's width at weight 500, and its line box's middle is the font's
   own) and takes over in one frame as the scroll starts.
2. **From the far end.** The name turns round its d like a wheel, its letters upright: a quarter
   round it stands as a column, half round it reads moduo, and it comes round to oudom. Half a
   turn about the d lands every letter exactly where moduo sets it (the letters are the same,
   so the distances to the d are too). The wheel is 1.4 times taller than wide, so as a column
   the u clears the d's ascender.
3. **Oud and dom.** Two strokes laid down slide in under the halves and overlap under the d,
   where they cancel: the mark's rule in the name.
4. **Light to Bold.** The camera closes on the d; the name runs to Light, then Bold, redrawn
   from the two masters.
5. **The window.** A 45° band passes over it and opens its windows (the ss01 glyphs, drawn as
   the font draws them) as the camera moves along to the m; a second band closes them.
6. **Nine strokes.** Back out, to 500; the joins show and the strokes part by kind: arches up,
   bowls down, stems where they stand, labelled at the left (larger in the drawing on a phone).
   Each beat starts where the last one ends: the full name shows only at the start, after the
   turn and for the strokes.
7. **Polish first.** The camera reads down the sheet to the pangram; its nine marks drop onto
   their letters; it closes in on ś, the kreska on its letter, and the letters round it step
   back.
8. **Figures.** Back out and along to the clock: the visitor's own time in tabular figures and
   the raised colon, the seconds small, and the app's numbers beside it (the clock alone on a
   tall screen).
9. **The set.** Back until the whole sheet shows, its edge a hairline: the name, the pangram, the
   clock, the 361 characters as text in Oudom, the imprint. On a wide screen the sheet stands
   right of the words, as tall as the frame; on a tall one the camera then steps in to the
   glyphs, which the whole sheet shows too small to read. The en and em dash in the set are
   drawn as paths (their cells hold a no-break space), so the page's text has no dashes.
10. **Back.** The camera dives into the name; the rows go and the page around the h1 returns: the
    first frame, so the scroll wraps without a seam.

The row being read is lit and the others wait at 18 %, until the whole sheet shows. The words
sit at the stage's foot; on a wide screen their band is only as wide as they are, so the sheet
beside them shows whole.

**Idle:** the name breathes ±20 units of weight (the h1 with it, so the hand-over still holds),
easing in and out; the clock runs while the sheet is on screen. The camera follows the weight
the scroll sets, not the breath, so it holds still at rest.

**Removed:** the 3D hero (`typeface-hero`, raw WebGL and earcut), the forme story (`Name`), the
measure plate, the weight slider, the Windows switch, the figures' switches, the glyph
inspector, the tester, "Quiet at 13 pixels", the spec table, and `set.json` (the data script
writes only `font.json` now). Their facts live in the beats and the imprint. Archived, with the
old `site.ts`, in `docs/local/Moduo Joiner/landing-archive-2026-11-03/typeface-before-sheet/`.

**The footer on an endless page** (both endless pages; `styles/base.css`): with motion it leaves
the flow but stays in the tab order. Tab past the header and it rises over the stage from the
foot; it goes again when focus leaves. It was `display: none`, so the keyboard stopped at the
header's last button. The still stage's grid is one column the stage's width
(`minmax(0, 1fr)`): an auto track grew to the strip's widest line, and under reduced motion
both the colophon and this page ran 1028 px wide on a phone.

**After the blind critic (7.05: Design 7, Usability 6.5, Creativity 7.5, Content 8):** the caption
band is more opaque and on a wide screen the sheet and the ś stand right of the words; the
joins show only while the strokes part; the plain and windowed names overlap a few units at the
band's edges, so no hairline shows; the rows come in only as the camera moves down; the labels
and imprint are Mist and larger; the scroll is 1800svh (was 2100); the name is 24vw on a phone.
Not taken: page transitions, the consent card and the nav hover (all site-wide).

**After the second critic (7.65: 7.5, 7.5, 8, 8):** each beat starts from the last one's end
(no reset to the full name between them); the weights run close on the d; the caption band is
off over the h1 at the start and the end (it greyed the lead's last line); a beat counter
("3 / 8") sits over each caption; the beats' titles are h2s and the h1 carries the kicker
("Typeface oudom"); the pangram's letters are a group each with their mark, so dimming them
leaves no doubled overlap at an ogonek; the labels show on a phone; under reduced motion each
beat has its figure (moduo, the bars, Light over Bold, the windows, the strokes apart, ś, the
time, a few glyphs).

**After the third critic (7.65 again: 7.5, 7.5, 8, 8; Accessibility up to 8, Responsive 7):** the
oud and dom labels sit under the part of their stroke that shows; the weights beat reads its
weight live ("3 / 8 · weight 360"); the m's two arches part from each other too, so "3 arches"
shows three; the Polish caption says the line holds all nine Polish letters; captions wrap
`pretty`; the band behind the words is taller on a wide screen. What still holds the score
under 8, all by choice: the page loops and never reaches the footer or a closing link (Mike's
"one infinite animation"; the footer is there for the keyboard and without motion), the header
hides while scrolling down (site-wide), no page transition was shown (site-wide), and on a phone
the whole sheet is an overview too small to read (the step in to the glyphs follows it).

**QA (3 November):** hand-over drawn against the h1 at the same instant: 126 differing pixels at
1440 (anti-aliasing), 203 at 390. Desktop 60 fps, throttled phone 60 fps; CLS 0; mobile LCP
0.68 s (the lead); axe 0 serious; no horizontal overflow, with or without motion; reduced motion
hides no text; the keyboard reaches the footer. The wrap checked with the wheel.
The audit's dash warning on `/typeface` is the en and em dash in the glyph set.

### Six beats, and the set drawn glyph by glyph (3 November 2026, late)

Mike, after a run of his own: the hero stays; the wheel turn was "crazy spinning", make it
"cleaner softer more pleasurable"; oud and dom "looks poor"; no talk of windows in the font; the
strokes parting by kind is out; link Adam Twardoch's kreska guide; and the end needs "this
animated view of every single glyph with the curves as it was previously" (the old inspector).

- **From the far end, as metal is cast.** No wheel and no camera move: the name turns over about
  its d as a whole (it squashes to its middle and opens backwards, reading "mobuo", the d a b, as
  a sort's face does), then each letter turns over where it stands, from the far end, and it
  reads moduo. Back the same way. The frame holds still the whole time. The caption says why:
  metal type is cast backwards, so a compositor reads from the far end, where a d looks like a b.
- **Oud and dom** part at the d: the name slides apart by a d and a word space, a second d
  coming out from under the first, so each word keeps one; a gloss under each ("wood, in
  Arabic", "home, in Polish"); then they close and the two d's are one again. The bars are gone.
- **Removed:** the window beat (the ss01 sweep, its clips and alternates) and the nine strokes
  beat (the parts by kind, their labels, the joins on the name). The name is one path per letter.
- **The kreska caption links Twardoch's guide** ("Polish Diacritics: how to?"), which says a
  kreska runs steeper than an acute and sits further right. A beat's link is real text with the
  site's `.link` treatment; hidden beats are `visibility: hidden`, so it takes focus only while
  its beat shows (and always without motion).
- **The set and its plate.** The glyph row is the set (28 to a row, left) and a plate (right):
  the glyph on its metric lines with its advance, its strokes filled with their outlines over
  them in the ground, its handles and points (square at a corner, round where smooth). Every
  1.8 s the next character in code point order: its outline draws in, the points come up, the
  strokes fill behind a 45° edge (the colophon's sweep, so nothing is ever half see-through), it
  holds, and a second 45° edge wipes it. The weight drifts Light to Bold under it all the while,
  so the curves and handles move. The cell being drawn is lit in the set, and a readout gives
  the character, its code point, strokes, width and weight. It starts on the g, drawn, as the
  still plate has it; it runs on the ticker while the set is near, and the camera holds still.
  On a phone the camera frames the plate alone. The glyphs come from `/typeface-glyphs.json`
  (an Astro endpoint over `font.json` without kerning: 83 KB gzipped), fetched at low priority
  as the page starts, because the endless scroll can wrap backwards straight to the set.
  Drawing: `lib/typeface-glyph.ts`, shared by the still plate and the browser.
- **Timeline:** 1500svh (was 1800), six beats; the camera's stops are one list. 60 fps at the
  plate with the CPU at a quarter speed.

### The home page's line, and the sheet as a poster (3 November 2026, night)

Mike: use the home page's headline as an example in the scene, and make the last frame (the
whole sheet) "like outstanding poster", after Vercel's Geist posters.

- **Light to Bold, on the home page's line.** The weights beat no longer closes on the d: the
  camera comes down to "Your space to think, dream and build." under the name, and a live row runs
  Light to Bold down five rows, set down at 300, 400, 500, 600 and 700. Each new row comes out
  from under the last one through a slot (a clip just under the last row's descender), so no
  two rows ever overlap half-drawn. The rows stay flush left, so their right ends step out as
  the weight grows. On a tall screen the camera holds on their left part and the rows run off
  the right edge. Every glyph's place is a mix of its Light and Bold places, so the live row is
  exact at every weight.
- **The poster.** At the end the sheet is a Swiss specimen poster: a head of facts in four
  columns over the name (Oudom, typeface, © 2026 Moduo · Version 1.3, 466 glyphs, 2,043 pairs ·
  Light 300, Bold 700, 38 KB · say it oo-dom, Moduo backwards), the name's ascender, x-height,
  baseline and descender drawn across the sheet and named at its right, a hairline between every
  row, the margins and the column the clock's numbers and the plate share. It forms as the
  camera pulls back: the rows light from the head down, then the hairlines draw in, then the
  metric lines, then their names and the head. The camera holds on it centred (no caption, no
  band), with the plate still drawing glyphs and the clock running, then dives into the name.
- **Tried and cut:** a giant d in hairline with its points behind the head, after Geist's G
  poster. It ran off the edge into the metric names and the line stack; the plate already carries
  that motif, so the poster stays a clean grid.
- **Timeline:** 1650svh; the poster holds from 1.52 to 1.68 beats.
- Without motion the still figure starts at the line's five rows (the poster's frame needs the
  scene).

### The poster, cleaner (4 November 2026)

Mike: "the poster needs to be cleaner more pleasurable", and no pangram on it. The poster keeps
three things: the name on its metric lines, the home page's line at five weights, and the
plate. As the camera pulls back from the set, the pangram, the clock and the set step out and
the plate glides up under the line, twice its size, still drawing glyph after glyph (its own
metric lines and readout with it). The head of facts, a hairline round the whole and between
the three parts, and the imprint at the foot draw in after. The sheet's old edge and imprint
row are gone with motion (the still figure keeps its imprint). 1700svh; the poster holds from
1.55 to 1.72 beats.

### The poster without rules (4 November 2026)

Mike: no lines on the poster, a more artistic placing, the Moduo logo, and no mention of the
coding agent. The frame, the dividers and the name's metric lines are gone, and the plate's own
guides (its metric lines, advance and readout) fade as it grows. The composition runs on one
left edge: the name, the line's five rows flush under it (the line now starts at the name's
left edge, its weights hung in the margin), the lockup and the imprint at the foot. Against
it, the plate's glyph stands three and a half times the size at the right, still drawn glyph
after glyph with its points and handles, its reading at the foot on the right. The head of
facts is three columns over the name. The imprint now reads "Drawn by Mike Grochowski" (it no
longer names the coding agent; this replaces the credit line in §8).

## 21. Six modules, one window (4 November 2026)

Mike: make the home page's "Six modules. One window." section much cleaner, placed differently,
in the spirit of the colophon and the type page, and as a continuation of the scene above it.
The section was a bento grid: six module cards and a wide keys card.

```
Idea:        The title is literal: one window, and the six modules pass through it.
Signature:   the hand-over. The scene's last frame holds; the six strokes it drew are laid over it
             to the pixel; its words and ribbon fade, the title takes the place of its last line,
             and the six strokes glide down into the title bar of a window that opens out of them.
Motion verb: glide (the chain), sweep (each module in behind a 45° edge that wipes the last).
Screenshot:  the title at the top left, the window at the right with Calendar in it, its stroke
             lit in the bar, and Calendar's line at the foot.
```

- **One held stage** (`components/home/ModulesIndex.astro`, driver `motion/modules.ts`), 1000svh,
  starting a screen early (`margin-top: -100svh`) so it pins exactly where the scene's stage lets
  go, above it (z 4 over 3). Until then it shows nothing and takes no pointer.
- **The hand-over:** while the stage is held the scene's stage is fixed where it let go
  (`.scene.is-held`). `motion/interlock.ts` exports `lastChain` (each stroke's left edge, the
  ribbon's first stroke each side, the camera), and the driver draws the six over the canvas to
  the pixel, with the two windows the ribbon cut into the chain's ends; the scene's stage fades
  (words, names, ribbon), and the six are ours. Checked by differencing the frames either side
  of the hand-over: only anti-aliased edges differ.
- **The window** opens down out of its bar as the chain lands in it (log-scale glide, the strokes
  closing to the mark's offset). The bar shows the chain (the open module's stroke lit, all six
  for the keys) and the module's name.
- **The modules:** one beat each (100svh), each pane swept in behind a 45° edge that wipes the
  last (a clip band, never a crossfade), its picture playing its moment (`bento:play`, sent by
  the driver; `motion/bento.ts` no longer scroll-triggers pictures inside this section), its
  words at the stage's foot: "n / 6", the name (a link), the line, "Open Email". Then the keys
  (⌘K across all six) and "Plus Home". The stage then scrolls away into "Bring any AI".
- **Phones:** the title over the window, the window across the screen, the words under it; the
  intro makes way as the window opens; the keys' hint and the Home line are left out.
- **Without motion:** the same seven as a list, each module's words beside its window.
- **QA:** home unchanged against the 3 November baseline (hidden text under reduced motion 6, all
  in Dusk; mobile LCP 2.2 s, the Dusk line; phone FPS 46), no console errors, axe serious 0
  after Contacts' relation label went from 0.7 to 0.76 alpha (4.5:1 once the row shows whole).

## 22. Six kinds of work and six modules, one section (4 November 2026)

Mike: "too much fluff"; merge the scene's "Six kinds of work, spread over ten apps." with "Six
modules. One window." The two said one thing twice: the problem early in the scene, the answer
two screens later. Now the modules' section says both, and each module carries its share of
the ten apps.

- **The scene loses its first words.** The mark still deals out six strokes, apart and named;
  "In Moduo they overlap." now follows them directly (the beat, its text and its still chain are
  gone; `interlock.apart` removed).
- **The section's title is the problem:** "Six kinds of work, spread over ten apps." takes the
  place of the scene's last line as the chain lands in the window (t-l now, it's longer).
- **Each module takes its apps over:** over its name, the apps it replaces, struck out as it
  comes in (Mail · To-do list, Planner, Time tracker, Habits · Notes, Docs · Calendar · CRM ·
  Team chat: the ten the old paragraph listed), as `<s>` with "Instead of" for screen readers.
  The window's bar counts them: "1 of 10 apps", "5 of 10", up to "10 of 10".
- **The answer closes it:** "Six modules. One window." over the keys, all six strokes lit, the
  ⌘K palette in the window. The keys sentence is shorter; its hint and the "Plus Home" line and
  the intro paragraph are cut.
- **Shorter:** a module every 75svh (was 100); the section is 750svh (was 1000).
- **A jump past the scene** (a link, a fast scroll) finds the chain in the bar: the hand-over
  only takes the scene's frame when the scene drew it at its end (`lastChain.p`).

## 23. The window holds the app (4 November 2026)

Mike: rebuild the module mockups and their animations in the one window, "make them the design
masterpiece". The panes held the bento cards' small pictures (made for cards a third the size),
floating in the top left of a large window with dead space under them.

- **The window is the app.** Each pane is the module's full picture from the module pages
  (`components/frames`, the app's own chrome, panels and tokens, in Geist), filling the window
  at the app's proportions (0.62 of its width; 1em = 14px at 1040px wide, so about 11.5px here).
  As one module sweeps over the last, the app's own tab bar moves its lit tab: one window, six
  modules, literally. The outer window gets a quiet title bar: three grey lights, the chain, the
  count of apps. On the keys beat it's Home, dimmed, under the ⌘K palette.
- **A camera per module** (`.mods__cam`, a transform from its top left): as the module comes
  in, it closes on the module's one gesture (1.3 to 1.85 times) and holds; scrolled back, it
  pulls out. On a phone (the app in its one-column layout, type a size up) it only pans.
- **The moment plays when the camera arrives** (once per arrival; scrolled back before it, it
  waits again): the gesture's key comes up as a real keycap over the control (under it for Done,
  so the title stays readable), goes down, the control dips, the app does it, and the app's own
  toast says what happened (`modulesIntro.moments`). Per module: Email, T on "To task" → "Task
  made · Open alpha invite · Email attached"; Tasks, ⏎ on Done → the title struck through → "Done
  · 24 min on the task"; Notes, ⌘⇧T on the typed line → "Make task" becomes a Task chip; Calendar,
  the review drops into Thursday 14:00 → "Accepted"; Contacts, Link on the suggestion → it folds
  into "Linked to Open alpha"; Chat, the wrap-up, the Decision flag and the reactions arrive.
- **Without motion:** the list keeps each module's full picture beside its words (the frames'
  still state is each moment's result).
- **QA:** no console errors, axe serious 0, no overflow, hidden text under reduced motion 6 (all
  Dusk, as before), mobile LCP 2.2 s; the throttled phone scrolls at 41 fps (42 to 46 before:
  six full app pictures are in the page now).
- The bento cards' pictures (`components/bento/*Mini`) stay for the keys palette and the other
  pages' bentos; `motion/bento.ts` still plays the palette's typing when the keys come in.
