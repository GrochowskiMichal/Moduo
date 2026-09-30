# Moduo — Landing agent brief
> quiet black instrument

**Theme:** dark (`data-theme="dark"` `data-shade="black"` `data-accent="mono"` `data-radius="soft"` `data-font="geist"` `data-density="comfortable"`)

This file is the prompt for a Moduo marketing landing. It keeps the *shape* of a product-screenshot landing (hero, then one idea per section) and replaces every visual decision with the live app in `src/styles/tokens.css`. Hex values below are the sRGB landing equivalents of those oklch tokens — paint with the hex, name them with the token. Do not import Linear's palette, Inter feature settings, acid lime, or gradient floor.

Source of truth for the app: `src/styles/tokens.css`, `docs/DESIGN_RULES.md`, `docs/DESIGN_SYSTEM.md`, `docs/PRODUCT_BRIEF.md`. The live one-screen landing (`landing/index.html`) already locks the headline voice — keep it.

Moduo's marketing surface is a pure-black page (`#000000`) with paper-white type (`#fafafa`) and one near-white primary action (`#eeeeee` fill, `#030303` text). Darkness is the canvas, not a tinted theme. Hierarchy comes from a three-step surface ladder (canvas → card → popover) plus a 1px hairline (`#1b1b1b`), not from shadows or a chromatic flashlight. Type is Geist at 400–600. Buttons are 8px radius; cards are 12px; pills are full-round and reserved for badges. The only pictures on the page are the product itself: the three-pane shell, a task row, a calendar block, a contact rollup, an email turned into a task.

---

## What the page is selling

**Moduo is a lightweight workspace that unifies tasks, notes, calendar, contacts, finance, and email — and links them.** It is for a solo operator or a pair / team of five who currently duct-tape Spark + Morgen + Notion + Linear + a finance app + a spreadsheet. The moat is the connective tissue, not any one module.

Lead with the connection. The savings story (fewer subscriptions) is the justification, not the headline.

Four claims, in this order:

1. **The only place these connect.** An email becomes a task linked to a client who has an unpaid invoice that shows up on the calendar.
2. **Instant.** Native window, no waiting on big lists. Benchmark the feeling against a fast task app, not against a slow notes app.
3. **Works the day you sign up.** No databases to design, no template hunt. The dashboard is already useful.
4. **Fair, and the data is yours.** Pay for who you have, no seat minimum. Lossless export. AI is bring-your-own and never trains on the workspace.

**Locked hero copy** (do not rewrite):

- Headline: `One window for the whole working life.`
- Subcopy: `Notes, tasks, calendar, email, and contacts — linked, so context never splits across five apps. You don’t build a system. You just work.`

Sentence case everywhere else. "Get started", "See how it links", "New task". Status words stay capitalized: Done, Today, Inbox.

### Do not put on the page

- Notion-style databases, a graph view, or "define your object type".
- A chat product, an auto-scheduling robot, or bank-connection finance.
- AI sparkle, gradient meshes, stock photography, lifestyle shots, abstract illustration.
- Invented customer logos, invented pricing numbers, or "trusted by" strips.
- A second accent color used as a button. Hue accents are a Settings choice; the landing stays mono.
- Emoji. Icons are single-color line icons (Phosphor), in foreground or muted-foreground.

---

## Tokens — Colors

Landing hex is the sRGB paint. The Token column is what the app calls the same role. Use one primary action per view. Status and label hues appear **inside product screenshots only**, never as page chrome.

