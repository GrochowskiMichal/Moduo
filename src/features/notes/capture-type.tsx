// Notes' capture type, provisional (SH-1): the one-line note ⌘⇧K already made
// with "/note", now picked with ⌘2 or the type chip instead (call 90b). Notes
// replaces it with its own body when the module is rebuilt.

import { FileText } from "lucide-react";

import { lineCaptureType } from "../../components/app/capture-line";

export const notesCaptureType = lineCaptureType({
  target: "note",
  module: "notes",
  label: "Note",
  icon: FileText,
  destination: "Notes",
  plural: "notes",
  placeholder: "Capture a note…",
});
