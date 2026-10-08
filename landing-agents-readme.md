# Moduo — Landing agent brief
> quiet black instrument

**Theme:** dark (`data-theme="dark"` `data-shade="black"` `data-accent="mono"` `data-radius="soft"` `data-font="geist"` `data-density="comfortable"`)

This file is the prompt for Moduo's marketing pages: the landing (`landing/index.html`), the manifesto and the legal pages. It keeps the *shape* of a product landing (hero, then one idea per section) and takes every visual decision from the app's own system in `src/styles/tokens.css`. Hex values below are the sRGB landing equivalents of those oklch tokens: paint with the hex, name them with the token. Don't import Linear's palette, Inter feature settings, acid lime or a gradient floor.

**Sources of truth.** Brand (logo, lockup, colors, type, motion, voice, lines, imagery): `.design/brand/BRAND_BRIEF.md` and `.design/brand/DECISIONS.md` (numbered decisions, cited below in brackets like (40)). They live on `maciej`/`develop`; this branch carries only the landing. The app: `src/styles/tokens.css`, `docs/DESIGN_RULES.md`, `docs/DESIGN_SYSTEM.md`, `docs/PRODUCT_BRIEF.md`. If this file and the brand brief disagree, the brief wins and this file gets fixed.

Moduo's marketing surface is a pure-black page (`#000000`, Canvas black) with paper-white type (`#fafafa`, Paper) and one near-white primary action (`#eeeeee` fill, `#030303` text). Darkness is the canvas, not a tinted theme. Hierarchy comes from a three-step surface ladder (canvas → card → popover) plus a 1px hairline (`#1b1b1b`), not from shadows or a chromatic flashlight. Type is Geist at 400–600. Buttons are 8px radius; cards are 12px; pills are full-round and reserved for badges. The product is the only picture (67).

---

## The brand in five lines

1. **The product is the brand.** Black, white, Geist, the mark. No brand hue, no second typeface, no illustration style (4).
2. **Black is home.** Light is an equal-quality second expression, used where the reader's environment decides (39).
3. **No hues.** Hue accents (pink included) are a personal setting inside the app, never the brand. There is no AI color (40, 41).
4. **Things arrive, they don't perform.** One exception: the mark revealing itself out of nothing (53, 54).
5. **Plain, calm, direct** (59).

---

## What the page is selling

**Moduo is a lightweight workspace that links email, tasks, notes, calendar, contacts and chat in one window** (the one-line boilerplate, 75). It is for a solo operator, a pair, or a small team who today duct-tape five to ten apps together. The moat is the connective tissue, not any one module.

Lead with the connection. The savings story (fewer subscriptions) is the justification, not the headline.

- **Module order**, wherever modules are listed: email, tasks, notes, calendar, contacts, chat (75).
- **It's a waitlist page.** The app can't be downloaded yet: the call to action is "Join the waitlist", and the hero pill says "Private beta".

### Lines (61)

| Role | Line | Where |
| --- | --- | --- |
| **Campaign line** (rotatable) | **Fire ten apps. Keep the work.** | Landing hero, `<title>`, OG image, ads |
| **Brand line** (permanent) | **One window for the whole working life.** | Footer headline, bios, press, social banners, store subtitle |
| Dropped | ~~The last productivity app you'll ever set up.~~ | An overclaim. Never use it. |

