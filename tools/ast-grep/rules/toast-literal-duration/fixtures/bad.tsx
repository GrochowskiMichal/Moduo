// Pre-fix shapes: every `@flag` line must be reported.
export function trash(id: string) {
  toast("Moved to Trash", {
    // @flag
    duration: 8000,
    action: { label: "Undo", onClick: () => restore(id) },
  });
  // @flag
  toast.success("Saved", { duration: 4000 });
}
