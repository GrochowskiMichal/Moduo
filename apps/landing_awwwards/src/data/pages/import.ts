// /import: the import guide. Every step and limit is the shipped dialogs' (surveyed 27 October
// 2026): notes/ui/note-import-dialog.tsx and notes/import*.ts (Markdown .zip or .md files; Notion's
// zip-in-zip and multi-part exports; CSVs and images skipped and counted; folders become parent
// notes; a re-run finds what is there), tasks/importers (Todoist and Asana CSV, Trello JSON,
// Linear and Jira CSV; 10 MB, 2,000 tasks, 20 comments a task; the preview's statuses and people;
// "Your imports" with "Undo this import"), contacts import (CSV columns, New, Merge, Duplicate,
// Skipped; matched by email, then name and company) and the MCP server's imports tools (runs an
// assistant makes are listed and undone the same way). Competitors are named here on purpose:
// brand decision 62 allows it on import pages.

export const importGuide = {
  title: "Import guide: Notion, Todoist, Trello, CSV and more",
  description:
    "Move into Moduo: notes from Notion or Markdown, tasks from Todoist, Trello, Linear, Jira or Asana, contacts from a CSV, with a preview before anything is saved.",
  name: "Import",
  line: "Bring the work over. Leave the apps.",
  lead: "Notes from Notion or Markdown, tasks from Todoist, Trello, Linear, Jira or Asana, contacts from a spreadsheet. Every import shows you what will happen before anything is saved.",
  cta: { label: "See every integration", href: "/integrations" },

  move: {
    title: "Folders become notes.",
    text: "Drop in a Notion export as it comes. Every page lands as a note, and every folder becomes the note its pages sit under.",
    label:
      "A Notion export on the left, Moduo's note tree on the right: the folders Open alpha and Design become parent notes with their pages under them, Writing rules becomes a note, and a CSV table and an image are skipped.",
    file: "Export-Moduo.zip",
    // [depth, kind, name, index of the note it becomes, or -1 when it's skipped]
    from: [
      [0, "folder", "Open alpha", 0],
      [1, "file", "Invite copy.md", 1],
      [1, "file", "First wave list.md", 2],
      [1, "sheet", "Waitlist.csv", -1],
      [0, "folder", "Design", 3],
      [1, "file", "Oudom kerning.md", 4],
      [1, "image", "mark-v3.png", -1],
      [0, "file", "Writing rules.md", 5],
    ] as [number, "folder" | "file" | "sheet" | "image", string, number][],
    // [depth, name, has pages under it]
    to: [
      [0, "Open alpha", true],
      [1, "Invite copy", false],
      [1, "First wave list", false],
      [0, "Design", true],
      [1, "Oudom kerning", false],
      [0, "Writing rules", false],
    ] as [number, string, boolean][],
    exportLabel: "Your export",
    notesLabel: "Notes in Moduo",
    skipped: "Skipped",
    becomes: "becomes",
    summary: "6 notes to import · 2 skipped.",
    button: "Import",
  },

  preview: {
    title: "Nothing is saved until you say so.",
    text: "A task import reads the file on your computer, then asks where each list belongs and who each person is. Every run is listed afterwards, with its own undo.",
    label:
      "Moduo's Import tasks dialog: a Trello board of 48 tasks, its four lists matched to Backlog, To do, In progress and Done, two people in the file matched to Maciej Grzywacz and Mike Grochowski, finished tasks included, and below, Your imports with an Undo button on each run.",
    dialog: "Import tasks",
    from: "From Trello · Moduo board.json",
    line: "48 tasks, 1 project, 0 skipped",
    statuses: "Each list becomes a status. Check where it belongs:",
    lists: [
      ["Backlog", "Backlog"],
      ["This week", "To do"],
      ["Doing", "In progress"],
      ["Done", "Done"],
    ],
    people: "People in the file. Pick who each one is here:",
    who: [
      ["Maciej G.", "Maciej Grzywacz", "var(--ap-violet)", "MA"],
      ["mike", "Mike Grochowski", "var(--ap-pink)", "MI"],
    ],
    finished: "Include finished tasks (12)",
    back: "Choose another file",
    go: "Import 48 tasks",
    runs: "Your imports",
    history: [
      ["Trello · Design board", "Oct 27 · 31 tasks"],
      ["Todoist · Releases", "Oct 20 · 23 tasks · through an app"],
    ],
    undo: "Undo this import",
  },

  guides: {
    title: "Step by step.",
    items: [
      {
        id: "notes",
        name: "Notes",
        from: "From Notion or Markdown",
        steps: [
          {
            title: "Export as Markdown",
            text: "In Notion, export a page or the whole workspace and pick Markdown & CSV. Any folder of .md files works too.",
          },
          {
            title: "Open Import notes",
            text: "In Moduo, open Notes and choose Import notes at the foot of the sidebar.",
          },
          {
            title: "Drop the file in, as it is",
            text: "A .zip, a zip inside a zip, an export in several parts, or loose .md files.",
          },
          {
            title: "Check the tree and import",
            text: "The preview shows every note under its parent and counts what it will skip. Then import.",
          },
        ],
        notes: [
          "Notion’s tables arrive as CSV files and images as files of their own: both are skipped and counted in the summary.",
          "Run the same export again and nothing is duplicated.",
          "A notes import can’t be undone, so the preview is your check.",
        ],
      },
      {
        id: "tasks",
        name: "Tasks",
        from: "From Todoist, Trello, Linear, Jira or Asana",
        steps: [
          {
            title: "Export from the app you’re leaving",
            text: "Todoist: a project as CSV. Trello: a board as JSON. Linear: issues as CSV. Jira: issues as CSV with all fields. Asana: a project as CSV.",
          },
          {
            title: "Open Import tasks",
            text: "In Moduo, open Tasks, then the sidebar’s ⋯ menu, and choose Import tasks.",
          },
          {
            title: "Drop the file in",
            text: "It’s read on your computer, and nothing is saved until you press Import.",
          },
          {
            title: "Match lists and people",
            text: "Say where each list or state belongs, pick who each person in the file is, and choose whether finished tasks come too.",
          },
          {
            title: "Import, and undo if you need to",
            text: "Your imports lists every run, each with Undo this import.",
          },
        ],
        notes: [
          "Up to 10 MB and 2,000 tasks a run, subtasks included.",
          "The 20 most recent comments on each task come along.",
          "Import the same file again and the tasks it brought are updated, not copied.",
        ],
      },
      {
        id: "contacts",
        name: "Contacts",
        from: "From a spreadsheet",
        steps: [
          {
            title: "Save it as CSV",
            text: "Any spreadsheet app can: one row a person, one column a field.",
          },
          {
            title: "Open Import contacts",
            text: "In Moduo, open Contacts and choose Import contacts in the toolbar.",
          },
          {
            title: "Match the columns",
            text: "Name, or first and last name, email, phone, title, company and status. Leave out any column you don’t want.",
          },
          {
            title: "Check every row and import",
            text: "The preview marks each row New, Merge, Duplicate or Skipped. People are matched by email first, then by name and company.",
          },
        ],
        notes: [
          "A contacts import can’t be undone, so read the preview’s marks before you import.",
        ],
      },
      {
        id: "assistant",
        name: "Through your assistant",
        from: "From anywhere it can read",
        steps: [
          {
            title: "Connect it",
            text: "Add Moduo to Claude or ChatGPT as a connector and give its key Edit on Tasks.",
          },
          {
            title: "Ask for the move",
            text: "Point it at the list you’re leaving and ask it to bring the tasks over.",
          },
          {
            title: "Keep or undo",
            text: "The run shows in Your imports, marked as made through an app, with the same Undo.",
          },
        ],
        notes: [
          "Your assistant reaches only what its key allows, and every task it makes carries its name.",
        ],
      },
    ],
    stepLabel: "Step",
    noteLabel: "Good to know",
  },

  questions: [
    {
      q: "Can I bring my Notion tables?",
      a: "Pages come across as notes. Notion exports its tables as CSV files, which the notes import skips and counts, so you see exactly what stayed behind.",
    },
    {
      q: "Is my file uploaded before I import?",
      a: "A task export is read on your computer, and nothing is saved until you press Import. Then the tasks are created in your workspace like any other.",
    },
    {
      q: "What if I import the same thing twice?",
      a: "Nothing doubles. Notes already brought in are found again, and tasks from an earlier run are updated in place.",
    },
    {
      q: "Which Notion export should I pick?",
      a: "Markdown & CSV. The notes import reads Markdown, so anything else in the file is skipped and counted. Try one page first if you want to see how it lands.",
    },
  ],
} as const;
