<!--
  See CONTRIBUTING.md for the branch model and testing gates.
  Delete sections that don't apply.
-->

## Summary

<!-- 1–3 bullets. What changed and why. -->

## Testing gate

Target: <!-- task → personal | personal → develop | develop → main -->

- [ ] `bun run typecheck` clean
- [ ] `bun run lint:tw` clean on files touched
- [ ] `bun run lint:css` clean on files touched
- [ ] Walked the happy path on `bun run dev:desktop`

For **personal → develop** PRs, also:

- [ ] Adjacent / regressed surfaces checked manually
- [ ] Storybook renders for any new / changed primitives without console errors
- [ ] Visual snapshot suite green (or new PNG committed intentionally)

For **develop → main** PRs, also:

- [ ] Full walkthrough on a fresh vault
- [ ] Full walkthrough on an existing vault (migration check)
- [ ] CHANGELOG entry written
- [ ] Both devs signed off

## Notes

<!-- Screenshots, Loom, breaking changes, follow-ups. -->
