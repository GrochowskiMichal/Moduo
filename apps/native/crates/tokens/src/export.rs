//! The shape of `tokens.json`, as `scripts/native/export-tokens.ts` writes it.

use std::collections::BTreeMap;

use serde::Deserialize;

#[derive(Debug, Deserialize)]
pub struct Export {
    pub layers: Vec<Layer>,
}

/// One CSS rule: it applies when any `when` alternative matches and every `media` feature holds.
#[derive(Debug, Deserialize)]
pub struct Layer {
    pub when: Vec<BTreeMap<String, AxisTest>>,
    #[serde(default)]
    pub media: BTreeMap<String, String>,
    pub set: BTreeMap<String, Expr>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum AxisTest {
    /// Not this value (or the attribute is absent).
    Not { not: String },
    /// "*" means the attribute is present; anything else, equal to it.
    Is(String),
}

#[derive(Debug, Deserialize)]
pub struct Mix {
    pub space: String,
    pub a: Box<Expr>,
    pub pa: Option<f32>,
    pub b: Box<Expr>,
    pub pb: Option<f32>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Calc {
    Op {
        op: String,
        l: Box<Expr>,
        r: Box<Expr>,
    },
    Single(Box<Expr>),
}

#[derive(Debug, Deserialize)]
pub struct List {
    pub sep: String,
    pub items: Vec<Expr>,
}

/// A value, never evaluated by the export: the resolver does that per appearance.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum Expr {
    Num {
        num: f32,
        unit: String,
    },
    Oklch {
        oklch: [f32; 4],
    },
    Rgb {
        rgb: [f32; 4],
    },
    Hsl {
        hsl: [f32; 4],
    },
    Var {
        var: String,
        fallback: Option<Box<Expr>>,
    },
    Mix {
        mix: Mix,
    },
    Calc {
        calc: Calc,
    },
    Bezier {
        bezier: [f32; 4],
    },
    Keyword {
        keyword: String,
    },
    Word {
        word: String,
    },
    String {
        string: String,
    },
    List {
        list: List,
    },
    Raw {
        #[allow(dead_code)] // the export keeps the text; nothing reads it yet
        raw: String,
    },
}

impl Expr {
    /// Every token this expression reads, directly.
    pub fn refs<'a>(&'a self, out: &mut Vec<&'a str>) {
        match self {
            Expr::Var { var, fallback } => {
                out.push(var);
                if let Some(f) = fallback {
                    f.refs(out);
                }
            }
            Expr::Mix { mix } => {
                mix.a.refs(out);
                mix.b.refs(out);
            }
            Expr::Calc {
                calc: Calc::Op { l, r, .. },
            } => {
                l.refs(out);
                r.refs(out);
            }
            Expr::Calc {
                calc: Calc::Single(e),
            } => e.refs(out),
            Expr::List { list } => list.items.iter().for_each(|e| e.refs(out)),
            _ => {}
        }
    }
}
