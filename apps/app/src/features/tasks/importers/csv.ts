// A CSV reader for the native importers (TV-U18): RFC 4180 with the habits
// of real exports — a byte-order mark, CRLF or LF, quoted fields that hold
// commas, doubled quotes and line breaks (Jira's descriptions and comments),
// trailing blank lines, and the same header written more than once (Jira's
// "Labels", "Comment" and "Sprint" columns). Header names are matched without
// case or surrounding spaces; every column is kept, repeats included.

export type CsvTable = {
  /** The header row, as written. */
  header: string[];
  /** Every data row, padded or cut to the header's width. */
  rows: string[][];
};

/** Split CSV text into rows of fields. A blank line is dropped. */
export function parseCsvRows(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(field);
    field = "";
    // A line with one empty field is a blank line.
    if (!(row.length === 1 && row[0] === "")) rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"' && field === "") {
      quoted = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\r" || c === "\n") {
      endRow();
      i += c === "\r" && src[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += c;
    i += 1;
  }
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Read a CSV file with a header row. */
export function parseCsv(text: string): CsvTable {
  const all = parseCsvRows(text);
  const header = (all[0] ?? []).map((h) => h.trim());
  const rows = all.slice(1).map((r) => {
    if (r.length === header.length) return r;
    if (r.length > header.length) return r.slice(0, header.length);
    return [...r, ...Array<string>(header.length - r.length).fill("")];
  });
  return { header, rows };
}

const norm = (name: string) => name.trim().toLowerCase();

/** Reads a table's rows by header name (any case). */
export type CsvColumns = {
  /** Whether the header has this column. */
  has(name: string): boolean;
  /** The first column of that name in a row, trimmed ("" when absent). */
  get(row: string[], name: string): string;
  /** Every non-empty value of the columns of that name (Jira's repeats). */
  all(row: string[], name: string): string[];
};

export function csvColumns(header: string[]): CsvColumns {
  const at = new Map<string, number[]>();
  header.forEach((h, i) => {
    const key = norm(h);
    at.set(key, [...(at.get(key) ?? []), i]);
  });
  return {
    has: (name) => at.has(norm(name)),
    get: (row, name) => {
      const i = at.get(norm(name))?.[0];
      return i === undefined ? "" : (row[i] ?? "").trim();
    },
    all: (row, name) =>
      (at.get(norm(name)) ?? []).map((i) => (row[i] ?? "").trim()).filter((v) => v !== ""),
  };
}

/** Whether a header carries all these columns (any case). */
export function headerHas(header: string[], names: readonly string[]): boolean {
  const set = new Set(header.map(norm));
  return names.every((n) => set.has(norm(n)));
}
