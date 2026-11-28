//! The tokens the app draws with right now. NF-7 makes the appearance switchable; until then it is
//! the default appearance.

use gpui_kit::{App, Global};
use moduo_tokens::{Appearance, Resolved, Tokens};

/// The resolved tokens of the current appearance.
pub struct ActiveTokens(pub Resolved);

impl Global for ActiveTokens {}

pub(crate) fn init(cx: &mut App) {
    cx.set_global(ActiveTokens(Tokens::load().resolve(&Appearance::default())));
}