| Name | Value | Token | Role |
|------|-------|-------|------|
| Canvas | `#000000` | `--background` | Page background. Pure black. Full-bleed. |
| Paper | `#fafafa` | `--foreground` / `--neutral-50` | Headlines, primary text, logo mark |
| Mist | `#a4a4a4` | `--muted-foreground` / `--neutral-400` | Body subcopy, metadata, inactive icons |
| Ash | `#7a7a7a` | `--neutral-500` | Tertiary captions, footer text |
| Hairline | `#1b1b1b` | `--border` / `--neutral-800` | 1px borders, dividers, ghost outlines |
| Card | `#090909` | `--card` / `--neutral-900` | Raised panels, product-frame fill |
| Popover | `#121212` | `--popover` / `--neutral-850` | Menus, floating panels inside screenshots |
| Well | `#121212` | `--muted` / `--input` | Input wells, quiet fills |
| Hover | `#1b1b1b` | `--accent` / `--secondary` | Row hover, secondary button fill |
| Primary | `#eeeeee` | `--primary` (`data-accent="mono"`) | The one filled action |
| Primary text | `#030303` | `--primary-foreground` | Label on the primary button |
| Primary hover | `#ffffff` | `--primary-hover` | Primary button hover |
| Focus | `#eeeeee` | `--ring` | 2px focus ring, offset by canvas |

### Inside product screenshots only

These are real app tokens. They must not become landing buttons, section backgrounds, or headline color.

| Name | Value | Token | Role |
|------|-------|-------|------|
| Success | `#61c568` | `--success` | Done check, paid |
| Warning | `#fcb442` | `--warning` | Slippage, due soon — never a wall of red |
| Danger | `#fc4447` | `--destructive` | Destructive confirm only |
| Info | `#00ade4` | `--info` | Informational status |
| Label pink | `#f862b3` | `--pink-base` | Tag chip, and the single AI disc if an AI moment is shown |
| Label violet | `#9e71fd` | `--violet-base` | Tag chip |
| Label blue | `#0099f7` | `--blue-base` | Tag chip |
| Label green | `#3fc168` | `--green-base` | Tag chip |
| Label amber | `#f9ad26` | `--amber-base` | Tag chip |
| Label teal | `#00bcc5` | `--teal-base` | Tag chip |

Tag chips use the hue as a small dot plus a faint tinted surface (~18% alpha of the same hue), text stays `--foreground`. Gray (`#a4a4a4` at 16%) is the default tag.

---

## Tokens — Typography

### Geist — the only family · `--font-ui`

One picker, default Geist. Display and body are the **same family**. Hierarchy is weight and size. Do not pair a second marketing typeface.

- **Substitute:** Inter, then system-ui
- **Weights used:** 400 regular, 500 medium, 600 semibold. Never 700.
- **OpenType:** default. Do not turn on `cv01`, `ss03`, or `zero`.
- **Roles:**
  - `font-display` — headlines, nav wordmark, button labels, section titles, eyebrows that are not 11px
  - `font-sans` — subcopy, descriptions, metadata, badge text (same family, regular weight)
  - `font-mono` (Geist Mono) — code, keyboard hints, and IDs inside product screenshots only. Never headlines.

### Marketing type (page chrome)

The in-app scale tops at 48px. The landing headline is allowed to go larger, matching `landing/index.html`. Product UI **inside** frames uses the app scale, not this one.

| Role | Weight | Size | Line height | Tracking | Token |
|------|--------|------|-------------|----------|-------|
| eyebrow | 500 | 11px | 1.35 | 0.04em | `--text-2xs` |
| caption | 400 | 13px | 1.5 | 0 | `--text-sm` |
| body | 400 | 18px | 1.5 | 0 | marketing body |
| body-lg | 400 | 22px | 1.5 | 0 | manifesto |
| section | 600 | 36px | 1.15 | -0.02em | `--text-4xl` |
| hero | 600 | clamp(36px, 7.2vw, 88px) | 1.05 | -0.035em | landing h1 |

Hero max-width 18ch, `text-wrap: balance`. Manifesto max-width 36rem, `text-wrap: pretty`, color `--muted-foreground`.

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
| dialogs inside screenshots | 16px | `rounded-xl` |
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
| lg | `0 12px 32px rgb(0 0 0 / 0.55)` | `--shadow-lg` | The hero product frame only |
| overlay | `0 24px 64px rgb(0 0 0 / 0.65)` | `--shadow-overlay` | A dialog inside a screenshot |
| focus | `0 0 0 2px #000000, 0 0 0 4px #eeeeee` | `--shadow-focus` | Keyboard focus |

