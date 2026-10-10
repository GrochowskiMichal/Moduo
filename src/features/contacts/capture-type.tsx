// Contacts' capture type, provisional (SH-1): the one-line contact ⌘⇧K already
// made with "/contact", now picked with its top-bar number or the type chip
// (call 90b). Contacts replaces it with its own body when the module is rebuilt.

import { Contact } from "lucide-react";

import { lineCaptureBody } from "../../components/app/capture-line";
import type { CaptureTypeDef } from "../../lib/capture-registry";
import { CAPTURE_ROUTES, canWriteRoute } from "../spine/capture-command";

const route = CAPTURE_ROUTES.find((r) => r.target === "contact") ?? CAPTURE_ROUTES[0];

export const contactsCaptureType: CaptureTypeDef = {
  type: "contact",
  module: "contacts",
  label: "Contact",
  icon: Contact,
  destination: "Contacts",
  canWrite: (perms) => canWriteRoute(route, perms),
  Body: lineCaptureBody({
    target: "contact",
    plural: "contacts",
    placeholder: "Capture a contact…",
  }),
};
