//! Moduo's design tokens.
//!
//! `tokens.json` is written by `bun run native:tokens` from `apps/app/src/styles/tokens.css`,
//! the one source of every design value; `bun run verify` fails when it is stale. The resolver
//! that turns it into colours and sizes per appearance comes next (specs/native-foundation.md,
//! NF-4).

/// The exported tokens, as written by `scripts/native/export-tokens.ts`.
pub const TOKENS_JSON: &str = include_str!("../tokens.json");

#[cfg(test)]
mod tests {
    #[test]
    fn the_export_is_embedded() {
        assert!(super::TOKENS_JSON.contains("\"layers\""));
    }
}