### Layout

- **Page max-width:** 1120px, centered
- **Hero type max-width:** 18ch headline, 36rem subcopy, left-aligned
- **Section gap:** 96px
- **Card padding:** 24px
- **Element gap:** 8px
- **Nav height:** 48px (`--bar-h`)
- **Min viewport to design for:** 1024px wide. Desktop only. No phone layout.

### Motion

Fade and a 4px blur-in. No spring, no glow, no scroll-jacking.

- Fade: 100ms (`--motion-fade`)
- Ease: `cubic-bezier(0.16, 1, 0.3, 1)` (`--ease-out`)
- Under `prefers-reduced-motion: reduce`: no travel, no blur, opacity snaps

---

## Components

Map landing chrome to these. Names in parentheses are the app primitive.

### Primary button (`Button` variant `default`, size `lg`)
**Role:** The one filled action on the page — "Get started"

Background `#eeeeee`, text `#030303`, radius 8px, height 40px, padding 0 24px, Geist 14px / weight 500. Hover `#ffffff`. Focus ring 2px `#eeeeee` at 50% with 2px canvas offset. One per view. The nav may repeat it; the hero does not add a second hue.

### Nav link (`Button` variant `ghost`, size `sm`)
**Role:** Top navigation

Transparent, text `#a4a4a4`, hover fill `#1b1b1b` and text `#fafafa`, radius 8px, height 32px, padding 0 12px, Geist 14px / weight 500. No underline.

### Secondary button (`Button` variant `outline`, size `lg`)
**Role:** The quiet pair next to the primary — "See how it links"

Transparent, 1px border `#1b1b1b`, text `#fafafa`, radius 8px, height 40px, padding 0 24px, Geist 14px / weight 500. Hover fill `#1b1b1b`.

### Ghost button (`Button` variant `ghost`)
**Role:** Tertiary text actions inside product frames

Transparent, text `#fafafa`, hover fill `#1b1b1b`, radius 8px, height 32px, Geist 14px / weight 500.

### Product frame (card)
**Role:** The window that holds a real product UI

Background `#090909`, radius 12px, 1px solid `#1b1b1b`, padding 0 (the UI goes edge to edge; caption sits outside). The hero frame alone gets `--shadow-lg`. No gradient floor under it. No glow. Optional 28px titlebar: three 8px dots in `#1b1b1b`, word "Moduo" at 12px `#a4a4a4`, left-aligned mark.

Inside the frame, paint the app, not a mock of a generic dashboard:

- Canvas `#000000`, left rail 256px `#000000` with a 1px right border `#1b1b1b`
- Rows 36px, title 14px `#fafafa`, meta 12px `#a4a4a4`
- Selected row: 14% white mixed into the card, plus a 2px `#eeeeee` bar on the leading edge
- Right rail 320px, same hairline

### Quiet panel
**Role:** A supporting note beside a frame, or a module tile

Background `#121212`, radius 12px, 1px `#1b1b1b`, padding 24px. Title 18px / 500 `#fafafa`. Body 14px / 400 `#a4a4a4`. No shadow.

### Text input
**Role:** Only inside product screenshots (capture field, search)

Background `#121212`, 1px border `#1b1b1b`, text `#fafafa`, placeholder `#7a7a7a`, radius 8px, height 32px, padding 0 12px, Geist 14px / 400. Focus: border `#eeeeee`.

### Badge (`Badge`, `rounded-full`)
**Role:** Status and tags inside product UI

Height hug, padding 2px 8px, Geist 12px / 500, radius 9999px.

- Neutral: fill `#1b1b1b`, text `#fafafa`
- Outline: transparent, 1px `#1b1b1b`, text `#fafafa`
- Success / warning / info: solid status hex, dark text `#030303` (danger text stays `#fafafa`)

Do not use badges as marketing chips across the hero.

### Logo mark
**Role:** Brand in the nav and the hero

