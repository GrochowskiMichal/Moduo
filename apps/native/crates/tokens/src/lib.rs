//! Moduo's design tokens, for the native app.
//!
//! `tokens.json` is written by `bun run native:tokens` from `apps/app/src/styles/tokens.css`, the
//! one source of every design value; `bun run verify` fails when it is stale. [`Tokens::resolve`]
//! layers it for one [`Appearance`] exactly as the browser's cascade does (the export refuses a
//! file where source order would not decide) and evaluates every value. `tests/golden.rs` holds
//! the result to what Chromium computes; after a `tokens.css` change, run `bun run native:tokens`
//! and then `bun run native:golden` to refresh both files.

mod appearance;
mod color;
mod export;
mod resolve;

use std::collections::{BTreeSet, HashMap};

pub use appearance::Appearance;
pub use color::Rgba;
pub use resolve::{Shadow, Unresolved, Value};

use export::{AxisTest, Export, Layer};
use resolve::Evaluator;

include!(concat!(env!("OUT_DIR"), "/token.rs"));

/// A token, named by the generated [`Token`] (checked when the app compiles) or by its text.
pub trait TokenName {
    fn token_name(&self) -> &str;
}

impl TokenName for Token {
    fn token_name(&self) -> &str {
        self.name()
    }
}

impl TokenName for str {
    fn token_name(&self) -> &str {
        self
    }
}

impl TokenName for String {
    fn token_name(&self) -> &str {
        self
    }
}

impl<T: TokenName + ?Sized> TokenName for &T {
    fn token_name(&self) -> &str {
        (**self).token_name()
    }
}

/// The exported tokens, as written by `scripts/native/export-tokens.ts`.
pub const TOKENS_JSON: &str = include_str!("../tokens.json");

/// The parsed export. Cheap to resolve again whenever the appearance changes.
#[derive(Debug)]
pub struct Tokens {
    layers: Vec<Layer>,
    names: BTreeSet<String>,
}

impl Tokens {
    /// Moduo's tokens. Panics only if the committed export does not parse, which its tests rule out.
    pub fn load() -> Self {
        Self::from_json(TOKENS_JSON).expect("tokens.json parses")
    }

    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        let export: Export = serde_json::from_str(json)?;
        let names = export
            .layers
            .iter()
            .flat_map(|l| l.set.keys().cloned())
            .collect();
        Ok(Self {
            layers: export.layers,
            names,
        })
    }

    /// Every token name, sorted.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.names.iter().map(String::as_str)
    }

    /// The tokens one appearance axis can change: those a layer conditioned on it sets, and every
    /// token that reads one of them.
    pub fn affected_by(&self, axis: &str) -> BTreeSet<&str> {
        let mut out: BTreeSet<&str> = self
            .layers
            .iter()
            .filter(|l| l.when.iter().any(|w| w.contains_key(axis)) || mentions_media(l, axis))
            .flat_map(|l| l.set.keys().map(String::as_str))
            .collect();
        loop {
            let before = out.len();
            for layer in &self.layers {
                for (name, expr) in &layer.set {
                    let mut refs = Vec::new();
                    expr.refs(&mut refs);
                    if refs.iter().any(|r| out.contains(r)) {
                        out.insert(name);
                    }
                }
            }
            if out.len() == before {
                return out;
            }
        }
    }

    /// Every token's value in one appearance.
    pub fn resolve(&self, appearance: &Appearance) -> Resolved {
        let mut decls = HashMap::new();
        for layer in self.layers.iter().filter(|l| applies(l, appearance)) {
            for (name, expr) in &layer.set {
                decls.insert(name.as_str(), expr);
            }
        }
        let mut evaluator = Evaluator::new(decls);
        let values = self
            .names()
            .map(|n| (n.to_owned(), evaluator.token(n)))
            .collect();
        Resolved { values }
    }
}

/// `motion` also decides the reduced-motion media layer (`:root:not([data-motion="full"])`).
fn mentions_media(layer: &Layer, axis: &str) -> bool {
    axis == "motion" && layer.media.contains_key("prefers-reduced-motion")
}

fn applies(layer: &Layer, appearance: &Appearance) -> bool {
    let media = layer
        .media
        .iter()
        .all(|(f, v)| appearance.media_holds(f, v));
    let when = layer.when.iter().any(|alternative| {
        alternative
            .iter()
            .all(|(axis, test)| match (test, appearance.attr(axis)) {
                (AxisTest::Is(v), Some(a)) => v == "*" || v == a,
                (AxisTest::Is(_), None) => false,
                (AxisTest::Not { not }, a) => a != Some(not.as_str()),
            })
    });
    media && when
}

/// The tokens of one appearance.
#[derive(Clone, Debug, PartialEq)]
pub struct Resolved {
    values: HashMap<String, Value>,
}

impl Resolved {
    pub fn get(&self, name: impl TokenName) -> Option<&Value> {
        self.values.get(name.token_name())
    }

    /// A colour, clipped to sRGB, ready to draw.
    pub fn color(&self, name: impl TokenName) -> Option<Rgba> {
        match self.get(name)? {
            Value::Color(c) => Some(c.clipped()),
            _ => None,
        }
    }

    /// A length in pixels. A unitless 0 counts, as in CSS.
    pub fn px(&self, name: impl TokenName) -> Option<f32> {
        match self.get(name)? {
            Value::Length(px) => Some(*px),
            Value::Number(n) if *n == 0.0 => Some(0.0),
            _ => None,
        }
    }

    /// A duration in milliseconds.
    pub fn ms(&self, name: impl TokenName) -> Option<f32> {
        match self.get(name)? {
            Value::Time(ms) => Some(*ms),
            _ => None,
        }
    }

    pub fn number(&self, name: impl TokenName) -> Option<f32> {
        match self.get(name)? {
            Value::Number(n) => Some(*n),
            _ => None,
        }
    }

    pub fn bezier(&self, name: impl TokenName) -> Option<[f32; 4]> {
        match self.get(name)? {
            Value::Bezier(b) => Some(*b),
            _ => None,
        }
    }

    pub fn shadows(&self, name: impl TokenName) -> Option<&[Shadow]> {
        match self.get(name)? {
            Value::Shadows(s) => Some(s),
            _ => None,
        }
    }

    /// A font stack, first choice first.
    pub fn fonts(&self, name: impl TokenName) -> Option<Vec<&str>> {
        match self.get(name)? {
            Value::Names(n) => Some(n.iter().map(String::as_str).collect()),
            Value::Keyword(k) => Some(vec![k.as_str()]),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Appearance, Token, Tokens};

    #[test]
    fn the_export_is_embedded_and_parses() {
        let tokens = Tokens::load();
        assert!(tokens.names().count() > 200);
        assert_eq!(Token::ALL.len(), tokens.names().count());
    }

    #[test]
    fn a_token_is_named_by_the_generated_enum() {
        let resolved = Tokens::load().resolve(&Appearance::default());
        assert_eq!(Token::CtrlHSm.name(), "ctrl-h-sm");
        assert_eq!(resolved.color(Token::Primary), resolved.color("primary"));
        assert_eq!(resolved.px(Token::RowH), Some(36.0));
        assert_eq!(resolved.number(Token::ZPopover), Some(70.0));
    }
}
