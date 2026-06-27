import { Contact } from "lucide-react";

import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { EmptyState } from "../../components/ui/empty-state";

/**
 * Contacts (light CRM) — page scaffold (specs/contacts.md block CO-1, AC10).
 *
 * This is the rename destination of the throwaway `/crm` route, composing the
 * standard 3-pane `FeaturePanelsShell` under the `"contacts"` layout key. The
 * directory rail + the auto-rollup ContactHub (the "great moment") land in block
 * CO-2; until then the center shows the empty teaching state so the route is
 * real (no blank canvas) without faking data.
 */
export function ContactsPage() {
  return (
    <FeaturePanelsShell
      feature="contacts"
      center={
        <EmptyState
          icon={Contact}
          title="Your contacts live here"
          description="People and companies whose pages stay current automatically — every linked email, task, note and payment rolls up onto them. Import or add one to begin."
        />
      }
    />
  );
}
