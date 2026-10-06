// Waits for PostgreSQL when Kollaudo starts, and explains what's wrong when it doesn't answer, instead
// of hanging or crashing with a stack trace.

import postgres from "postgres";

/** Errors that can go away by themselves: the database is starting, or the network is slow. */
const TRANSIENT = new Set([
  "CONNECT_TIMEOUT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "ETIMEDOUT",
  // The host isn't known yet: a service name can appear after Kollaudo starts.
  "ENOTFOUND",
  // PostgreSQL itself: "the database system is starting up" and "too many connections".
  "57P03",
  "53300",
]);

/** How long one connection attempt waits, in seconds. */
const ATTEMPT_TIMEOUT_S = 5;
const RETRY_MS = 2_000;

export class DatabaseUnreachable extends Error {}

/** "postgres:5432/kollaudo": where the URL points, without the user and the password. */
export function describeTarget(url: string) {
  try {
    const { hostname, port, pathname } = new URL(url);
    return `${hostname}:${port || 5432}${pathname}`;
  } catch {
    return "the DATABASE_URL";
  }
}

/**
 * Resolves once the database answers. Retries transient errors until `waitMs` has passed, saying so
 * on `log`, then rejects with a DatabaseUnreachable whose message says what to check. Other errors,
 * such as a wrong password or an unknown database, reject at once.
 */
export async function waitForDatabase(
  url: string,
  { waitMs, log }: { waitMs: number; log: (text: string) => void },
): Promise<void> {
  const target = describeTarget(url);
  const deadline = Date.now() + waitMs;
  let told = false;
  for (;;) {
    const client = postgres(url, {
      max: 1,
      connect_timeout: ATTEMPT_TIMEOUT_S,
      onnotice: () => {},
    });
    try {
      await client`select 1`;
      return;
    } catch (error) {
      const code = String((error as { code?: unknown }).code ?? "");
      const reason = code || (error as Error).message;
      if (!TRANSIENT.has(code)) {
        throw new DatabaseUnreachable(
          `The database at ${target} refused the connection (${reason}): ${(error as Error).message}. ` +
            "Check the user, the password and the database name in DATABASE_URL.",
        );
      }
      if (Date.now() + RETRY_MS >= deadline) {
        throw new DatabaseUnreachable(
          `Can't reach the database at ${target} (${reason}). Check DATABASE_URL, and that PostgreSQL ` +
            "is running and reachable from Kollaudo: some environments, such as GitHub Codespaces, " +
            "don't let containers reach each other.",
        );
      }
      if (!told) {
        log(`Waiting for the database at ${target} (${reason})…\n`);
        told = true;
      }
    } finally {
      await client.end({ timeout: 0 });
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
}
