import { describe, expect, it } from "@rstest/core";
import * as Y from "yjs";

/**
 * AC6 — concurrent edits merge without any conflict UI. Two clients edit the
 * same note apart (offline), exchange updates in BOTH orders, and converge to
 * one state containing both edits, byte-stable in each direction.
 */

function makeDocWithParagraph(text: string): Y.Doc {
  const doc = new Y.Doc();
  const root = doc.get("root-v2", Y.XmlElement);
  const p = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  root.insert(0, [p]);
  return doc;
}

function textOf(doc: Y.Doc): string {
  return doc.get("root-v2", Y.XmlElement).toString();
}

describe("concurrent CRDT merge (AC6)", () => {
  it("two divergent edits converge to the same state in both merge orders", () => {
    // A shared origin both clients start from
    const origin = makeDocWithParagraph("hello");
    const base = Y.encodeStateAsUpdate(origin);

    const alice = new Y.Doc();
    alice.get("root-v2", Y.XmlElement);
    Y.applyUpdate(alice, base);
    const bob = new Y.Doc();
    bob.get("root-v2", Y.XmlElement);
    Y.applyUpdate(bob, base);

    // Divergent offline edits
    const aliceP = new Y.XmlElement("paragraph");
    const aliceT = new Y.XmlText();
    aliceT.insert(0, "alice was here");
    aliceP.insert(0, [aliceT]);
    alice.get("root-v2", Y.XmlElement).push([aliceP]);

    const bobP = new Y.XmlElement("paragraph");
    const bobT = new Y.XmlText();
    bobT.insert(0, "bob was here");
    bobP.insert(0, [bobT]);
    bob.get("root-v2", Y.XmlElement).push([bobP]);

    const aliceUpdate = Y.encodeStateAsUpdate(alice);
    const bobUpdate = Y.encodeStateAsUpdate(bob);

    // Merge in both directions
    Y.applyUpdate(alice, bobUpdate);
    Y.applyUpdate(bob, aliceUpdate);

    const aliceText = textOf(alice);
    expect(aliceText).toContain("hello");
    expect(aliceText).toContain("alice was here");
    expect(aliceText).toContain("bob was here");

    // Byte-stable: both replicas encode to the identical state vector + doc
    expect(Y.encodeStateAsUpdate(alice)).toEqual(Y.encodeStateAsUpdate(bob));
    expect(textOf(bob)).toBe(aliceText);
  });

  it("replaying the same update twice is a no-op (outbox retry safety)", () => {
    const doc = makeDocWithParagraph("once");
    const before = Y.encodeStateAsUpdate(doc);
    const echo = Y.encodeStateAsUpdate(doc);
    Y.applyUpdate(doc, echo);
    Y.applyUpdate(doc, echo);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(textOf(doc)).toContain("once");
    // exactly one paragraph — the replay didn't duplicate content
    expect(textOf(doc).match(/<paragraph>/g)).toHaveLength(1);
  });

  it("a stale replica syncing week-old edits merges losslessly", () => {
    const live = makeDocWithParagraph("current work");
    const stale = new Y.Doc();
    stale.get("root-v2", Y.XmlElement);
    // The stale device never saw "current work"; it wrote its own paragraph
    const p = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, "week-old thought");
    p.insert(0, [t]);
    stale.get("root-v2", Y.XmlElement).push([p]);

    Y.applyUpdate(live, Y.encodeStateAsUpdate(stale));
    Y.applyUpdate(stale, Y.encodeStateAsUpdate(live));

    expect(textOf(live)).toBe(textOf(stale));
    expect(textOf(live)).toContain("current work");
    expect(textOf(live)).toContain("week-old thought");
  });
});
