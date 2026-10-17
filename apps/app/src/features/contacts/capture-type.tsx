// Contacts' capture type, provisional (SH-1): the one-line contact ⌘⇧K already
// made with "/contact", now picked with its top-bar number or the type chip
// (call 90b). Contacts replaces it with its own body when the module is rebuilt.

import { Contact } from "lucide-react";

import { lineCaptureType } from "../../components/app/capture-line";

export const contactsCaptureType = lineCaptureType({
  target: "contact",
  module: "contacts",
  label: "Contact",
  icon: Contact,
  destination: "Contacts",
  plural: "contacts",
  placeholder: "Capture a contact…",
});
