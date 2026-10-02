// Overrides let one version through in one environment, for a while, with a reason (ADR 0018).

import type { Override, OverrideInput, OverrideList, OverrideQuery } from "@kollaudo/schema";
import { and, desc, eq, gt, isNull, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "./db/client.ts";
import { apiTokens, components, environments, overrides, versions } from "./db/schema.ts";
import { HttpError } from "./errors.ts";
import { componentIdFor, environmentIdFor, versionIdFor } from "./first-use.ts";
import { type FoundToken, tokenLabel } from "./tokens.ts";

type Input = z.output<typeof OverrideInput>;
type Query = z.output<typeof OverrideQuery>;

/** The longest an override holds: it is for urgent cases, not a way to switch a gate off. */
const MAX_DURATION_MS = 24 * 3_600_000;

const overrideColumns = {
  id: overrides.id,
  component: components.name,
  environment: environments.name,
  version: versions.name,
  reason: overrides.reason,
  byName: apiTokens.name,
  byHint: apiTokens.hint,
  createdAt: overrides.createdAt,
  expiresAt: overrides.expiresAt,
  revokedAt: overrides.revokedAt,
};

function selectOverrides(db: Db, projectId: string, ...conditions: (SQL | undefined)[]) {
  return db
    .select(overrideColumns)
    .from(overrides)
    .innerJoin(versions, eq(overrides.versionId, versions.id))
    .innerJoin(components, eq(versions.componentId, components.id))
    .innerJoin(environments, eq(overrides.environmentId, environments.id))
    .leftJoin(apiTokens, eq(overrides.tokenId, apiTokens.id))
    .where(and(eq(components.projectId, projectId), ...conditions));
}

type OverrideRow = Awaited<ReturnType<typeof selectOverrides>>[number];

function toOverride({ byName, byHint, ...row }: OverrideRow, now = Date.now()): Override {
  return {
    ...row,
    by: byHint === null ? null : tokenLabel({ name: byName, hint: byHint }),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    active: row.revokedAt === null && row.expiresAt.getTime() > now,
  };
}

/** "4h" or "30m" as milliseconds. */
function duration(value: string) {
  return Number(value.slice(0, -1)) * (value.endsWith("h") ? 3_600_000 : 60_000);
}

/**
 * Lets a version through in an environment until it expires. The component, environment and version
 * are created on first use (ADR 0005): an urgent fix may have no results at all yet.
 */
export async function createOverride(db: Db, token: FoundToken, input: Input): Promise<Override> {
  const holdsFor = duration(input.for);
  if (holdsFor > MAX_DURATION_MS) {
    throw new HttpError(400, "override_too_long", "An override holds for 24h at most.");
  }
  const id = await db.transaction(async (tx) => {
    const componentId = await componentIdFor(tx, token.projectId, input.component);
    const environmentId = await environmentIdFor(tx, token.projectId, input.environment);
    const versionId = await versionIdFor(tx, componentId, input);
    const [row] = await tx
      .insert(overrides)
      .values({
        versionId,
        environmentId,
        reason: input.reason,
        tokenId: token.id,
        expiresAt: new Date(Date.now() + holdsFor),
      })
      .returning({ id: overrides.id });
    if (!row) throw new Error("Override was not created");
    return row.id;
  });
  const [row] = await selectOverrides(db, token.projectId, eq(overrides.id, id));
  if (!row) throw new Error("Override was not found after creating it");
  return toOverride(row);
}

/** Ends an override before it expires. */
export async function revokeOverride(db: Db, projectId: string, id: string): Promise<Override> {
  const [found] = await selectOverrides(db, projectId, eq(overrides.id, id));
  if (!found) throw new HttpError(404, "not_found", "Override not found.");
  if (found.revokedAt === null) {
    await db.update(overrides).set({ revokedAt: new Date() }).where(eq(overrides.id, id));
  }
  const [row] = await selectOverrides(db, projectId, eq(overrides.id, id));
  return toOverride(row as OverrideRow);
}

/** Every override of the project, newest first: they are an audit trail, so expired ones stay. */
export async function listOverrides(
  db: Db,
  projectId: string,
  query: Query,
): Promise<OverrideList> {
  const rows = await selectOverrides(
    db,
    projectId,
    query.component ? eq(components.name, query.component) : undefined,
    query.environment ? eq(environments.name, query.environment) : undefined,
    query.version ? eq(versions.name, query.version) : undefined,
  )
    .orderBy(desc(overrides.createdAt), desc(overrides.id))
    .limit(500);
  return { items: rows.map((row) => toOverride(row)) };
}

/** The latest override that holds for a version in an environment, if any. */
export async function activeOverride(
  db: Db,
  projectId: string,
  component: string,
  environment: string,
  version: string,
): Promise<Override | undefined> {
  const [row] = await selectOverrides(
    db,
    projectId,
    eq(components.name, component),
    eq(environments.name, environment),
    eq(versions.name, version),
    isNull(overrides.revokedAt),
    gt(overrides.expiresAt, new Date()),
  )
    .orderBy(desc(overrides.createdAt))
    .limit(1);
  return row ? toOverride(row) : undefined;
}
