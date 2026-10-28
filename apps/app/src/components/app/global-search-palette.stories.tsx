// GS-3 — ⌘K's states for the design review and the token lint
// (specs/global-search.md AC5, AC7, AC9): populated, empty query, no results,
// offline, long titles, a narrowed chip and the progress line. Messages and
// Conversations come from search_all too (GS-6). The rows are
// what search_all returns; "now" is pinned so the ages read the same.
import type { SearchAllRow } from "@contracts/search";
import type { Meta, StoryObj } from "@storybook/react";
import { FilePlus2, FileText, House, Settings as SettingsIcon } from "lucide-react";
import { useState } from "react";

import {
  buildPaletteView,
  chipForGroup,
  type PaletteChipKey,
  paletteChips,
} from "../../lib/palette-search";
import { GlobalSearchPalette, type GlobalSearchPaletteProps } from "./global-search-palette";

const NOW = new Date("2026-10-28T12:00:00Z");
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();
const ALL = { tasks: "edit", notes: "edit", contacts: "edit", calendar: "edit", chat: "edit" };

function hit(
  type: string,
  id: string,
  title: string,
  extra: Partial<SearchAllRow> = {},
): SearchAllRow {
  return {
    entity_type: type,
    entity_id: id,
    title,
    context: null,
    snippet: null,
    icon: null,
    match: "title",
    rank: 0.75,
    updated_at: ago(3),
    archived: false,
    score: 0.5,
    type_total: 1,
    top: false,
    ...extra,
  };
}

const PLANNING: SearchAllRow[] = [
  hit("note", "n1", "Q4 planning", {
    top: true,
    score: 0.82,
    type_total: 4,
    context: "Company / Strategy",
    updated_at: ago(1),
  }),
  hit("task", "t1", "Draft the planning doc", {
    type_total: 7,
    context: "Launch",
    updated_at: ago(5),
  }),
  hit("task", "t2", "Planning review with Ola", { type_total: 7, context: "Launch" }),
  hit("task", "t3", "Book the planning offsite", {
    type_total: 7,
    context: "Team",
    updated_at: ago(30),
  }),
  hit("task", "t4", "Planning retro", { type_total: 7 }),
  hit("bucket", "p1", "Planning 2027", { type_total: 1, archived: true, updated_at: ago(400) }),
  hit("note", "n2", "Weekly sync", {
    match: "body",
    rank: 0.4,
    type_total: 4,
    context: "… / Meetings / October",
    snippet: "agreed the planning calendar moves to Thursdays",
    updated_at: ago(26),
  }),
  hit("note", "n3", "Planning poker rules", { type_total: 4, updated_at: ago(200) }),
  hit("note", "n4", "Plans archive", {
    type_total: 4,
    archived: true,
    rank: 0.6,
    updated_at: ago(2000),
  }),
  hit("contact", "c1", "Ola Planning-Nowak", { type_total: 1, context: "Acme" }),
  hit("event", "e1", "Planning session", {
    type_total: 1,
    context: "Thu, Oct 30",
    updated_at: ago(48),
  }),
  hit("chat_message", "m1", "Ola Nowak", {
    match: "body",
    rank: 0.4,
    type_total: 2,
    context: "launch-room",
    snippet: "can we move the \uE000planning\uE001 call to after lunch?",
    updated_at: ago(2),
  }),
  hit("chat_message", "m2", "Bożena Wróbel", {
    match: "body",
    rank: 0.4,
    type_total: 2,
    context: "Ola Nowak",
    snippet: "sent you the \uE000planning\uE001 deck",
    updated_at: ago(20),
  }),
  hit("chat_channel", "ch1", "planning", { type_total: 1, updated_at: ago(4) }),
];

const ACTIONS = [
  { id: "notes", label: "Open Notes", icon: FileText, run: () => {} },
  { id: "home", label: "Open Home", icon: House, run: () => {} },
];
const ALL_ACTIONS = [
  { heading: "Navigate", actions: ACTIONS },
  {
    heading: "Notes",
    actions: [
      { id: "new-note", label: "New note", icon: FilePlus2, shortcut: "⌘N", run: () => {} },
    ],
  },
  {
    heading: "Workspace",
    actions: [
      { id: "settings", label: "Settings", icon: SettingsIcon, shortcut: "⌘,", run: () => {} },
    ],
  },
];

