//! What decides which layers apply: the attributes the web app puts on `<html>`, the window's
//! size and the system's reduced-motion setting.

use std::collections::BTreeMap;

/// One appearance. Axes are the `data-*` attributes of the web app, by name without `data-`.
#[derive(Clone, Debug, PartialEq)]
pub struct Appearance {
    attrs: BTreeMap<String, String>,
    width: f32,
    height: f32,
    reduced_motion: bool,
}

impl Default for Appearance {
    /// The app's defaults (`tokens.css` header): dark, black, mono, comfortable, soft, Geist,
    /// motion as the system says, in the window the app opens at.
    fn default() -> Self {
        let attrs = [
            ("theme", "dark"),
            ("shade", "black"),
            ("accent", "mono"),
            ("density", "comfortable"),
            ("radius", "soft"),
            ("font", "geist"),
        ];
        Self {
            attrs: attrs
                .into_iter()
                .map(|(k, v)| (k.into(), v.into()))
                .collect(),
            width: 1280.0,
            height: 840.0,
            reduced_motion: false,
        }
    }
}

impl Appearance {
    /// Sets one axis, as `data-<axis>="<value>"` would.
    pub fn with(mut self, axis: &str, value: &str) -> Self {
        self.attrs.insert(axis.into(), value.into());
        self
    }

    /// Removes one axis, as an absent attribute.
    pub fn without(mut self, axis: &str) -> Self {
        self.attrs.remove(axis);
        self
    }

    /// No axis set at all.
    pub fn cleared(mut self) -> Self {
        self.attrs.clear();
        self
    }

    /// The window size, for the layers behind `min-width` and `max-height`.
    pub fn viewport(mut self, width: f32, height: f32) -> Self {
        self.width = width;
        self.height = height;
        self
    }

    /// The system's "reduce motion".
    pub fn prefers_reduced_motion(mut self, on: bool) -> Self {
        self.reduced_motion = on;
        self
    }

    pub fn attr(&self, axis: &str) -> Option<&str> {
        self.attrs.get(axis).map(String::as_str)
    }

    /// Whether a media feature holds. An unknown feature never does.
    pub(crate) fn media_holds(&self, feature: &str, value: &str) -> bool {
        let px = || value.trim_end_matches("px").parse::<f32>().ok();
        match feature {
            "prefers-reduced-motion" => (value == "reduce") == self.reduced_motion,
            "prefers-color-scheme" => {
                (value == "dark") == (self.attr("theme").unwrap_or("dark") != "light")
            }
            "min-width" => px().is_some_and(|v| self.width >= v),
            "max-width" => px().is_some_and(|v| self.width <= v),
            "min-height" => px().is_some_and(|v| self.height >= v),
            "max-height" => px().is_some_and(|v| self.height <= v),
            _ => false,
        }
    }
}
