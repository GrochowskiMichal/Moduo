// The fix: pull the value out first and guard inside the closure.
export function useSendLimit(active: { accountId: string } | null, port: Port) {
  const accountId = active?.accountId ?? null;
  return useRead(accountId, () => (accountId ? port.sizeLimit(accountId) : Promise.resolve(null)));
}

export function useSave(runtime: Runtime | null) {
  return useCallback(() => runtime?.tasks.save(), [runtime]);
}

// Index assertions and plain function calls are out of scope.
export function useFirst(rows: Row[]) {
  return useMemo(() => rows.map((r) => r.top - rows[0]!.top), [rows]);
}
