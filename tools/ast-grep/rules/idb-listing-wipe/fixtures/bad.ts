// Pre-fix shape: the listing is the only source of names.
export async function wipe() {
  // @flag
  const list = (await indexedDB.databases?.()) ?? [];
  await Promise.all(list.map((db) => deleteDb(db.name)));
}
