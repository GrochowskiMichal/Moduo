//! The 4px spacing scale the web app uses through Tailwind (`docs/DESIGN_RULES.md`: "spacing is
//! the 4px scale only"): `sp(2.)` is `p-2`, 8px. It does not change with density; the density
//! tokens (`--pad-x`, `--ctrl-h`, `--row-h`) are what do.

use gpui_kit::{px, Pixels};

/// One Tailwind step (`--spacing: 0.25rem`).
const STEP: f32 = 4.0; // design-literal: Tailwind's --spacing, which the web app keeps

/// `steps` × 4px.
pub fn sp(steps: f32) -> Pixels {
    px(steps * STEP)
}
