import { useEffect, useState } from "react";
import { type ApiRequestError, apiGet } from "./api.ts";

interface Result<T> {
  data?: T;
  error?: ApiRequestError;
  loading: boolean;
}

/**
 * Loads an API path with a token, and reloads it every `refreshMs` if given. Keeps the last data
 * while reloading, so the page doesn't flicker.
 */
export function useApi<T>(path: string | undefined, token: string | undefined, refreshMs?: number) {
  const [result, setResult] = useState<Result<T>>({ loading: true });

  useEffect(() => {
    if (!path || !token) return;
    const controller = new AbortController();
    setResult({ loading: true });

    const load = async () => {
      try {
        const data = await apiGet<T>(path, token, controller.signal);
        setResult({ data, loading: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        setResult((previous) => ({ ...previous, error: error as ApiRequestError, loading: false }));
      }
    };

    load();
    const timer = refreshMs ? setInterval(load, refreshMs) : undefined;
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [path, token, refreshMs]);

  return result;
}
