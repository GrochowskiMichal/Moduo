import { DashboardPage } from "../../features/dashboard/ui/dashboard-page";

/**
 * The `/` route — Moduo's Home. A thin wrapper: the app gate already resolves
 * auth + workspace before any page mounts, so Home renders the dashboard surface
 * full-bleed with no extra guard (contrast the retired GridPage, which pre-loaded
 * notes for the legacy widget set). Data + persistence arrive with DB-4/DB-5.
 */
export function HomePage() {
  return <DashboardPage />;
}