type Args = {
  query: string;
  rows: SearchAllRow[];
  chip?: PaletteChipKey;
  slow?: boolean;
  notice?: GlobalSearchPaletteProps["notice"];
  noResults?: boolean;
  actions?: GlobalSearchPaletteProps["actionGroups"];
};

function Harness({
  query: initial,
  rows,
  chip: initialChip = "all",
  slow = false,
  notice = null,
  noResults = false,
  actions = [],
}: Args) {
  const [query, setQuery] = useState(initial);
  const [chip, setChip] = useState<PaletteChipKey>(initialChip);
  const searching = query.trim().length >= 2;
  return (
    <GlobalSearchPalette
      open
      onOpenChange={() => {}}
      query={query}
      onQueryChange={setQuery}
      chips={paletteChips(ALL)}
      chip={chip}
      onChipChange={setChip}
      view={buildPaletteView(rows, { chip })}
      searching={searching}
      slow={slow}
      notice={notice}
      noResults={noResults}
      actionGroups={actions}
      onSeeAllInChat={() => {}}
      onOpenRow={() => {}}
      onShowAll={(group) => setChip(chipForGroup(group))}
      onSearchEverything={() => setChip("all")}
      taskIds={
        new Map([
          ["t1", "MOD-142"],
          ["t2", "MOD-87"],
          ["t3", "MOD-201"],
          ["t4", "MOD-12"],
        ])
      }
      now={NOW}
    />
  );
}

const meta: Meta<typeof Harness> = {
  title: "App/GlobalSearchPalette",
  component: Harness,
  parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** A Top result, then the groups in their fixed order, 3 rows each and Show all N. */
export const Populated: Story = { args: { query: "planning", rows: PLANNING } };

/** An empty ⌘K: the actions (Recent joins above them with GS-8). */
export const EmptyQuery: Story = { args: { query: "", rows: [], actions: ALL_ACTIONS } };

/** Nothing matched. */
export const NoResults: Story = { args: { query: "qwzx", rows: [], noResults: true } };

/** A chip narrows and nothing matched: "Search everything" brings All back. */
export const NoResultsInChip: Story = {
  args: { query: "qwzx", rows: [], chip: "notes", noResults: true },
};

/** Offline: one quiet line, the task found by its ID on this device, the actions. */
export const Offline: Story = {
  args: {
    query: "mod 142",
    rows: [
      hit("task", "t1", "Draft the planning doc", {
        match: "handle",
        rank: 1,
        score: 1,
        top: true,
      }),
    ],
    notice: "offline",
    actions: [],
  },
};

/** The server gave up after 5 s. */
export const TimedOut: Story = {
  args: { query: "a very long query", rows: [], notice: "timeout" },
};

/** A reply slower than 300 ms keeps the old rows and draws the thin line. */
export const Slow: Story = { args: { query: "plannin", rows: PLANNING, slow: true } };

/** The Tasks chip: its groups in full, no Top result. */
export const TasksChip: Story = { args: { query: "planning", rows: PLANNING, chip: "tasks" } };

/** Long titles, contexts and snippets truncate on one line each. */
export const LongTitles: Story = {
  args: {
    query: "quarterly",
    rows: [
      hit(
        "note",
        "l1",
        "Quarterly business review for the northern region including every subsidiary and partner",
        {
          top: true,
          context: "… / Finance and operations reporting 2026 / Regional quarterly reviews",
        },
      ),
      hit(
        "task",
        "l2",
        "Prepare the quarterly numbers for the board meeting and send the draft to everyone on the finance team",
        {
          context: "A project with a rather long name that keeps going",
        },
      ),
      hit("note", "l3", "Notes", {
        match: "body",
        rank: 0.4,
        snippet:
          "everything we discussed during the quarterly review, including the hiring plan, the budget, the roadmap and the long list of follow-ups",
        context: "Meetings",
      }),
    ],
  },
};
