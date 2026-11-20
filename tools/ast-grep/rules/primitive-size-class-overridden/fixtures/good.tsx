// Fixed: size through the prop or the primitive's own variant.
export function Row() {
  return (
    <div>
      <Avatar size="icon" />
      <Avatar className="size-4" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
    </div>
  );
}
