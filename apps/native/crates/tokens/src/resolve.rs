//! Evaluating the tokens of one appearance: `var()`, `calc()`, colours, shadows and lists.

use std::collections::HashMap;

use crate::color::{self, Rgba};
use crate::export::{Calc, Expr};

/// Why a token has no value of its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unresolved {
    /// It reads itself through `var()`.
    Cycle,
    /// It reads a token nothing defines, with no fallback.
    Missing,
    /// A length in em, ch, lh or %: it needs the element that uses it.
    FontRelative,
    /// Kept as text by the export (`clamp()`, a gradient).
    Raw,
    /// A combination CSS itself would reject (a colour plus a length, say).
    Invalid,
}

/// One box shadow.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shadow {
    pub x: f32,
    pub y: f32,
    pub blur: f32,
    pub spread: f32,
    pub color: Rgba,
    pub inset: bool,
}

/// A token's value in one appearance.
#[derive(Clone, Debug, PartialEq)]
pub enum Value {
    Color(Rgba),
    /// Pixels (1rem = 16px).
    Length(f32),
    /// Milliseconds.
    Time(f32),
    Number(f32),
    Bezier([f32; 4]),
    Shadows(Vec<Shadow>),
    /// A font stack, or any list of names.
    Names(Vec<String>),
    Keyword(String),
    Unresolved(Unresolved),
}

/// Pixels in one rem: the web app never changes the root font size.
const REM: f32 = 16.0;

pub(crate) struct Evaluator<'a> {
    pub decls: HashMap<&'a str, &'a Expr>,
    pub done: HashMap<&'a str, Value>,
    visiting: Vec<&'a str>,
}

impl<'a> Evaluator<'a> {
    pub fn new(decls: HashMap<&'a str, &'a Expr>) -> Self {
        Self {
            decls,
            done: HashMap::new(),
            visiting: Vec::new(),
        }
    }

    pub fn token(&mut self, name: &'a str) -> Value {
        if let Some(v) = self.done.get(name) {
            return v.clone();
        }
        if self.visiting.contains(&name) {
            // Every token on the loop is part of the cycle, as in CSS.
            for t in self.visiting.iter().skip_while(|t| **t != name) {
                self.done.insert(t, Value::Unresolved(Unresolved::Cycle));
            }
            return Value::Unresolved(Unresolved::Cycle);
        }
        let Some(expr) = self.decls.get(name).copied() else {
            return Value::Unresolved(Unresolved::Missing);
        };
        self.visiting.push(name);
        let value = self.expr(expr);
        self.visiting.pop();
        // A token found to be on a cycle while its own value was worked out stays a cycle.
        let value = match self.done.get(name) {
            Some(Value::Unresolved(Unresolved::Cycle)) => Value::Unresolved(Unresolved::Cycle),
            _ => value,
        };
        self.done.insert(name, value.clone());
        value
    }

    fn expr(&mut self, expr: &'a Expr) -> Value {
        match expr {
            Expr::Num { num, unit } => number(*num, unit),
            Expr::Oklch {
                oklch: [l, c, h, a],
            } => Value::Color(color::oklch(*l, *c, *h, *a)),
            Expr::Rgb { rgb: [r, g, b, a] } => Value::Color(color::rgb(*r, *g, *b, *a)),
            Expr::Hsl { hsl: [h, s, l, a] } => Value::Color(color::hsl(*h, *s, *l, *a)),
            // A token that is missing or on a cycle is "guaranteed-invalid" in CSS: the fallback,
            // when there is one, takes its place.
            Expr::Var { var, fallback } => match (self.token(var), fallback) {
                (Value::Unresolved(u @ (Unresolved::Missing | Unresolved::Cycle)), f) => match f {
                    Some(f) => self.expr(f),
                    None => Value::Unresolved(u),
                },
                (v, _) => v,
            },
            Expr::Mix { mix } => {
                let (a, b) = (self.expr(&mix.a), self.expr(&mix.b));
                match (a, b) {
                    (Value::Color(a), Value::Color(b)) => {
                        color::mix(&mix.space, a, mix.pa, b, mix.pb)
                            .map_or(Value::Unresolved(Unresolved::Invalid), Value::Color)
                    }
                    (Value::Unresolved(u), _) | (_, Value::Unresolved(u)) => Value::Unresolved(u),
                    _ => Value::Unresolved(Unresolved::Invalid),
                }
            }
            Expr::Calc { calc } => self.calc(calc),
            Expr::Bezier { bezier } => Value::Bezier(*bezier),
            Expr::Keyword { keyword } if keyword == "transparent" => {
                Value::Color(Rgba::TRANSPARENT)
            }
            Expr::Keyword { keyword } => Value::Keyword(keyword.clone()),
            Expr::Word { word } => Value::Keyword(word.clone()),
            Expr::String { string } => Value::Names(vec![string.clone()]),
            Expr::List { list } if list.sep == "," => self.comma_list(&list.items),
            Expr::List { list } => self.space_list(&list.items),
            Expr::Raw { .. } => Value::Unresolved(Unresolved::Raw),
        }
    }

