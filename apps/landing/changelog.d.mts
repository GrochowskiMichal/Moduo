export type ChangelogRelease = {
  version: string;
  date: string;
  highlights?: string[];
  items?: { type: string; text: string }[];
};
export function changelogReleases(data: unknown): ChangelogRelease[];
export function renderChangelogMain(data: unknown): string;
export function renderChangelogPage(template: string, data: unknown): string;
