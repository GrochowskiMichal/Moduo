// Owned preview: open the modal (the repo story leaves `visible` undefined, so
// the Dialog is closed and renders empty). See IntegrationsModal preview.
import * as React from "react";
import { WorkspaceSettingsModal } from "@/components/workspace-settings-modal";

export function Primary() {
  return <WorkspaceSettingsModal visible onClose={() => {}} />;
}
