// /contacts URL search params (fix pack FX-1). Shared between the route
// definition (validateSearch) and the page (useSearch) without creating a
// route-tree <-> page import cycle. Selection is URL-held (AC1); `action`
// carries the palette's "New contact" / "Import contacts" intents (AC2).

export type ContactsSearch = {
  type?: "contact" | "company";
  id?: string;
  action?: "new" | "import";
};

/** Parse + drop anything malformed; a bare id (or bare type) is no selection. */
export function validateContactsSearch(search: Record<string, unknown>): ContactsSearch {
  const type = search.type === "contact" || search.type === "company" ? search.type : undefined;
  const id = typeof search.id === "string" && search.id.length > 0 ? search.id : undefined;
  const action = search.action === "new" || search.action === "import" ? search.action : undefined;
  return {
    ...(type && id ? { type, id } : {}),
    ...(action ? { action } : {}),
  };
}
