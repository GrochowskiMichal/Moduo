/**
 * The markdown fidelity fixture (NR-3, AC9): every construct the spec names,
 * in the exact bytes the one converter writes. Shared by the dialect tests and
 * the binding contract test.
 */

/** Every construct AC9 names, in the exact bytes the converter writes. */
export const FIDELITY_MD = [
  "# Plan",
  "",
  "Intro with **bold**, *italic*, ***both***, ~~struck~~, `code` and a [link](https://example.com/a).",
  "A second line inside the same block.",
  "",
  "## Steps",
  "",
  "- first",
  "- second",
  "",
  "1. one",
  "2. two",
  "",
  "- [x] done thing",
  "- [ ] open thing",
  "",
  "- [ ] Ship the report <!-- moduo:task:task-123 -->",
  "",
  "Talked to [Jane Doe](moduo://contact/abc-123) today.",
  "",
  "| Name | Status |",
  "| --- | --- |",
  "| Acme | **Active** |",
  "| Globex | [site](https://globex.test) |",
  "",
  "[Kickoff notes](moduo://note/n-1)",
].join("\n");
