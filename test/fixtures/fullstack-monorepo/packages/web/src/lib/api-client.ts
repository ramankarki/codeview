import { hc } from "hono/client";
import type { AppType } from "../../api/src/index";
import { useState, useEffect } from "react";

export const apiClient = hc<AppType>("http://localhost:3000");

/**
 * Thin hook: wraps Hono RPC call with loading/error state.
 * Usage: useRPC(() => apiClient.api.users.$get())
 */
export function useRPC<T>(
  call: (client: typeof apiClient) => Promise<Response>
): { data: T | null; isLoading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    call(apiClient)
      .then(r => r.json())
      .then(json => { if (!cancelled) { setData((json as { data: T }).data); setError(null); } })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, []);

  return { data, isLoading, error };
}
