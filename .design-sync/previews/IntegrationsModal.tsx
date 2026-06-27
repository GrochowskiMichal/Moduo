// Owned preview: the repo's story renders <IntegrationsModal /> with no args, so
// `visible` is undefined and the Dialog stays closed (empty render). Open it so
// the card shows the real modal. Component is redirected to window.ModuoDS via
// the story-imports fork; the decorator chain supplies Auth/Workspace/Tooltip.
import * as React from "react";
import { IntegrationsModal } from "@/components/integrations-modal";

export function Primary() {
  return <IntegrationsModal visible onClose={() => {}} />;
}
