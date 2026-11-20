// Pre-fix shapes: every `@flag` line must be reported.
export function Harness({ children }: { children: React.ReactNode }) {
  return (
    // @flag
    <DndContext onDragEnd={() => {}}>
      {children}
    </DndContext>
  );
}

export function Bare() {
  // @flag
  return <DndContext />;
}
