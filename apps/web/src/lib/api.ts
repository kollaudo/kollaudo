import type { ApiError } from "@kollaudo/schema";

/** An error answered by the Kollaudo API, or a network failure (status 0). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Calls a read endpoint of the API with a project token. */
export async function apiGet<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { authorization: `Bearer ${token}` }, signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiRequestError(0, "network_error", "Can't reach the Kollaudo server.");
  }
  if (response.ok) return (await response.json()) as T;

  const body = (await response.json().catch(() => undefined)) as ApiError | undefined;
  throw new ApiRequestError(
    response.status,
    body?.error.code ?? "http_error",
    body?.error.message ?? `The server answered ${response.status} ${response.statusText}.`,
  );
}