Use the existing mark from `landing/index.html`: a single filled SVG path, `currentColor`, color `#fafafa`. Nav size 20px with the word "Moduo" at 14px / 500 beside it. Hero size 40px, no wordmark under it (the headline is the wordmark moment). Do not redraw the mark. Do not set it in a colored tile.

### Stack row (replaces a customer logo strip)
**Role:** Name the pile of apps a person can leave

A single horizontal row of plain words, Geist 14px / 500, color `#7a7a7a`, gap 32px: Tasks · Notes · Calendar · Email · Contacts · Finance. No logos, no cards, no "trusted by". This is the product's own modules, not other companies' marks.

---

## Do's and Don'ts

### Do

- Paint the page `#000000` and lift surfaces only to `#090909` and `#121212`
- Separate those surfaces with a 1px `#1b1b1b` border
- Use Geist 600 for the hero and section titles, 500 for buttons and UI titles, 400 for reading text
- Keep the hero at tracking `-0.035em` and line-height `1.05`, max 18ch
- Use radius 8px on buttons and inputs, 12px on cards, full-round only on badges and avatars
- Put exactly one primary button treatment on the page (`#eeeeee` / `#030303`)
- Show the product: three-pane shell, task rows, a calendar block, a contact with rolled-up email and invoice, an inbox row becoming a task
- Write sentence case
- Fade sections in at 100ms; honor reduced motion

### Don't

- Do not use a chromatic CTA. No lime, no pink button, no gradient button
- Do not use weight 700
- Do not use a gradient floor, mesh, or noise overlay behind the hero
- Do not use drop shadows except `--shadow-lg` on the hero frame and `--shadow-md` on a menu inside a screenshot
- Do not set marketing type inside the product frame — frames use the 14px app scale
- Do not use Geist Mono for headlines or manifesto copy
- Do not invent customer logos, prices, or testimonials
- Do not draw a node graph. Links are a task row that mentions a person, an email, a time block
- Do not add emoji, sparkles, or an "AI" badge on the page chrome. If a screenshot includes the AI disc, it is one small pink circle inside the product, not a section theme
- Do not build a light theme for this page

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

A surface is higher when it is one step lighter and closed by a hairline. The hero frame is the only marketing element with a real shadow (`--shadow-lg`). Selection inside a screenshot is a faint white tint plus a 2px leading bar in `#eeeeee`, not a colored glow. Focus is a 2px ring, not a bloom.

---

## Imagery

Product UI only, rebuilt with the components above so it matches the app rather than a screenshot of a different product. No stock, no 3D, no abstract shapes.

What each frame should contain:

1. **Hero — the window.** Left rail of modules (Tasks selected). Center: a short task list, one row selected, titles like "Send the revised invoice", "Block Thursday for the proposal". Right rail: the linked contact, the email it came from, the calendar block. This is the product in one glance.
2. **Link — email to task.** An inbox row, and the same subject already sitting in Today, with the contact named on both.
3. **Day — calendar.** A day column with a task block. A quiet overdue line, not a red wall. One control: "Reflow my day".
4. **Person — contact.** A contact header and a grouped rollup: emails, tasks, notes, one unpaid invoice. No manual-log form.
5. **Money — one number.** A single widget: what came in last month, and where it went. CSV-plain, no bank logos.

Icons are 14px line icons, `#a4a4a4` or `#fafafa`, never duotone.

---

## Page structure

Build one desktop page, top to bottom. Full-bleed `#000000`. Content column 1120px. 96px between sections.

