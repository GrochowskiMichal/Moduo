# Mail, improved: prototype source

The design for [specs/mail-improve.md](../../../specs/mail-improve.md): **[Mail, improved](https://claude.ai/artifact/UkqArK5YNviQ2wfosdwpdH)** (/product-studio improve, 2026-11-07). Blind critics scored 7.7 in round 3 (bar 8.0); Mail as built scored 7.0 under the same jury.

- `prototype.src.html`: the whole page (prototype, Why and Score tabs), fictional data only. Font data is left as placeholders (`__G400__` and so on).
- `build.py`: `python3 build.py prototype.src.html out.html` inlines Geist from base64 files in a sibling `fonts/` folder (not committed: Geist is OFL, take it from the `geist` package).
- Open with `?critic=1` to see only the product surface. The state switcher lists 56 states; `window.studio.set(id)` renders one.

The prototype is the reference for visuals, copy and keyboard behaviour. Where it and the spec disagree, the spec wins (it follows the house rules, e.g. focus rings without offset).
