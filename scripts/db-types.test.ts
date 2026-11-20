import { nullableRpcArgs } from "./db-types";

describe("nullableRpcArgs", () => {
  it("makes every Args member nullable, inline and multi-line", () => {
    const src = [
      "a: { Args: { p_id: string; p_note?: string }; Returns: Json }",
      "b: {",
      "  Args: {",
      "    p_ids?: string[]",
      '    p_kind: Database["public"]["Enums"]["kind"]',
      "  }",
      "  Returns: { id: string }[]",
      "}",
    ].join("\n");
    const out = nullableRpcArgs(src);
    expect(out).toContain("Args: { p_id: string | null; p_note?: string | null }; Returns: Json }");
    expect(out).toContain("p_ids?: string[] | null\n");
    expect(out).toContain('p_kind: Database["public"]["Enums"]["kind"] | null\n');
    expect(out).toContain("Returns: { id: string }[]");
  });

  it("handles overload unions and leaves never / already-nullable alone", () => {
    const src =
      "f: { Args: | { p_a: string } | { p_b: number | null }; Returns: Json }\ng: { Args: never; Returns: Json }";
    const out = nullableRpcArgs(src);
    expect(out).toContain("Args: | { p_a: string | null } | { p_b: number | null }; Returns");
    expect(out).toContain("g: { Args: never; Returns: Json }");
  });
});
