// A releases.json payload for tests (REL-4), in the release pipeline's format.
export const RELEASES_FIXTURE = {
  releases: [
    {
      version: "1.1.0",
      date: "2026-10-18",
      highlights: ["Chat keeps your place", "Tasks remember your view"],
      items: [
        { type: "new", text: "Chat keeps your place in every conversation." },
        { type: "improved", text: "Notes open faster." },
        { type: "fixed", text: "Calendar events keep their time after a clock change." },
        { type: "security", text: "Security and reliability improvements." },
        { type: "new", text: "Tasks remember the view you left." },
      ],
    },
    {
      version: "1.0.0",
      date: "2026-10-01",
      highlights: ["Moduo for web, Mac and Windows"],
      items: [{ type: "new", text: "Moduo for web, Mac and Windows." }],
    },
  ],
};
