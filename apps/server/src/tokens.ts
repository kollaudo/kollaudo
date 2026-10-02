import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db, Executor } from "./db/client.ts";
import { apiTokens } from "./db/schema.ts";

export type TokenScope = (typeof apiTokens.$inferSelect)["scope"];

const PREFIX = "kol_";

/** A new random token, `kol_` followed by 256 random bits (ADR 0007). */
export function generateToken(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** What a token is called, and what an `ingest` token may send (ADR 0017). */
export interface TokenOptions {
  name?: string;
  /** Names or `*` patterns. Undefined or empty means no limit. */
  components?: string[];
  environments?: string[];
  /** Whether a token limited to environments may also send build-level runs. */
  build?: boolean;
}

/** Creates a token and returns it. The token itself is never stored, so it can't be shown again. */
export async function createToken(
  db: Executor,
  projectId: string,
  scope: TokenScope,
  options: TokenOptions = {},
) {
  const token = generateToken();
  const environments = nonEmpty(options.environments);
  const [row] = await db
    .insert(apiTokens)
    .values({
      projectId,
      scope,
      hash: hashToken(token),
      hint: token.slice(0, PREFIX.length + 4),
      name: options.name,
      components: nonEmpty(options.components),
      environments,
      // Limited to environments, a token sends build-level runs only when it says so.
      build: options.build ?? environments === null,
    })
    .returning({ id: apiTokens.id });
  if (!row) throw new Error("Token was not created");
  return { id: row.id, scope, token, name: options.name ?? null };
}

function nonEmpty(list: string[] | undefined) {
  return list && list.length > 0 ? list : null;
}

/** How often `lastUsedAt` is refreshed, to avoid a database write on every request. */
const LAST_USED_PRECISION_MS = 60_000;

/** Finds a valid, non-revoked token and records its use. Returns `undefined` if it doesn't exist. */
export async function findToken(db: Db, token: string) {
  if (!token.startsWith(PREFIX)) return undefined;
  const [row] = await db
    .select({
      id: apiTokens.id,
      projectId: apiTokens.projectId,
      scope: apiTokens.scope,
      name: apiTokens.name,
      hint: apiTokens.hint,
      components: apiTokens.components,
      environments: apiTokens.environments,
      build: apiTokens.build,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .where(and(eq(apiTokens.hash, hashToken(token)), isNull(apiTokens.revokedAt)));
  if (!row) return undefined;

  const { lastUsedAt, ...found } = row;
  if (!lastUsedAt || Date.now() - lastUsedAt.getTime() > LAST_USED_PRECISION_MS) {
    await db.update(apiTokens).set({ lastUsedAt: new Date() }).where(eq(apiTokens.id, row.id));
  }
  return found;
}

export type FoundToken = NonNullable<Awaited<ReturnType<typeof findToken>>>;

/**
 * Why a token may not send data for a component in an environment, or undefined if it may. A null
 * environment is a build-level run.
 */
export function outsideLimits(
  token: Pick<FoundToken, "components" | "environments" | "build">,
  component: string,
  environment: string | null,
): string | undefined {
  if (token.components && !token.components.some((p) => matches(p, component))) {
    return `This token can't send data for the component "${component}": it is limited to ${token.components.join(", ")}.`;
  }
  if (environment === null) {
    return token.build
      ? undefined
      : "This token can't send build-level runs: it is limited to environments.";
  }
  if (token.environments && !token.environments.some((p) => matches(p, environment))) {
    return `This token can't send data for the environment "${environment}": it is limited to ${token.environments.join(", ")}.`;
  }
  return undefined;
}

/** A name or a pattern where `*` stands for any characters, such as `pr-*`. */
export function matches(pattern: string, name: string): boolean {
  const regex = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\/]/g, "\\$&"));
  return new RegExp(`^${regex.join(".*")}$`).test(name);
}

/** How a token is shown next to the data it sent: its name, or the start of the token. */
export function tokenLabel(token: { name: string | null; hint: string }) {
  return token.name ?? `${token.hint}…`;
}
