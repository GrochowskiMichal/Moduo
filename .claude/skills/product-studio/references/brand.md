# Brand inside a product

Inside an app, brand is mostly restraint. People spend hours here doing their own work, so the
brand shows in voice, a single accent, the type and a few authored moments, never in decoration.
This file adopts the brand the project has, or defines a minimal one.

## Adopt existing brand guidelines

Look in brand folders and docs (see the detect table in `design-system.md`). Extract only what
the UI needs and note the source path for each:

| Element | What to take | Where it goes in the product |
|---|---|---|
| Voice and tone | How the brand speaks, words it uses and avoids, how it addresses the reader | System copy, empty states, errors, onboarding |
| Logo | Clear space, minimum size, light and dark versions | App icon, sign-in, about, the occasional mark in chrome |
| Color | The brand palette and which color is primary | The accent, and only the accent; neutrals stay neutral |
| Type | Brand typefaces and their licence for UI use | Usually headings at most; UI text stays in the UI family unless the house says otherwise |
| Imagery | Illustration and photo style | First run, empty states, rare moments; never behind working content |
| Iconography | Icon set, stroke and corner style | One set across the product, matched to the type weight |

Brand guidelines written for marketing often ask for more color, bigger type and more motion than
a working surface can carry. Translate them: the brand primary becomes the single accent, the
display face appears in a few headings or not at all, and campaign motion stays on the site.
Write each translation into DESIGN.md under "Brand in the product" so the next person knows it
was a decision.

## Define a minimal product brand

When no brand exists, write these five lines into DESIGN.md and use them:

```
Voice:       how we sound (e.g. "plain, calm, specific; we say what happened and what to do")
Reader:      how we address people (e.g. "you", never "the user"; sentence case)
Accent:      one oklch color and its role (primary action, selection, focus, done)
Type:        the UI family and, if any, one display face for rare headings
Icons:       the set, stroke weight and corner style
```

Pick the accent from the product's world when PRODUCT.md gives you one; otherwise a clear,
mid-chroma hue that passes AA on both themes. Avoid the AI-default looks listed in `craft.md`.

## Where brand may and may not appear

| Use | Allowed |
|---|---|
| The accent on the one primary action of a surface, the current selection, focus rings, completion marks | Yes |
| A few status marks that need attention (unread, now, today, drop target) | Yes, when the house allows |
| Brand color on navigation, toggles, priority labels or decoration | No |
| Brand illustration on first run and empty states | Yes, small and quiet |
| Gradients, glows, brand patterns behind content | No |
| The brand voice in copy | Everywhere, kept short |

## Done when

DESIGN.md names the voice, the reader form, the accent and its four roles, the type and the icon
set, each either traced to a brand source or marked as defined here.
