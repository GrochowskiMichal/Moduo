// Pre-fix shape (MV-12, features/email/ui/use-compose-extras.ts): the closure
// asserts `active` non-null because the key is null without it, but the
// compiler reads `active.accountId` as a dependency during render.
export function useSendLimit(active: { accountId: string } | null, port: Port) {
  return useRead(active ? "limit" : null, () =>
    // @flag
    port.sizeLimit(active!.accountId),
  );
}

export function useSave(runtime: Runtime | null) {
  return useCallback(
    // @flag
    () => runtime!.tasks.save(),
    [runtime],
  );
}
