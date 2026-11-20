// Pre-fix shapes: every `@flag` line must be reported.
export function DeleteButton({ onDelete }: { onDelete: () => void }) {
  return (
    <button
      onClick={() => {
        // @flag
        if (window.confirm("Delete?")) onDelete();
      }}
    />
  );
}
