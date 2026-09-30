import type { ApiError } from "@kollaudo/schema";
import type { Io } from "./io.ts";

export interface Server {
  url: string;
  token: string;
}

/** The server from KOLLAUDO_URL and KOLLAUDO_TOKEN, or a message saying what is missing. */
export function server(io: Io, token: string): Server | string {
  const url = io.env.KOLLAUDO_URL?.replace(/\/+$/, "");
  if (!url) return "Set KOLLAUDO_URL to the URL of your Kollaudo server.";
  if (!io.env.KOLLAUDO_TOKEN) return `Set KOLLAUDO_TOKEN to ${token} of your project.`;
  return { url, token: io.env.KOLLAUDO_TOKEN };
}

/**
 * Calls Kollaudo and returns the status and body of its answer. Throws an error with a readable
 * message when Kollaudo can't be reached.
 */
export async function call(
  io: Io,
  { url, token }: Server,
  path: string,
  init: { method?: string; body?: string; timeoutMs: number },
) {
  let response: Response;
  try {
    response = await io.fetch(`${url}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        "user-agent": "kollaudo-cli",
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: init.body,
      signal: AbortSignal.timeout(init.timeoutMs),
    });
  } catch (error) {
    const cause = (error as Error & { cause?: Error }).cause?.message ?? (error as Error).message;
    throw new Error(`Can't reach Kollaudo at ${url}: ${cause}`);
  }
  return { response, text: await response.text() };
}

/** A readable message for an error answer. Paths under `report.` point into the report file. */
export function describeError(response: Response, text: string, file?: string) {
  let error: ApiError["error"] | undefined;
  try {
    error = (JSON.parse(text) as ApiError).error;
  } catch {
    // Not a Kollaudo error: a proxy, a wrong URL…
  }
  if (!error?.message) {
    return `Kollaudo answered ${response.status} ${response.statusText}. Is KOLLAUDO_URL right?`;
  }

  const issues = (error.issues ?? []).map(({ path, message }) => {
    const where =
      file && path.startsWith("report.") ? `${file}: ${path.slice("report.".length)}` : path;
    return `\n  ${where}: ${message}`;
  });
  return `${error.message} (${response.status} ${error.code})${issues.join("")}`;
}
