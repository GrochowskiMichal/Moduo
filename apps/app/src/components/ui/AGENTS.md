# src/components/ui/ (loads when an agent works in this folder)

Design-system primitives with no domain knowledge. Read [docs/DESIGN_RULES.md](../../../docs/DESIGN_RULES.md) and [docs/gotchas/ui.md](../../../docs/gotchas/ui.md) first.

- **Primitives wrap shadcn** wherever shadcn has the component (Dialog, Dropdown, Popover, Command, Tabs, Tooltip, Sheet, Toast, Switch, Select, RadioGroup, Separator, Card, ScrollArea, Avatar, Badge, ContextMenu). Add it with the shadcn CLI; never roll your own.
- **Every new primitive ships a Storybook story** next to it: `<name>.stories.tsx`.
- **Tokens only.** Values come from `src/styles/tokens.css` through Tailwind utilities or `var(--token)`. To change a value, edit the token, never the component. No raw hex, no arbitrary Tailwind values for color, spacing, radius or font, no inline-style design properties. The `guard-design-tokens.sh` hook and CI enforce this.
- **Every interactive element** has default, hover, focus, active, disabled, loading and error states, and an accessible label.
- Run the `moduo-design-quality` skill (`audit` or `polish`) on changed primitives before reporting done.
