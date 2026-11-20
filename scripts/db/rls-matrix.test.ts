import {
  generateFromDisk,
  parseMatrix,
  renderOp,
  renderTable,
  stale,
  testId,
  TESTS_DIR,
} from "./rls-matrix";

const md = (table: string) => `# Matrix

## World

\`\`\`sql world
SELECT 1;
\`\`\`

${table}

## Equivalent mutants

| mutant | why |
| --- | --- |
| \`t: p USING true\` | It can't matter. |

## RPC probe

| function | as | why |
| --- | --- | --- |
| \`fn_a\` | member | By design. |
`;

const PERSONA_ROWS = [
  "owner",
  "admin",
  "editor",
  "viewer",
  "capped",
  "member",
  "outsider",
  "anon",
  "app",
];

const table = (cells: string, ops = "```sql select\nSELECT 1 FROM t WHERE id = {T}\n```") =>
  `## Table: t\n\n${ops}\n\n| persona | select |\n| --- | --- |\n${cells}`;

const rows = (mark: (who: string) => string) =>
  PERSONA_ROWS.map((p) => `| ${p} | ${mark(p)} |`).join("\n");

describe("testId", () => {
  it("is _setup.sql's md5('db-test:' || name)::uuid", () => {
    // SELECT md5('db-test:W')::uuid
    expect(testId("W")).toBe("f661759c-6b7f-ac9d-8cea-4ec4d4cb4445");
  });
});

describe("renderOp", () => {
  it("swaps each {Name} for its fixture id and leaves auth.uid() alone", () => {
    expect(renderOp("SELECT 1 WHERE id = {W} AND by = auth.uid()")).toBe(
      "SELECT 1 WHERE id = 'f661759c-6b7f-ac9d-8cea-4ec4d4cb4445'::uuid AND by = auth.uid()",
    );
  });
});

describe("parseMatrix", () => {
  it("reads the world, a table's ops and cells, the equivalent mutants and the RPC allow list", () => {
    const m = parseMatrix(md(table(rows((p) => (p === "owner" ? "✓" : p === "app" ? "–" : "✗")))));
    expect(m.world).toBe("SELECT 1;");
    expect(m.tables).toHaveLength(1);
    expect(m.tables[0].ops.get("select")).toEqual({
      sql: "SELECT 1 FROM t WHERE id = {T}",
      rlsAlone: false,
    });
    expect(m.tables[0].cells.get("owner")?.get("select")).toBe("allow");
    expect(m.tables[0].cells.get("member")?.get("select")).toBe("deny");
    expect(m.tables[0].cells.get("app")?.get("select")).toBe("skip");
    expect(m.equivalent).toEqual([{ id: "t: p USING true", why: "It can't matter." }]);
    expect(m.rpcAllow).toEqual([{ fn: "fn_a", as: "member", why: "By design." }]);
  });

  it("marks an rls-alone operation", () => {
    const m = parseMatrix(
      md(
        table(
          rows(() => "✗"),
          "```sql select rls-alone\nSELECT 1\n```",
        ),
      ),
    );
    expect(m.tables[0].ops.get("select")?.rlsAlone).toBe(true);
  });

  it("refuses a missing persona row", () => {
    const cells = rows(() => "✗")
      .split("\n")
      .slice(0, -1)
      .join("\n");
    expect(() => parseMatrix(md(table(cells)))).toThrow(/no row for app/);
  });

  it("refuses a cell that isn't ✓, ✗ or –", () => {
    expect(() => parseMatrix(md(table(rows((p) => (p === "viewer" ? "yes" : "✗")))))).toThrow(
      /viewer is "yes"/,
    );
  });

  it("refuses a column without its sql block, and a block without its column", () => {
    expect(() =>
      parseMatrix(
        md(
          table(
            rows(() => "✗"),
            "```sql read\nSELECT 1\n```",
          ),
        ),
      ),
    ).toThrow(/column select with no sql select block/);
  });

  it("refuses a markdown without a world", () => {
    expect(() =>
      parseMatrix(md(table(rows(() => "✗"))).replace("```sql world", "```sql other")),
    ).toThrow(/no ```sql world block/);
  });
});

describe("the not-reached list", () => {
  it("reads the names in the ```text unreached block", () => {
    const text = `${md(table(rows(() => "✗")))}\n## Not reached by the probe\n\n\`\`\`text unreached\nfn_a\nfn_b\n\`\`\`\n`;
    expect(parseMatrix(text).unreached).toEqual(["fn_a", "fn_b"]);
  });
});

describe("renderTable", () => {
  it("checks each op once without RLS, then every persona with a mark, skipping –", () => {
    const m = parseMatrix(md(table(rows((p) => (p === "owner" ? "✓" : p === "app" ? "–" : "✗")))));
    const sql = renderTable(m.tables[0]);
    expect(sql).toContain("\\ir _rls_matrix.sql");
    expect(sql).toContain("test.mx_cell('t', 'select', 'sys', true,");
    expect(sql).toContain("test.mx_cell('t', 'select', 'owner', true,");
    expect(sql).toContain("test.mx_cell('t', 'select', 'anon', false,");
    expect(sql).not.toContain("'app'");
  });

  it("passes rls_alone for an rls-alone op", () => {
    const m = parseMatrix(
      md(
        table(
          rows(() => "✗"),
          "```sql select rls-alone\nSELECT 1\n```",
        ),
      ),
    );
    expect(renderTable(m.tables[0])).toContain("$op$SELECT 1$op$, true);");
  });
});

describe("the committed matrix", () => {
  it("covers ten tables, and its generated files match rls_matrix.md (else: bun run db:matrix)", () => {
    const files = generateFromDisk();
    const tables = [...files.keys()].filter(
      (f) => /^rls_matrix_.*\.test\.sql$/.test(f) && f !== "rls_matrix_rpcs.test.sql",
    );
    expect(tables).toHaveLength(10);
    expect(stale(TESTS_DIR, files)).toEqual([]);
  });
});
