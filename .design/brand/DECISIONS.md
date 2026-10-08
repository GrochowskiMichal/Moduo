# Brand decisions

Numbered decisions from the 2026-10-08 brand grilling session. The numbers match the questions asked, and [BRAND_BRIEF.md](./BRAND_BRIEF.md) cites them in brackets. Maciej decides every brand question (79). An item stays open (❓) until he answers it. Later changes are added as dated lines under the item they change, so the numbers stay stable.

## A. What the brandbook is
1. **Readers:** Maciej, Mike, and coding agents. Written as rules an agent can follow; a public press page comes separately (66).
2. **Form:** `.design/brand/BRAND_BRIEF.md` + this file now; a rendered brand page once the masters exist. Not Figma-first.
3. **Scope:** everything outside the app. Inside the app, only the logo, the app icon, the AI dot and the voice. App UI stays under DESIGN_SYSTEM / DESIGN_RULES / tokens.css.
4. **The product is the brand.** No brand hue, display face or illustration that the app doesn't have.
5. **One brand.** Sub-products are "Moduo <Thing>" in plain text, with no own marks.

## B. Name
6. "Moduo" in running text, titles, legal and subjects. Never MODUO, "Moduo App" or "Moduo AI".
7. Lowercase "moduo" only inside the logo artwork.
8. **The name story ("mod + duo, sharing the d") is not official.** It stays as landing content on the footer plate and isn't repeated in press, About or the app.
9. **Pronunciation: "mo + duo", stress on *du***, said however your language says "duo". English *mo-DOO-oh*; Polish "moduo"/"moduou" ("modziuou" is the *dyoo* way of saying duo, also right); Japanese **モデュオ**. Never *MOJ-oo-oh* in our own material, but nobody gets corrected. (Confirmed 2026-10-08.)
10. Handles `moduo_app` where renaming is possible; display name "Moduo".

## C. The mark
11. The mark's design is kept; **Maciej is perfecting the SVG** (it isn't final yet). Construction rules and the 2026-10-08 measurement are in the brief §3.
12. **Meaning:** three identical pieces interlock into an m; **the empty space created by the overlap symbolizes the connection between modules.** Press kit only.
13. A small-size master (opened windows) for ≤24px, drawn by Maciej.
14. Colours: Paper on black, Ink on white, currentColor in the app. Never a hue, gradient, outline, shadow or glow.
15. Tile only for the app icon, favicon and avatars; free-standing everywhere else.
16. **The wireframe extruded mark ("Depth 14") is a landing one-off. Not reused anywhere.**
17. Mark alone = everyday signature; lockup = first contact (landing nav, emails, OG, decks, press).

## D. Wordmark
18. **Wordmark = A, the drawn letters**, frozen as outlines. Not final: Maciej will redraw it to what he wants. The Geist-typed stand-ins get replaced by the artwork.
19. Wordmark alone only where the mark is already large nearby.

