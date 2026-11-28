//! The app's embedded assets, served to GPUI ahead of the component library's own icons.

use std::borrow::Cow;

use gpui_kit::{AssetSource, Result, SharedString};

include!(concat!(env!("OUT_DIR"), "/embedded.rs"));

/// One embedded file, by the path GPUI asks for (`icons/bell.svg`, `brand/moduo-mark.svg`).
pub fn embedded(path: &str) -> Option<&'static [u8]> {
    EMBEDDED
        .iter()
        .find(|(p, _)| *p == path)
        .map(|(_, bytes)| *bytes)
}

/// Moduo's assets first, then the kit's (its components draw their own icons).
pub struct Assets;

impl AssetSource for Assets {
    fn load(&self, path: &str) -> Result<Option<Cow<'static, [u8]>>> {
        match embedded(path) {
            Some(bytes) => Ok(Some(Cow::Borrowed(bytes))),
            None => gpui_kit::assets::Assets.load(path),
        }
    }

    fn list(&self, path: &str) -> Result<Vec<SharedString>> {
        let mut out: Vec<SharedString> = EMBEDDED
            .iter()
            .filter(|(p, _)| p.starts_with(path))
            .map(|(p, _)| SharedString::from(*p))
            .collect();
        for kit in gpui_kit::assets::Assets.list(path)? {
            if !out.contains(&kit) {
                out.push(kit);
            }
        }
        Ok(out)
    }
}
