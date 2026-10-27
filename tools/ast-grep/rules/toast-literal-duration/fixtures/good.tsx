// Fixed: one grammar, one duration.
export function trash(id: string) {
  undoToast({ message: "Moved to Trash", onUndo: () => restore(id) });
  toast("Sent", { duration: SENT_UNDO_MS });
  toast("Update ready", { duration: Number.POSITIVE_INFINITY });
}
