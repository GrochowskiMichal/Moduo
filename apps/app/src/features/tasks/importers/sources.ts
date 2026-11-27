// Which services an import reads, and how a task's "imported from" reads
// (TV-U18). Kept apart from the import plan (plan.ts) so a task's panel can
// name its source without the importer joining the first-load bundle.

export type ImportSource = "todoist" | "trello" | "linear" | "jira" | "asana";

/** The services, in the order call 35 names them. */
export const IMPORT_SOURCES: ReadonlyArray<{
  id: ImportSource;
  label: string;
  /** What to export there, in a few words. */
  file: string;
  accept: string;
}> = [
  { id: "todoist", label: "Todoist", file: "a project exported as CSV", accept: ".csv" },
  { id: "trello", label: "Trello", file: "a board exported as JSON", accept: ".json" },
  { id: "linear", label: "Linear", file: "issues exported as CSV", accept: ".csv" },
  { id: "jira", label: "Jira", file: "issues exported as CSV (all fields)", accept: ".csv" },
  { id: "asana", label: "Asana", file: "a project exported as CSV", accept: ".csv" },
];

export const sourceLabel = (id: ImportSource) =>
  IMPORT_SOURCES.find((s) => s.id === id)?.label ?? id;

/**
 * How a task's "imported from" reads (the panel's ⋯): the service and the
 * source's own id, which is copied as is and found by search. Todoist's CSV
 * has no ids, so its keys are ours and aren't shown.
 */
export function importedFromLine(
  from: { source: string; key: string } | null | undefined,
): { label: string; key: string | null } | null {
  if (!from?.source) return null;
  const known = IMPORT_SOURCES.find((s) => s.id === from.source.toLowerCase());
  const service = known?.label ?? from.source.charAt(0).toUpperCase() + from.source.slice(1);
  const ours = from.key.startsWith("todoist-");
  return { label: `Imported from ${service}`, key: ours || !from.key ? null : from.key };
}
