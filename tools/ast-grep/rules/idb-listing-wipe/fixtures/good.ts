// Fixed: names come from the records; a listing (injected) only adds to them.
export async function wipe(records: NoteState[], listing?: () => Promise<IDBDatabaseInfo[]>) {
  const names = new Set(records.map((r) => docDbName(r.owner, r.noteId)));
  for (const db of (await listing?.()) ?? []) if (db.name) names.add(db.name);
  await Promise.all([...names].map(deleteDb));
}