1. **Nav.** Fixed, 48px, background `#000000` at the top and the same after scroll (no blur, no border until the page has scrolled — then a 1px `#1b1b1b` bottom border). Left: mark + "Moduo". Center or right links: Product, Modules. Right: ghost "Sign in", primary "Get started".
2. **Hero.** Left-aligned. Mark, then the locked headline, then the locked subcopy, then primary "Get started" and outline "See how it links" on one row, 8px gap. Below, the hero product frame, slightly wider than the type measure, shadow-lg.
3. **Modules row.** The six words, muted, centered under the frame. Labels, not links to other companies.
4. **Connect.** Section title on the left (36px), one sentence on the right (`#a4a4a4`, 18px). Then the email-to-task frame. One idea: the link is a side effect of working, not a setup step.
5. **Day.** Same two-column intro, then the calendar frame. Copy direction: the day can slip; the app helps you reflow it without guilt.
6. **People and money.** Two quiet panels side by side under one section title. Left: contact rollup. Right: the month widget. Do not split them into a six-card feature grid.
7. **Works on day one.** A short section, type only plus one small capture field inside a frame: a bare title is a complete task. No template gallery.
8. **Close.** Repeat the headline's promise in one line, then the same primary button. Footer: mark, "Moduo", and a one-line note that the data exports with you. No social icons, no fake columns of links.

Alternate text-left / frame-right only when a section has both. Never a 3-column feature grid. Never a pricing table until real numbers exist.

---

## Agent prompt — build the page

You are building a static desktop landing for Moduo. Follow this file exactly. Outcome: one HTML page, dark, Geist, pure black, product frames drawn in HTML/CSS (not images), copy as specified.

**Color reference**

- heading: `#fafafa`
- body: `#a4a4a4`
- canvas: `#000000`
- card: `#090909`
- quiet / input: `#121212`
- hairline: `#1b1b1b`
- primary button: `#eeeeee` background, `#030303` text
- focus ring: `#eeeeee`

**Component prompts**

1. **Hero.** Canvas `#000000`. Mark 40px `#fafafa`. Headline clamp(36px, 7.2vw, 88px), Geist 600, `#fafafa`, tracking -0.035em, line-height 1.05, max-width 18ch: "One window for the whole working life." Subcopy 18–22px Geist 400, `#a4a4a4`, max-width 36rem, the locked manifesto. Buttons: primary lg + outline lg, 8px radius, 40px tall, 14px / 500.

2. **Product frame.** `#090909`, 12px radius, 1px `#1b1b1b`, hero instance only `box-shadow: 0 12px 32px rgb(0 0 0 / 0.55)`. Inside: black canvas, 256px rail, 36px rows, 14px titles, selected row with a 2px `#eeeeee` leading bar. No outer glow, no gradient.

3. **Primary button.** `#eeeeee` / `#030303` / 8px radius / height 40px / padding 0 24px / Geist 14px weight 500. One treatment. Nav and closing section may both use it; do not invent a second style.

4. **Nav.** Height 48px, `#000000`, content width 1120px. Mark 20px + "Moduo" 14px / 500. Links `#a4a4a4` 14px / 500, gap 8px. Right cluster: ghost "Sign in", primary "Get started" at height 32px (size md) so it fits the bar.

5. **Section.** 96px above. Title 36px / 600 / -0.02em / `#fafafa`. Supporting sentence 18px / 400 / `#a4a4a4`. Then one frame or two quiet panels. Not three cards.

6. **Badge inside a frame.** Full pill, 12px / 500, padding 2px 8px. Neutral fill `#1b1b1b`. Status fills use success `#61c568`, warning `#fcb442`, info `#00ade4` with `#030303` text.

**Checklist before you finish**

- Headline and subcopy match the locked strings, including the apostrophe in "don't"
- No hex outside the table above
- No gradient, no weight 700, no customer logos, no prices, no emoji
- Every frame is recognizable as Moduo's three-pane black UI
- `prefers-reduced-motion` disables animation

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
  --bar-h: 48px;

  --page-max-width: 1120px;
  --section-gap: 96px;
  --card-padding: 24px;
  --element-gap: 8px;

  --shadow-sm: 0 1px 2px rgb(0 0 0 / 0.35);
  --shadow-md: 0 4px 12px rgb(0 0 0 / 0.45);
  --shadow-lg: 0 12px 32px rgb(0 0 0 / 0.55);
  --shadow-focus: 0 0 0 2px #000000, 0 0 0 4px #eeeeee;

  --motion-fade: 100ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
}
```
