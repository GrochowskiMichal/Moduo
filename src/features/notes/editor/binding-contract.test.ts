// NR-3 · the Lexical binding contract (spec assumption 1). Notes keeps
// `CollaborationPluginV2__EXPERIMENTAL` and the `root-v2` doc shape, so every
// stored note is a Yjs doc that only the experimental binding can read. Two
// guards make a Lexical bump safe:
//   - every lexical package is pinned to one exact version (no ranges), so an
//     install can't drift the binding underneath the app;
//   - a FROZEN doc built today must keep reading back as the same markdown.
//     When a bump changes how the binding maps stored docs, this fails before
//     any real note is misread.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "@rstest/core";
import * as Y from "yjs";
import { decodeBase64ToUint8 } from "../utils/base64";
import { GOLDEN_DOC_B64, GOLDEN_MD } from "./binding-contract.fixture";
import { deriveNoteBody, NOTES_DOC_ROOT } from "./doc-markdown";
import { buildDocStateFromMarkdown } from "./materialize";

const ROOT = resolve(__dirname, "../../../..");

function lexicalDeps(): Record<string, string> {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const all = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.fromEntries(
    Object.entries(all).filter(([name]) => name === "lexical" || name.startsWith("@lexical/")),
  );
}

function docOf(b64: string): Y.Doc {
  const doc = new Y.Doc();
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  Y.applyUpdate(doc, decodeBase64ToUint8(b64));
  return doc;
}

describe("Lexical version pin", () => {
  it("every lexical package is one exact version", () => {
    const deps = lexicalDeps();
    expect(Object.keys(deps)).toContain("lexical");
    expect(Object.keys(deps)).toContain("@lexical/yjs");
    for (const [name, range] of Object.entries(deps)) {
      expect({ name, range }).toEqual({ name, range: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    }
    expect(new Set(Object.values(deps)).size).toBe(1);
  });

  it("the installed packages are the pinned version", () => {
    const pinned = lexicalDeps().lexical;
    for (const name of ["lexical", "@lexical/yjs", "@lexical/markdown", "@lexical/react"]) {
      const installed = JSON.parse(
        readFileSync(resolve(ROOT, "node_modules", name, "package.json"), "utf8"),
      ) as { version: string };
      expect({ name, version: installed.version }).toEqual({ name, version: pinned });
    }
  });
});

describe("binding contract (stored docs read back unchanged)", () => {
  it("a frozen doc from an earlier build still reads as its markdown", () => {
    expect(deriveNoteBody(docOf(GOLDEN_DOC_B64)).md).toBe(GOLDEN_MD);
  });

  it("materialize → markdown is identical with today's build", () => {
    const built = buildDocStateFromMarkdown("binding-contract", GOLDEN_MD)!;
    expect(built.bodyMd).toBe(GOLDEN_MD);
    expect(deriveNoteBody(docOf(built.docStateB64)).md).toBe(GOLDEN_MD);
  });
});
