// Pre-fix shapes: every `@flag` line must be reported.
export function Row() {
  const avatar = (
    // @flag
    <Avatar size="sm" className="size-4" />
  );
  const separator = (
    // @flag
    <Separator orientation="vertical" className="mx-1 h-4" />
  );
  return (
    <div>
      {avatar}
      {separator}
    </div>
  );
}
