---
paths: ["apps/app/src/components/ui/**"]
incident: "Hand-rolled primitives and raw values drifted from the token system (2026-10-07, Harness v2 added guard-design-tokens.sh)"
expires: 2027-01-31
---

# UI primitives (apps/app/src/components/ui/)

Design-system primitives with no domain knowledge. Read [docs/DESIGN_RULES.md](../../docs/DESIGN_RULES.md) and [docs/gotchas/ui.md](../../docs/gotchas/ui.md) first.

- **Primitives wrap shadcn** wherever shadcn has the component (Dialog, Dropdown, Popover, Command, Tabs, Tooltip, Sheet, Toast, Switch, Select, RadioGroup, Separator, Card, ScrollArea, Avatar, Badge, ContextMenu). Add it with the shadcn CLI; never roll your own.
- **Every new primitive ships a Storybook story** next to it: `<name>.stories.tsx`.
- **Tokens only.** Values come from `apps/app/src/styles/tokens.css` through Tailwind utilities or `var(--token)`. To change a value, edit the token, never the component. No raw hex, no arbitrary Tailwind values for color, spacing, radius or font, no inline-style design properties. The `guard-design-tokens.sh` hook and CI enforce this.
- **Every interactive element** has default, hover, focus, active, disabled, loading and error states, and an accessible label.
- Run the `moduo-design-quality` skill (`audit` or `polish`) on changed primitives before reporting done.
