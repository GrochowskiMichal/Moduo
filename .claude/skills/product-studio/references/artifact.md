# The artifact: one page, three tabs

The studio's only deliverable. It has to hold up as the best thing in the room: someone who opens
the link without context should understand the module, try it, and see why it is this way. Load
the built-in artifact-design skill before writing it; its page contract (title, theming tokens, size,
libraries) applies on top of this file.

## Layout

A slim top bar with the module's name, the intent and three tabs. The first tab opens by default.

| Tab | `improve` and `rethink` | `criticise` |
|---|---|---|
| **Prototype** / **Current** | The interactive module at full width, in the product's own window chrome (a sidebar and top bar like the real app, drawn with house tokens). A small state switcher in the corner lists every declared state, so a reader can jump to empty, error, dense and so on. A "keys" button shows the keyboard map. | The module as it is today: the lab's frames of each state, each with numbered pins on the holes. Clicking a pin opens the hole. |
| **Why** | The concept card. The holes found in the current module, each marked closed or open with the change that closed it. The comparison with best-in-class products and the patterns taken, each with its source link. Anything marked "needs the designer". Token additions proposed, if any. | The holes, ranked, with severity, category, evidence frame and the suggested fix move. The comparison with best-in-class products. What the evidence couldn't show. |
| **Score** | The round table (overall, categories, gates, severity-3 findings per round), the final scorecard, the calibration status, and the critics' one-sentence reading of the idea. | The scorecard from the baseline jury. |

A short footer names the two next steps (turn into spec, another critic round) as plain text: an
artifact can't run them, so the chat's closing question carries the buttons.

## Critic mode

With `?critic=1` in the URL, the page renders only the Prototype tab's surface: no top bar, tabs,
state switcher, keys button or footer. The renderer always opens the page this way, so critics
judge the module, never the rationale. Check it yourself before the first render.

```js
const critic = new URLSearchParams(location.search).has("critic");
```

## Building it

- One self-contained HTML file. Inline CSS and JS; libraries only from the CDNs the
  built-in artifact-design skill allows, pinned to exact versions.
- **House tokens for the module, page tokens for the frame.** The module uses the project's tokens
  under their own names and values. The tabs and rationale use a small set of page tokens built
  from the same palette, so the whole page reads as one product.
- **Theme.** The product's primary theme is the page's default. When the house defines a second
  theme, the page follows the built-in artifact-design skill's light and dark rules with the house's
  values for both.
- **Images.** Frames of this product's own seeded data may be embedded (the `criticise` tab and
  before/after pairs). Convert them to JPEG and cap the width first, for example
  `sips -s format jpeg -s formatOptions 80 -Z 1600 in.png --out out.jpg`, and embed at most a
  dozen. Never embed another product's screenshots or a designer's shot: link to them.
- **Size.** Stay well under the artifact's size limit; a prototype with its data should be a few
  hundred kilobytes before images.
- **Title.** Two to four words, such as "Notes, refined" or "Tasks critique". The description is
  one sentence on what changed and the final score.
- **Icon** on first publish: a plain generic word for the module (`notes`, `tasks`, `calendar`).
