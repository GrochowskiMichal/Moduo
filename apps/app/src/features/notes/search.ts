// /notes URL search params (Wave-3 NO-3, mirrors contacts FX-1). Selection is
// URL-held so reload/back/forward and `moduo:entity:open` deep links work;
// `action` carries the palette's / global-capture "new note" intent.

export type NotesSearch = {
  id?: string;
  action?: "new";
};

export function validateNotesSearch(search: Record<string, unknown>): NotesSearch {
  const id = typeof search.id === "string" && search.id.length > 0 ? search.id : undefined;
  const action = search.action === "new" ? search.action : undefined;
  return {
    ...(id ? { id } : {}),
    ...(action ? { action } : {}),
  };
}
