// The single registry of module-contract manifests
// (docs/moduo-module-contract.md). The Moduo MCP connector (Session 9)
// iterates this list; onboarding a module = adding its manifest here.

import { tasksModuleManifest } from "../features/tasks/ops-manifest";
import { linksModuleManifest } from "../features/spine/ops-manifest";
import type { ModuleManifest } from "./module-manifest";

export const moduleManifests: ModuleManifest[] = [tasksModuleManifest, linksModuleManifest];