## E. Lockups, clear space, sizes, misuse
20. Horizontal lockup is the only one produced. Stacked is defined but **not produced** (Maciej can't see a use yet).
21. The master lockup file's proportions are the single spec, for now. They will follow the master when Maciej redraws it.
22. Clear space: one "o" height around the lockup; a quarter of the mark height around the mark.
23. Minimums: lockup 72px wide on screen (the mark inside is ≈16px at that size); mark 16px, small master at ≤24px.
24. Backgrounds: black, off-black, white or neutral; photos only over calm dark areas; never on a hue.
25. Misuse list as in brief §5. All banned.
26. Co-branding: lockup, hairline, partner logo at equal optical height. No "×".

## F. App icon, favicon, avatars
27. App icon stays a white mark on a near-black tile.
28. Liquid Glass modes already work. Re-check only when the mark master changes.
29. The icon never follows the user's accent.
30. Same opaque black-tile favicon on the landing and the web app.
31. Staging gets an inverted favicon (white tile, black mark).
32. Default profile picture = initials on a neutral circle. The Expo placeholders are deleted.
33. Sender avatar for hello@moduo.app: Paper mark on black, mark at ~55% for the circle crop.
34. Social avatars use the same file family. Personal accounts keep personal photos.
35. Social banners: black, small lockup, brand line. No screenshots until the app UI is final.

## G. Colour
36. Brand colours = the app's neutral system. No brand hue.
37. Two named blacks: **Canvas** (pure black: landing, OG, social, decks) and **Reading** (oklch 0.2: legal, manifesto, dark email).
38. Paper (#fafafa) for type and mark on black; pure white only for light pages and emails.
39. Black is the brand's home; light is an equal-quality secondary expression.
40. **Pink is not a brand colour. "Absolutely not."** Maciej doesn't know how pink got into the code; it shouldn't be there.
    ❓ **Scope to confirm:** 42–44 keep a pink AI dot, while pink also lives in the Settings accent list, the tag-label colours and the landing's accent demo. **Recommended:** pink exists *only* as the AI dot. Remove it from the accent picker (7 accents left), from tag labels (existing pink tags → violet) and from the landing.
41. Hues, status colours and theme shades never appear as marketing chrome; only inside screenshots, which always show the default look.

## H. AI dot
42. Kept, with one meaning: "an assistant was here". Homes: the connected-assistants status in Settings and assistant-made changes in activity/history.
43. A small solid dot: no glow, gradient or loop; at most one fade-in on connect; always with a label.
44. Its own fixed `--ai` token, independent of accent and theme.
45. Never with the logo, in the icon, in emails or in marketing chrome.
46. "Your assistant" or the tool's name. Never "Moduo AI".

## I. Typography
47. Geist is the only face, brand included. No display face.
48. Weights 400/500/600; 300 only for display lines ≥22px in marketing and email; never 700.
49. **Pilat Extended is removed from Settings → Font.** The picker and the other faces stay (Pilat users → Geist).
50. Geist Mono for codes, shortcuts and IDs only.
51. Tracking: hero −0.035em, section −0.02em, lockup-style text −0.015em, body 0.
52. Email: Geist where it loads, system sans elsewhere; the logo is an image.

## J. Motion
53. "Things arrive, they don't perform": the app's fade + micro-blur, ≤320ms, no bounce, sparkle or glow, reduced motion honoured.
54. **The logo animation is the reveal from nothing** (Maciej's concept): the mark's overlaps cancel, so with all three strokes in one place the logo is invisible; the side strokes then move apart and the mark reveals itself. Spec in the brief §10; prototyped 2026-10-08. "Overlap cancels, separation reveals" is the motion idea for future animated symbols (loading or other uses; none designed yet).
55. Plays once per app launch while the session loads, as the first frame of videos, and on the landing hero on a first visit. Never on route changes, never looped.
56. The footer plate's construction-draw animation is landing and press only.
57. No brand sound.
58. Demo videos at real speed, visible cursor, no zoom-punch, reveal at the start only.

## K. Voice and tone
59. Plain, calm, direct.
60. "We" = Maciej and Mike, "you" = reader; the UI never says "I"; personal notes signed "Maciej & Mike".
61. Brand line **"One window for the whole working life."**; campaign line **"Fire ten apps. Keep the work."**; drop "The last productivity app you'll ever set up."
62. Name categories, not competitors, except on comparison and import pages.
63. Dry, rare humour; never in errors, billing or deletion; no exclamation marks, no emoji.
64. Banned words as in brief §11, including graph/database/object type/relations.
65. American English everywhere.

## L–M. Imagery and applications
66. **Press kit: build it now or soon. Don't wait for release.** Screenshots join once the app UI is final.
67. The product is the only picture. No stock, 3D, abstract or AI-generated imagery.
68. People: only real people with consent (founders).
69. No illustration in v1; if ever needed, line drawings on the mark's diagonal geometry, monochrome.
70. Diagrams: hairlines and dots in Paper and grey.
71. One recurring example cast (brief §11).
72. `og.png` becomes the OG template, one per page.
73. One booking badge: "Scheduled with Moduo" + mark.
74. Emails use the lockup as a 2×/3× PNG image; the email plan's four changes are listed in the brief §13.
75. **Boilerplate has no location.** Mike isn't from Kraków, and the founders move to Japan before release. **Chat is added to the module list:** email, tasks, notes, calendar, contacts, chat.

## N. Ownership and next steps
76. Old logo files and Expo leftovers are deleted from `assets/` once replacements exist.
77. Maciej approves changes to the mark, wordmark, colour and voice; agents never edit masters.
78. This is a plan only. Building happens as BRAND-0…6 (brief §16); BRAND-1 first, because the email build needs its logo PNG.
79. **Maciej makes all brand decisions.** None need Mike.
