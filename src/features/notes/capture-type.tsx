// Notes' capture type, provisional (SH-1): the one-line note ⌘⇧K already made
// with "/note", now picked with ⌘2 or the type chip instead (call 90b). Notes
// replaces it with its own body when the module is rebuilt.

import { FileText } from "lucide-react";

import { lineCaptureBody } from "../../components/app/capture-line";
import type { CaptureTypeDef } from "../../lib/capture-registry";
import { CAPTURE_ROUTES, canWriteRoute } from "../spine/capture-command";

const route = CAPTURE_ROUTES.find((r) => r.target === "note") ?? CAPTURE_ROUTES[0];

export const notesCaptureType: CaptureTypeDef = {
  type: "note",
  module: "notes",
  label: "Note",
  icon: FileText,
  destination: "Notes",
  canWrite: (perms) => canWriteRoute(route, perms),
  Body: lineCaptureBody({ target: "note", plural: "notes", placeholder: "Capture a note…" }),
};