**Hero copy as shipped** (change only with Maciej's OK):

- Headline: `Fire ten apps.` / `Keep the work.` (second line in the soft color)
- Subcopy: `Email, tasks, notes, calendar, contacts and chat in one workspace, linked to each other, so nothing lives in two places.`

Sentence case everywhere else. "Join the waitlist", "How it connects", "Make it yours". Status words stay capitalized: Done, Today, Inbox.

### Do not put on the page

- **Lies.** No invented customer logos, quotes, counts, testimonials or "trusted by" strips. No mock changelog: the "Shipping every week" section stays commented out until it can link to a real changelog.
- **Replicas of the real app UI.** The app UI isn't final, so every product picture is a stylized demo built in HTML/CSS, never a screenshot or a pixel copy (the live-app hero is parked at `landing/parked/live-hero.html` for later).
- Notion-style databases, a graph view, or "define your object type". Say **linked**, never graph, database, object type or relations (64).
- An auto-scheduling robot, bank-connection finance, a whiteboard or a mind map.
- AI sparkle, an AI badge, an AI color or an "AI dot" (40a). AI is a trust message ("bring your own AI; Moduo never trains on your data"), never a visual theme. An assistant shows up by name, like a person.
- Gradient meshes, stock photography, lifestyle shots, 3D, abstract or AI-generated imagery (67).
- A second accent color used as a button. Hue accents are a Settings choice; the page stays mono.
- Emoji, exclamation marks (63). Icons are single-color Phosphor-style line icons, in foreground or muted foreground.
- A location in brand copy (75). The legal pages keep the registered company address because the law requires it.

---

## Logo: lockup and mark (11–26)

The logo files come from the BRAND-1 pipeline (`brand/exports/` on `maciej`, generated from `brand/masters/`, which only Maciej edits). The landing inlines them as SVG paths, so nothing is retyped.

| Where | What | Size |
| --- | --- | --- |
| Landing nav (`index.html`) | **Lockup**, Paper (`currentColor`) | 22px tall, 98px wide, on every width |
| Manifesto, privacy, terms nav | **Lockup**, `currentColor` (Ink in light mode, Paper in dark) | 17px tall, 76px wide |
| Footer, top of the first cell | **Lockup**, Paper, above the brand line | 22px tall |
| OG image (`landing/assets/og.png`) | **Lockup**, Paper, top-left, left edge on the headline's left edge | 40px tall |
| Hero mock's app bar, the close section, the waitlist dialog | **Mark alone** | as drawn |
| Footer plate | **Wordmark alone**, drawn as construction (the mod + duo story is landing content only, 8) | as drawn |
| Footer "Depth 14" cell | The wireframe extruded mark: a **landing one-off**, never reused anywhere (16) | as drawn |

- **The lockup is artwork, never type.** Never set "moduo" or "Moduo" in Geist as a stand-in for the logo (18). In the code the lockup is two sprite paths, `#mk-mark` and `#mk-word`, used inside `viewBox="271.18 225.36 2445.96 549.48"` (the lockup master's box). Proportions come from the master lockup; never re-space it in CSS (21).
- **Mark alone** is the everyday signature; the **lockup** is for first contact: nav, footer, OG, press (17).
- **Color:** Paper on black, Ink on white, `currentColor` in code. Never a hue, gradient, outline, shadow or glow (14). No tile behind the mark except favicons and avatars (15).
- **Clear space:** one "o" height around the lockup; a quarter of the mark's height around the mark alone (22).
- **Minimum size:** lockup 72px wide; mark 16px (23).
- **Never:** stretch, rotate, mirror, recolor to a hue, put the mark in a circle, glue a tagline into the lockup, or place emoji or sparkle beside it (25).
- **When the masters change** (BRAND-0): re-copy the `mk-mark` / `mk-word` paths from `brand/exports/svg/lockup-current.svg` into all four pages, recheck the reveal's stroke (`#mk-stroke`, see Motion), regenerate the OG image, and recheck the footer plate, which is drawn on the wordmark's geometry.
- **Favicons** come from `public/` (the landing build copies the web build), generated by the same pipeline: a black tile with the Paper mark (30).

---

## Tokens — Colors

Landing hex is the sRGB paint. The Token column is what the app calls the same role. Use one primary action per view. Status and label hues appear **inside product pictures only**, never as page chrome (41).

| Name | Value | Token | Role |
|------|-------|-------|------|
| Canvas black | `#000000` | `--background` | Page background. Pure black. Full-bleed. The brand's home. |
| Reading black | `oklch(0.2 0 0)` ≈ `#161616` | (marketing only) | Long reading on dark: the legal pages and the manifesto (37) |
| Paper | `#fafafa` | `--foreground` / `--neutral-50` | Headlines, primary text, the logo on black |
| Ink | `oklch(0.16 0 0)` ≈ `#0d0d0d` | (marketing light) | Type and the logo on white (the text pages' light mode) |
| Mist | `#a4a4a4` | `--muted-foreground` / `--neutral-400` | Body subcopy, metadata, inactive icons |
| Ash | `#7a7a7a` | `--neutral-500` | Tertiary captions, footer text |
| Hairline | `#1b1b1b` | `--border` / `--neutral-800` | 1px borders, dividers, ghost outlines |
| Card | `#090909` | `--card` / `--neutral-900` | Raised panels, product-frame fill |
| Popover | `#121212` | `--popover` / `--neutral-850` | Menus, floating panels inside product pictures |
| Well | `#121212` | `--muted` / `--input` | Input wells, quiet fills |
| Hover | `#1b1b1b` | `--accent` / `--secondary` | Row hover, secondary button fill |
| Primary | `#eeeeee` | `--primary` (`data-accent="mono"`) | The one filled action |
| Primary text | `#030303` | `--primary-foreground` | Label on the primary button |
| Primary hover | `#ffffff` | `--primary-hover` | Primary button hover |
| Focus | `#eeeeee` | `--ring` | 2px focus ring, offset by canvas |

**Pink is not a brand color, not the default accent and not an AI color** (40). It is one ordinary option among the eight accents in the "Make it yours" demo and among the tag colors, exactly like violet or teal. There is no `--ai` variable.

### Inside product pictures only

These are real app tokens. They must not become landing buttons, section backgrounds or headline color. Product pictures always show the default look: black shade, mono accent (41), except inside the "Make it yours" demo, where the visitor picks.

| Name | Value | Token | Role |
|------|-------|-------|------|
| Success | `#61c568` | `--success` | Done check, paid |
| Warning | `#fcb442` | `--warning` | Slippage, due soon. Never a wall of red. |
| Danger | `#fc4447` | `--destructive` | Destructive confirm only |
| Info | `#00ade4` | `--info` | Informational status |
| Label pink | `#f862b3` | `--pink-base` | Tag chip (one ordinary tag hue) |
| Label violet | `#9e71fd` | `--violet-base` | Tag chip |
| Label blue | `#0099f7` | `--blue-base` | Tag chip |
| Label green | `#3fc168` | `--green-base` | Tag chip |
| Label amber | `#f9ad26` | `--amber-base` | Tag chip |
| Label teal | `#00bcc5` | `--teal-base` | Tag chip |

Tag chips use the hue as a small dot plus a faint tinted surface (~18% alpha of the same hue); text stays `--foreground`. Gray (`#a4a4a4` at 16%) is the default tag.

---

## Tokens — Typography

### Geist — the only family · `--font-ui`

Geist is the only face, brand included (47). Display and body are the **same family**. Hierarchy is weight and size. Don't pair a second marketing typeface.

- **Substitute:** Inter, then system-ui
- **Weights:** 400 regular, 500 medium, 600 semibold. **300** only for large quiet display lines (22px and up). **Never 700** (48).
- **OpenType:** default. Don't turn on `cv01`, `ss03` or `zero`.
- **Numbers:** tabular figures for times, dates, prices and codes.
- **Roles:**
  - `font-display`: headlines, button labels, section titles, eyebrows that are not 11px
  - `font-sans`: subcopy, descriptions, metadata, badge text (same family, regular weight)
  - `font-mono` (Geist Mono): codes, keyboard hints and IDs inside product pictures only. Never headlines (50).

### Marketing type (page chrome)

Tracking (51): hero −0.035em · section titles −0.02em · small heading text −0.015em · body 0 · eyebrows +0.04em, uppercase, 11px. Product UI **inside** frames uses the app's 14px scale, not this one.

| Role | Weight | Size | Line height | Tracking | Token |
|------|--------|------|-------------|----------|-------|
| eyebrow | 500 | 11px | 1.35 | 0.04em | `--text-2xs` |
| caption | 400 | 13px | 1.5 | 0 | `--text-sm` |
| body | 400 | 18px | 1.5 | 0 | marketing body |
| body-lg | 400 | 22px | 1.5 | 0 | manifesto |
| section | 600 | 36px | 1.15 | -0.02em | `--text-4xl` |
| hero | 600 | clamp(36px, 7.2vw, 88px) | 1.05 | -0.035em | landing h1 |

Manifesto max-width 36rem, `text-wrap: pretty`, color `--muted-foreground`.

### App type (inside every product frame)

| Role | Weight | Size | Line height | Tracking | Token |
|------|--------|------|-------------|----------|-------|
| eyebrow | 400 | 11px | 1.35 | 0.04em | `--text-2xs` |
| caption | 500 | 12px | 1.4 | 0 | `--text-xs` |
| ui | 400 | 14px | 1.5 | 0 | `--text-base` |
| emphasized | 500 | 15px | 1.5 | -0.015em | `--text-md` |
| title | 500 | 18px | 1.35 | -0.015em | `--text-lg` |
| page title | 600 | 24px | 1.2 | -0.015em | `--text-2xl` |

Buttons inside frames are always 14px / weight 500, even when the control is short or tall.

---

## Tokens — Spacing & Shapes

**Base unit:** 4px (Tailwind scale: 4, 8, 12, 16, 24, 32, 48, 64, 96)

**Density on the page:** comfortable. Product frames may show compact rows, but the marketing chrome stays comfortable.

### Spacing

| Name | Value | Use |
|------|-------|-----|
| 4 | 4px | Icon gaps, badge padding |
| 8 | 8px | Element gap, nav link gap |
| 12 | 12px | Tight stacks |
| 16 | 16px | Control padding, nav bar padding |
| 24 | 24px | Card padding |
| 32 | 32px | Stack between headline and subcopy |
| 48 | 48px | Block gap inside a section |
| 64 | 64px | Gap under the hero before the frame |
| 96 | 96px | Section gap |
| 128 | 128px | Hero top padding on large screens |

### Border radius (`data-radius="soft"`)

| Element | Value | Utility |
|---------|-------|---------|
| buttons, inputs | 8px | `rounded-md` |
| cards, product frames | 12px | `rounded-lg` |
| dialogs inside product pictures | 16px | `rounded-xl` |
| badges, avatars, status dots | 9999px | `rounded-full` |
| small nested chips | 4px | `rounded-sm` |

A rounded child inside a rounded parent uses inner radius = outer − padding, snapped to the scale. A chip in an 8px-radius row with 8px padding is square.

### Shadows

Elevation is the surface step plus a hairline. Shadows are quiet and rare.

| Name | Value | Token | Use |
|------|-------|-------|-----|
| xs | `0 1px 0 rgb(0 0 0 / 0.30)` | `--shadow-xs` | Pressed hairline |
| sm | `0 1px 2px rgb(0 0 0 / 0.35)` | `--shadow-sm` | Menus |
| md | `0 4px 12px rgb(0 0 0 / 0.45)` | `--shadow-md` | Popovers |
| lg | `0 12px 32px rgb(0 0 0 / 0.55)` | `--shadow-lg` | The hero picture only |
| overlay | `0 24px 64px rgb(0 0 0 / 0.65)` | `--shadow-overlay` | A dialog inside a product picture |
| focus | `0 0 0 2px #000000, 0 0 0 4px #eeeeee` | `--shadow-focus` | Keyboard focus |

### Layout

- **Page max-width:** 1120px, centered (the hero stage may run wider on large screens)
- **Section gap:** 96px
- **Card padding:** 24px
- **Element gap:** 8px
- **Nav height:** 56px (`--nav-h`)
- **Desktop first.** Phones get a per-section rework (a timeline instead of the story stage, compact rows instead of the lineup), not a scaled-down desktop page. Check 1024px, a wide desktop and a 390px phone before shipping.

### Motion (53–58)

**Things arrive, they don't perform.** Fade and a small blur-in, durations from the motion tokens, no spring, glow or scroll-jacking.

- Fade: 100ms (`--motion-fade`); slow: 320ms (`--motion-slow`)
- Ease: `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out`)
- Under `prefers-reduced-motion: reduce`: no travel, no blur, opacity snaps

**The reveal (54, 55), the one sanctioned exception.** The mark's rule is that overlapping parts cancel: visible = (left ∪ right) XOR middle. With all three strokes stacked, nothing shows; the side strokes slide out one offset each (194.24 units in the 1000 box) and the mark appears out of nothing. Then stillness.

- **Where:** the nav lockup on the landing, once, with the hero's entrance. The wordmark arrives (fade + blur) while the mark finishes.
- **When:** on a first visit, meaning you arrived from outside the site. Not on a reload, back or forward, a link to a section (`/#pricing`), or coming back from another page of the site. Nothing is stored in the browser for this.
- **Timing:** ≈800ms, `--ease-out`. Reduced motion: no slide; the finished lockup fades in with `--motion-fade`.
- **Never** loops, never plays on route changes, never on the text pages.
- **Code:** `#mk-stroke` (the middle stroke in the mark's 1000 box) drawn three times through two masks inside the nav lockup; the script animates the side strokes, then hands over to the real lockup paths. A head script sets `mk-intro` before paint and a 4-second failsafe shows the logo if the page script never runs.

---

## Voice (59–65)

- **Plain, calm, direct.** Short declarative sentences, second person, concrete nouns. The manifesto is the reference.
- **"We"** is Maciej and Mike; **"you"** is the reader. Personal notes are signed "Maciej & Mike".
- **Humor** is dry and rare, and never appears in errors, billing or deletion. No exclamation marks. No emoji.
- **Competitors:** name the category ("ten apps", "a duct-taped stack"), not the company, except on honest comparison and import pages.
- **Never these words:** seamless, supercharge, unlock, empower, AI-powered, revolutionary, game-changer, simply, just, easy, please, successfully. Never graph, database, object type or relations: say **linked**.
- **Name:** "Moduo" in sentences. Never MODUO, "Moduo App" or "Moduo AI". Lowercase "moduo" exists only inside the logo artwork.
- **American English** everywhere, comments included (color, organize, center, behavior, gray).

### Example cast (71)

One cast of believable small-studio work in every demo. Never lorem ipsum, never real customer data.

| Person / thing | Role |
| --- | --- |
| Anna Carter | Client; the email that becomes a task |
| Maya Brooks | Designer, owns the logo files |
| Jamie Ross | Teammate (chat, shared calendar) |
| Tom Becker | Guest booking a call (`tom@becker.studio`) |
| Sam Lee, Priya Nair | Extra meeting guests |
| Northwind Studio | The example workspace |
| Print shop | The vendor |

---

## Components

Map landing chrome to these. Names in parentheses are the app primitive.

### Primary button (`Button` variant `default`, size `lg`)
**Role:** The one filled action on the page: "Join the waitlist"

Background `#eeeeee`, text `#030303`, radius 8px, height 40px, padding 0 24px, Geist 14px / weight 500. Hover `#ffffff`. Focus ring 2px `#eeeeee` at 50% with 2px canvas offset. One treatment. The nav repeats it; the hero doesn't add a second hue.

### Nav link (`Button` variant `ghost`, size `sm`)
**Role:** Top navigation

Transparent, text `#a4a4a4`, hover fill `#1b1b1b` and text `#fafafa`, radius 8px, height 32px, padding 0 12px, Geist 14px / weight 500. No underline.

### Secondary button (`Button` variant `outline`, size `lg`)
**Role:** The quiet pair next to the primary

Transparent, 1px border `#1b1b1b`, text `#fafafa`, radius 8px, height 40px, padding 0 24px, Geist 14px / weight 500. Hover fill `#1b1b1b`.

### Ghost button (`Button` variant `ghost`)
**Role:** Tertiary text actions inside product frames

Transparent, text `#fafafa`, hover fill `#1b1b1b`, radius 8px, height 32px, Geist 14px / weight 500.

### Product frame (card)
**Role:** The window that holds a stylized product picture

Background `#090909`, radius 12px, 1px solid `#1b1b1b`, padding 0 (the picture goes edge to edge; caption sits outside). The hero picture alone gets `--shadow-lg`. No gradient floor under it. No glow. A frame's app bar shows the mark alone, never the lockup.

Inside the frame, draw Moduo's anatomy, not a generic dashboard: top-bar module tabs, rounded card panels, a bottom bar. Keep it stylized until the app UI is final.

### Quiet panel
**Role:** A supporting note beside a frame, or a module tile

Background `#121212`, radius 12px, 1px `#1b1b1b`, padding 24px. Title 18px / 500 `#fafafa`. Body 14px / 400 `#a4a4a4`. No shadow.

### Text input
**Role:** The waitlist email field, and fields inside product pictures

Background `#121212`, 1px border `#1b1b1b`, text `#fafafa`, placeholder `#7a7a7a`, radius 8px, Geist 14px / 400. Focus: border `#eeeeee`.

### Badge (`Badge`, `rounded-full`)
**Role:** Status and tags inside product pictures

Height hug, padding 2px 8px, Geist 12px / 500, radius 9999px.

- Neutral: fill `#1b1b1b`, text `#fafafa`
- Outline: transparent, 1px `#1b1b1b`, text `#fafafa`
- Success / warning / info: solid status hex, dark text `#030303` (danger text stays `#fafafa`)

Don't use badges as marketing chips across the hero. The hero's "Private beta" pill is the one exception.

### Module row (replaces a customer logo strip)
**Role:** Name the product's own modules

Plain words in module order: Email · Tasks · Notes · Calendar · Contacts · Chat. No logos, no cards, no "trusted by". These are the product's own modules, not other companies' marks.

---

## Do's and Don'ts

### Do

- Paint the page `#000000` and lift surfaces only to `#090909` and `#121212`
- Separate those surfaces with a 1px `#1b1b1b` border
- Use Geist 600 for the hero and section titles, 500 for buttons and UI titles, 400 for reading text
- Use radius 8px on buttons and inputs, 12px on cards, full-round only on badges and avatars
- Put exactly one primary button treatment on the page (`#eeeeee` / `#030303`)
- Use the lockup artwork in the nav, footer and OG image; the mark alone inside product pictures
- Write sentence case and American English
- Fade sections in; honor reduced motion

### Don't

- Don't use a chromatic CTA. No lime, no pink button, no gradient button
- Don't use weight 700
- Don't use a gradient floor, mesh or noise overlay behind the hero
- Don't use drop shadows except `--shadow-lg` on the hero picture and `--shadow-md` on a menu inside a product picture
- Don't set marketing type inside a product frame: frames use the 14px app scale
- Don't use Geist Mono for headlines or manifesto copy
- Don't invent customer logos, prices, quotes, counts or testimonials
- Don't draw a node graph. Links are a task row that mentions a person, an email, a time block
- Don't add emoji, sparkles, an "AI" badge, an AI color or an AI dot anywhere (40a); an assistant appears by name, like a person
- Don't retype the logo in a font, or put it in a tile, circle or colored field
- Don't build a light theme for the landing (the text pages have one)

---

## Surfaces

| Level | Name | Value | Purpose |
|-------|------|-------|---------|
| 0 | Canvas | `#000000` | Page, and the app canvas inside frames |
| 1 | Card | `#090909` | Product frame, module tiles |
| 2 | Popover | `#121212` | Menus, input wells, quiet panels |
| 3 | Hover | `#1b1b1b` | Hairline, hover fill, secondary button |

---

## Elevation

A surface is higher when it is one step lighter and closed by a hairline. The hero picture is the only marketing element with a real shadow (`--shadow-lg`). Selection inside a product picture is a faint white tint plus a 2px leading bar in `#eeeeee`, not a colored glow. Focus is a 2px ring, not a bloom.

---

## Imagery (66–72)

The product is the only picture (67): HTML-drawn, stylized product frames. No stock, no 3D, no abstract shapes, no AI-generated images.

- **People** (68): only real people with consent, meaning the founders' photos in `landing/assets/makers/`.
- **Illustration** (69): none.
- **Diagrams** (70): hairlines and small dots in Paper and gray. No color coding beyond module icons.
- **OG image** (72): `landing/assets/og.png` is the template: Canvas black, faint grid, the lockup top-left, the campaign line in Geist 600, a stylized product frame on the right. Every page uses it today; one per page comes later (home, manifesto, privacy, terms, press), each starting from `brand/exports/og/og-base.svg` (Canvas black with the lockup, 40px tall).

---

## Page structure (as shipped)

Full-bleed `#000000`. Desktop first, phones reworked per section.

1. **Nav.** Fixed. Left: the lockup (reveals on a first visit). Center: How it connects, Make it yours, AI, Pricing. Right: primary "Join the waitlist". A progress line under it.
2. **Hero.** Copy left: "Private beta" pill, the campaign line, the subcopy, the waitlist form. Right: ten separate apps sliding together into one stylized Moduo workspace.
3. **Lineup** (`#modules`). The modules in order, linked by lines on hover.
4. **Story** (`#story`). How it connects: Anna Carter's email becomes a task, a note, a block on the calendar.
5. **Make it yours** (`#yours`). A playground on the real appearance options: shades, the eight accents, fonts, density, radius.
6. **AI** (`#ai`). Bring any AI over MCP; keys only see what you allow.
7. **The stack tax** (`#tax`), **Fast** (`#fast`), **Yours** (`#data`), **What we won't build** (`#refuse`).
8. **Pricing** (`#pricing`), **Made by a duo** (`#makers`), **Questions** (`#faq`).
9. **Close** (`#close`). The mark, one line, platforms, the waitlist form again.
10. **Footer.** The lockup and the brand line, link columns, the "Depth 14" mark, the wordmark plate, the legal bar.

---

## Quick start

Landing paint tokens. In the app these stay oklch in `src/styles/tokens.css`; this block is for a standalone page.

```css
:root {
  color-scheme: dark;

  --background: #000000;
  --foreground: #fafafa;
  --muted-foreground: #a4a4a4;
  --card: #090909;
  --card-foreground: #fafafa;
  --popover: #121212;
  --popover-foreground: #fafafa;
  --muted: #121212;
  --accent: #1b1b1b;
  --accent-foreground: #fafafa;
  --secondary: #1b1b1b;
  --secondary-foreground: #fafafa;
  --primary: #eeeeee;
  --primary-hover: #ffffff;
  --primary-foreground: #030303;
  --border: #1b1b1b;
  --input: #121212;
  --ring: #eeeeee;

  --success: #61c568;
  --warning: #fcb442;
  --destructive: #fc4447;
  --info: #00ade4;

  --font-ui: "Geist", "Inter", system-ui, -apple-system, sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;

  --text-2xs: 11px;
  --text-xs: 12px;
  --text-sm: 13px;
  --text-base: 14px;
  --text-md: 15px;
  --text-lg: 18px;
  --text-xl: 20px;
  --text-2xl: 24px;
  --text-4xl: 36px;
  --text-hero: clamp(2.25rem, 7.2vw, 5.5rem);

  --leading-hero: 1.05;
  --tracking-hero: -0.035em;
  --tracking-tight: -0.015em;
  --font-weight-regular: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 9999px;

  --ctrl-h-sm: 26px;
  --ctrl-h: 32px;
  --ctrl-h-lg: 40px;
  --nav-h: 56px;

  --page-max-width: 1120px;
  --section-gap: 96px;
  --card-padding: 24px;
  --element-gap: 8px;

  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.35);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 0.45);
  --shadow-lg: 0 12px 32px rgb(0 0 0 / 0.55);
  --shadow-focus: 0 0 0 2px #000000, 0 0 0 4px #eeeeee;

  --motion-fade: 100ms;
  --motion-slow: 320ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```

**Checklist before you finish**

- Hero copy matches the shipped strings; the footer headline is the brand line
- The logo is the lockup artwork everywhere it appears with the name; no typed "moduo"
- No gradient, no weight 700, no invented logos, quotes or counts, no emoji, no exclamation marks
- No AI color, badge or dot; pink appears only as one of the accent and tag options
- American spelling, comments included
- `prefers-reduced-motion` turns travel off, including the reveal
- Checked at 1024px, a wide desktop and a 390px phone, with no console errors and no sideways scroll
