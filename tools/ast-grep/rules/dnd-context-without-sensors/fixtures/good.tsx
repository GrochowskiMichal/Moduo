// Fixed shapes: nothing here may be reported.
export function Harness({ children }: { children: React.ReactNode }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  return (
    <DndContext sensors={sensors} onDragEnd={() => {}}>
      {children}
    </DndContext>
  );
}
