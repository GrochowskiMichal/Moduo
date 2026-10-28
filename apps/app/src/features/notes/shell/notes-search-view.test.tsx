// GS-2: Notes' sidebar search draws the server's SearchHit rows (notes__search):
// the snippet's marked words, the note's parent path, and nothing for a hit the
// title search already shows.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";

import { NotesSearchView, type NoteTextHit } from "./notes-search-view";

afterEach(cleanup);

const hit = (over: Partial<NoteTextHit> & { id: string }): NoteTextHit => ({
  title: "Retro",
  icon: null,
  context: null,
  snippet: null,
  match: "body",
  ...over,
});

function renderSearch(query: string, hits: NoteTextHit[]) {
  return render(
    <TooltipProvider>
      <NotesSearchView
        notes={[]}
        query={query}
        onQueryChange={() => {}}
        searchText={() => Promise.resolve(hits)}
        selectedId={null}
        onOpen={() => {}}
        onClose={() => {}}
      />
    </TooltipProvider>,
  );
}

describe("NotesSearchView reads notes__search hits", () => {
  it("marks the matched words of the server's snippet and shows where the note lives", async () => {
    renderSearch("kumquat", [
      hit({
        id: "n1",
        context: "… / Planning / Quarterly review",
        snippet: "We tasted a kumquat at lunch",
      }),
    ]);
    const group = await screen.findByRole("region", { name: "In the text" }, { timeout: 2000 });
    const mark = within(group).getByText("kumquat");
    expect(mark.tagName).toBe("MARK");
    expect(group.textContent).toContain("We tasted a kumquat at lunch");
    expect(group.textContent).not.toMatch(/[]/);
    expect(within(group).getByText("… / Planning / Quarterly review")).toBeTruthy();
  });

  it("lists a fuzzy title hit under the text hits, without a snippet", async () => {
    renderSearch("meetng", [hit({ id: "n2", title: "Weekly meeting notes", match: "title_fuzzy" })]);
    const group = await screen.findByRole("region", { name: "In the text" }, { timeout: 2000 });
    expect(within(group).getByText("Weekly meeting notes")).toBeTruthy();
    expect(group.querySelector("mark")).toBeNull();
  });
});
