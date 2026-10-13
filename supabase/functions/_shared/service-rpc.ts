/**
 * Calls a Postgres function over PostgREST with the project's secret key, with
 * plain fetch rather than supabase-js: no esm.sh import on a cold start, and a
 * timeout on every call. For server-only functions (granted to service_role).
 *
 * Plain TypeScript: the caller passes the URL, key and fetch, so the unit tests
 * and the Edge Functions run the same code.
 */

export type ServiceRpcConfig = {
  /** The project's API origin (SUPABASE_URL). */
  baseUrl: string;
  /** The secret key (SUPABASE_SECRET_KEYS.default). */
  key: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

export const DEFAULT_RPC_TIMEOUT_MS = 8000;

export class ServiceRpcError extends Error {
  constructor(
    readonly fn: string,
    readonly status: number,
    detail: string,
  ) {
    super(`rpc ${fn}: ${status} ${detail}`);
    this.name = "ServiceRpcError";
  }
}

/** Runs `public.<fn>(args)` and returns its JSON result; throws ServiceRpcError on a non-2xx answer. */
export async function serviceRpc<T>(config: ServiceRpcConfig, fn: string, args: Record<string, unknown>): Promise<T> {
  const doFetch = config.fetch ?? fetch;
  const response = await doFetch(`${config.baseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: config.key,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) throw new ServiceRpcError(fn, response.status, text.slice(0, 300));
  return (text ? JSON.parse(text) : null) as T;
}