    fn calc(&mut self, calc: &'a Calc) -> Value {
        let (op, l, r) = match calc {
            Calc::Single(e) => return self.expr(e),
            Calc::Op { op, l, r } => (op.as_str(), self.expr(l), self.expr(r)),
        };
        use Value::{Length as L, Number as N, Time as T};
        match (op, l, r) {
            (_, Value::Unresolved(u), _) | (_, _, Value::Unresolved(u)) => Value::Unresolved(u),
            ("+", L(a), L(b)) => L(a + b),
            ("-", L(a), L(b)) => L(a - b),
            ("+", T(a), T(b)) => T(a + b),
            ("-", T(a), T(b)) => T(a - b),
            ("+", N(a), N(b)) => N(a + b),
            ("-", N(a), N(b)) => N(a - b),
            ("*", L(a), N(b)) | ("*", N(b), L(a)) => L(a * b),
            ("*", T(a), N(b)) | ("*", N(b), T(a)) => T(a * b),
            ("*", N(a), N(b)) => N(a * b),
            ("/", L(a), N(b)) if b != 0.0 => L(a / b),
            ("/", T(a), N(b)) if b != 0.0 => T(a / b),
            ("/", N(a), N(b)) if b != 0.0 => N(a / b),
            _ => Value::Unresolved(Unresolved::Invalid),
        }
    }

    /// "a, b, c": several shadows, or a font stack.
    fn comma_list(&mut self, items: &'a [Expr]) -> Value {
        let values: Vec<Value> = items.iter().map(|e| self.expr(e)).collect();
        if let Some(Value::Unresolved(u)) =
            values.iter().find(|v| matches!(v, Value::Unresolved(_)))
        {
            return Value::Unresolved(*u);
        }
        if values.iter().all(|v| matches!(v, Value::Shadows(_))) {
            return Value::Shadows(
                values
                    .into_iter()
                    .flat_map(|v| if let Value::Shadows(s) = v { s } else { vec![] })
                    .collect(),
            );
        }
        let mut names = Vec::new();
        for v in values {
            match v {
                Value::Names(n) => names.extend(n),
                Value::Keyword(k) => names.push(k),
                _ => return Value::Unresolved(Unresolved::Invalid),
            }
        }
        Value::Names(names)
    }

    /// "0 4px 12px rgb(0 0 0 / 0.45)": one shadow (the only space-separated list in the tokens).
    fn space_list(&mut self, items: &'a [Expr]) -> Value {
        let mut lengths = Vec::new();
        let mut color = None;
        let mut inset = false;
        for item in items {
            match self.expr(item) {
                Value::Length(px) => lengths.push(px),
                Value::Number(0.0) => lengths.push(0.0),
                Value::Color(c) => color = Some(c),
                Value::Keyword(k) if k == "inset" => inset = true,
                Value::Unresolved(u) => return Value::Unresolved(u),
                _ => return Value::Unresolved(Unresolved::Invalid),
            }
        }
        if !(2..=4).contains(&lengths.len()) {
            return Value::Unresolved(Unresolved::Invalid);
        }
        let at = |i: usize| lengths.get(i).copied().unwrap_or(0.0);
        Value::Shadows(vec![Shadow {
            x: at(0),
            y: at(1),
            blur: at(2),
            spread: at(3),
            // CSS: no colour means currentColor; the tokens always name one.
            color: color.unwrap_or(Rgba {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            }),
            inset,
        }])
    }
}

fn number(num: f32, unit: &str) -> Value {
    match unit {
        "" => Value::Number(num),
        "px" => Value::Length(num),
        "rem" => Value::Length(num * REM),
        "em" | "ch" | "lh" | "ex" | "%" | "vw" | "vh" => {
            Value::Unresolved(Unresolved::FontRelative)
        }
        "ms" => Value::Time(num),
        "s" => Value::Time(num * 1000.0),
        _ => Value::Unresolved(Unresolved::Invalid),
    }
}

#[cfg(test)]
mod tests {
    use crate::{Appearance, Tokens, Unresolved, Value};

    #[test]
    fn a_fallback_stands_in_for_a_cycle_as_in_css() {
        // Chromium: --a:var(--b); --b:var(--a); --e:var(--a) gives var(--a,4px) = 4px and
        // var(--e,5px) = 5px.
        let tokens = Tokens::from_json(
            r#"{"source":"t","layers":[{"when":[{}],"set":{
                "a":{"var":"b"},"b":{"var":"a"},"e":{"var":"a"},
                "f":{"var":"a","fallback":{"num":4,"unit":"px"}},
                "g":{"var":"e","fallback":{"num":5,"unit":"px"}}
            }}]}"#,
        )
        .unwrap();
        let r = tokens.resolve(&Appearance::default());
        assert_eq!(r.get("e"), Some(&Value::Unresolved(Unresolved::Cycle)));
        assert_eq!(r.px("f"), Some(4.0));
        assert_eq!(r.px("g"), Some(5.0));
    }
}
