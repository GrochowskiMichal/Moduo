---
paths: ["**/*.test.ts", "**/*.test.tsx", "supabase/tests/**", "supabase/probes/**", "e2e/**"]
incident: "Two fake 32-hex tokens in test fixtures (NS-5 publish_token, CALR-19 offer token) failed CI's PR-wide gitleaks scan; the offer token blocked the develop sync (PR #742), 2026-10-28"
expires: 2027-01-31
---

# Token-shaped values in test fixtures

- A fake token, key or secret in a fixture is a readable word, never random hex or base64: `publish_token: "publish-token-fixture"`, not `"0f64b653891cb81ef8f293f866e85bf4"`. gitleaks' `generic-api-key` rule flags a high-entropy value next to a key-like name.
- CI scans every commit in the PR, so fixing the value in a later commit does not clear it: a pushed hit needs a fingerprint line in `.gitleaksignore` (`<commit>:<path>:<rule>:<line>`, with a comment naming the block). Get the value right before the first push.
- When the code checks a token's shape (length, hex alphabet), build it from a repeated pattern (`"ab".repeat(16)`), which is low entropy.
