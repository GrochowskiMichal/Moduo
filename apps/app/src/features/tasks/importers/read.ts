// Which service an export file comes from, and its plan (TV-U18). The file
// is read here, in the app: nothing is sent anywhere before you press Import.
// A file too big, or one we don't recognise, says so plainly.

import { looksLikeAsana, readAsana } from "./asana";
import { parseCsvRows } from "./csv";
import { looksLikeJira, readJira } from "./jira";
import { looksLikeLinear, readLinear } from "./linear";
import { IMPORT_MAX_BYTES, type ImportPlan } from "./plan";
import { looksLikeTodoist, readTodoist } from "./todoist";
import { looksLikeTrello, readTrello } from "./trello";

export type ReadResult = { ok: true; plan: ImportPlan } | { ok: false; message: string };

const MB = 1024 * 1024;

/** A file's size against the limit, before reading it. */
export function sizeProblem(bytes: number): string | null {
  if (bytes <= IMPORT_MAX_BYTES) return null;
  return `This file is ${(bytes / MB).toFixed(1)} MB. Moduo reads export files up to ${IMPORT_MAX_BYTES / MB} MB: export one project or board at a time.`;
}

export function readImportText(
  name: string,
  text: string,
  opts: { zone: string; now?: Date },
): ReadResult {
  const sized = sizeProblem(new Blob([text]).size);
  if (sized) return { ok: false, message: sized };
  const trimmed = text.trimStart().replace(/^﻿/, "");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let data: unknown;
    try {
      data = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        message: "This JSON file can't be read. Export the board again from Trello.",
      };
    }
    if (looksLikeTrello(data)) return done(readTrello(data, name, opts.zone));
    return {
      ok: false,
      message: "This JSON isn't a Trello board export. Moduo reads Trello's board JSON.",
    };
  }
  const header = (parseCsvRows(trimmed.split(/\r?\n/, 1)[0] ?? "")[0] ?? []).map((h) => h.trim());
  if (looksLikeTodoist(header)) return done(readTodoist(trimmed, name, opts.now));
  if (looksLikeLinear(header)) return done(readLinear(trimmed, name));
  if (looksLikeJira(header)) return done(readJira(trimmed, name));
  if (looksLikeAsana(header)) return done(readAsana(trimmed, name));
  return {
    ok: false,
    message:
      "We don't recognise this file. Moduo reads Todoist and Asana project CSVs, Trello board JSON, and Linear and Jira issue CSVs.",
  };
}

function done(plan: ImportPlan): ReadResult {
  if (plan.projects.length === 0) {
    return { ok: false, message: "There are no tasks in this file to bring in." };
  }
  return { ok: true, plan };
}
