// Chat's right-panel views (lib/panel-registry.ts). The module is registered
// by CV-8a so the panel's toggle and title row know Chat; its views (Details,
// Reply chains, Pinned, Files…) are registered by CV-8b and the blocks after it.

import type { PanelViewDef } from "../../lib/panel-registry";

export const chatPanelViews: readonly PanelViewDef[] = [];
