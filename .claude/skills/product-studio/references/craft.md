# Craft, anti-slop and UX writing

## The craft checklist

What the best product teams inspect is concrete. Linear's weekly polish fixes are things like
adjacent buttons of different heights, a composer that grows when a line is added, and a hover
that snaps instead of fading over 150 ms. Check each item on every screen and every state.

**Alignment and rhythm**
- Labels, icons and buttons align on both axes; text baselines line up across a row.
- Everything sits on the spacing grid; optical adjustments are 1 px and deliberate.
- Rows of the same kind have the same height; inputs do not change height as content grows,
  unless growth is their job.

**Controls**
- Controls on one row share one rung: height, font size, icon size and radius.
- Hit targets are at least 24 px.
- Hover, focus and active states have more contrast than rest.

**Shape and depth**
- Radius follows role; nested radii are concentric (inner = outer minus padding).
- Shadows are layered and soft; borders are hairlines; depth comes from restraint.

**Color**
- Neutrals carry a trace of the background hue; pure grey reads as unfinished.
- The accent marks the primary action, the selection, focus and completion only.
- Color is never the only signal: status also has a shape, icon or word.
- Text contrast passes AA in every theme the product ships.

**Type**
- Type roles are fixed: chrome (headings, labels, buttons) and content (titles, values, body).
- Numbers that line up use tabular figures.
- Line length stays under about 80 characters in reading text.

**Density**
- Density is chosen per view and changes row height, control height and padding together.
- Dense views stay scannable: clear columns, quiet separators, strong first column.

**States drawn with care**
- Empty, error and loading frames get the same composition care as the full view.

## Anti-slop for product UI

Slop is the look a model reaches for by default. A critic and a person spot it in a crop. Avoid
these unless the house system deliberately chose one.

**AI-default looks** (Anthropic's frontend-design clusters):
- warm cream background with a high-contrast serif and terracotta accent;
- near-black with one acid-green or vermilion accent;
- broadsheet layout with hairline rules and zero radius;
- the SaaS card kit: identical rounded cards, one radius, faint shadow, gradient washes;
- template chrome: tracked all-caps eyebrows on every heading, middle-dot meta strings,
  monospace data labels, arrows on every link.

**Detector categories** (Impeccable's rule names, useful as a vocabulary):
- slop: `side-tab`, `gradient-text`, `ai-color-palette`, `cream-palette`, `nested-cards`,
  `monotonous-spacing`, `bounce-easing`, `dark-glow`, `radial-halo`, `icon-tile-stack`,
  `kicker-above-heading`, `numbered-section-labels`, `marketing-buzzword`;
- quality: `low-contrast`, `tiny-text`, `undersized-ui-text`, `cramped-padding`,
  `text-overflow`, `text-occlusion`, `clipped-overflow-container`, `skipped-heading`,
  `gray-on-color`, `line-length`, `tight-leading`, `edge-flush-cards`.

House rules can permit a listed pattern (a house font Impeccable calls overused, a deliberate
eyebrow label). When they do, the house wins; do not "fix" it.

**Product-specific slop:**
- a modal as the first answer to every question;
- a spinner where a skeleton would hold the layout;
- a dashboard of equal tiles with big numbers and no decision attached;
- a display font in labels, buttons or data;
- an AI badge, sparkle or glow on features;
- reinvented standard controls (custom scrollbars, custom selects that lose keyboard support).

**The specificity test:** could an unrelated product use this screen unchanged? If yes, the
surface has no point of view yet. Fix it in vocabulary, layout and the signature interaction, not
with decoration.

## UX writing

- **Sentence case** for everything, unless the house says otherwise. Proper nouns and
  standalone status words keep their capitals.
- **Specific verbs** on buttons: "Save draft", "Send invite", "Move to project". Never "Submit",
  "OK" or "Continue" when a real verb exists.
- **One noun per thing**, the same everywhere: a "project" is never also a "space" or a "board".
- **Errors** say what happened and what to do next, in the person's terms. Keep their input.
- **Empty states** say what the place is for and offer the first action.
- **No filler.** No "seamless", "elevate", "unleash", "supercharge", "effortless". No
  exclamation marks in system copy. No jokes in errors.
- **Address the person** consistently, as the house does (usually "you").
- **Numbers and dates** in the person's locale; relative dates for the near past and future.
- **Short.** A label is a word or two; a hint is one line; a toast is one sentence.

## Done when

Every screen and state passes the checklist, no slop pattern appears that the house did not
choose, and all copy follows the writing rules.
