//! The faces the app draws text with: Geist and Geist Mono, at the weights it uses
//! (`apps/app/src/global.css` loads the same for the web app). OFL, `assets/fonts/OFL.txt`.
//! Geist covers Polish and the rest of Latin Extended, so the web app's Inter fallback for those
//! letters is not needed here (`tests/text.rs` checks it).

use std::borrow::Cow;

use gpui_kit::App;

macro_rules! face {
    ($name:literal) => {
        (
            $name,
            include_bytes!(concat!("../../../assets/fonts/", $name, ".ttf")) as &[u8],
        )
    };
}

/// The families the faces belong to, the default first.
pub const FAMILIES: [&str; 2] = ["Geist", "Geist Mono"];

/// Every bundled face, by file name.
pub static FACES: &[(&str, &[u8])] = &[
    face!("Geist-Regular"),
    face!("Geist-Medium"),
    face!("Geist-SemiBold"),
    face!("Geist-Bold"),
    face!("GeistMono-Regular"),
    face!("GeistMono-Medium"),
];

/// Hands every face to GPUI's text system. Call once, before the first window draws.
pub fn load(cx: &mut App) {
    let faces = FACES
        .iter()
        .map(|(_, bytes)| Cow::Borrowed(*bytes))
        .collect();
    cx.text_system()
        .add_fonts(faces)
        .expect("the bundled fonts load");
}
