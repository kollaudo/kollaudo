// Components, environments and versions are created the first time data refers to them (ADR 0005).
// Test runs and deployments go through the same functions, so they follow the same rules.

import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "./db/client.ts";
import { components, environments, versions } from "./db/schema.ts";
import { HttpError } from "./errors.ts";

export async function componentIdFor(tx: Executor, projectId: string, name: string) {
  const [row] = await tx
    .insert(components)
    .values({ projectId, name })
    .onConflictDoUpdate({
      target: [components.projectId, components.name],
      set: { name: sql`excluded.name` },
    })
    .returning({ id: components.id });
  if (!row) throw new Error("Component was not created");
  return row.id;
}

export async function environmentIdFor(tx: Executor, projectId: string, name: string) {
  const [row] = await tx
    .insert(environments)
    .values({ projectId, name })
    .onConflictDoUpdate({
      target: [environments.projectId, environments.name],
      set: { name: sql`excluded.name` },
    })
    .returning({ id: environments.id });
  if (!row) throw new Error("Environment was not created");
  return row.id;
}

const METADATA = ["commit", "branch", "tag", "pullRequest", "digest"] as const;

/** A version as sent: its name, the name of its component, and optional metadata. */
export type VersionInput = { component: string; version: string } & Partial<
  Record<(typeof METADATA)[number], string>
>;

/**
 * Finds or creates a version. Metadata fills in missing fields, but never changes a field that is
 * already set: a different value means two builds share one version identifier (ADR 0005).
 */
export async function versionIdFor(tx: Executor, componentId: string, input: VersionInput) {
  await tx.insert(versions).values({ componentId, name: input.version }).onConflictDoNothing();
  const [version] = await tx
    .select()
    .from(versions)
    .where(and(eq(versions.componentId, componentId), eq(versions.name, input.version)))
    .for("update");
  if (!version) throw new Error("Version was not created");

  const updates: Partial<Record<(typeof METADATA)[number], string>> = {};
  for (const field of METADATA) {
    const sent = input[field];
    if (sent === undefined) continue;
    const stored = version[field];
    if (stored === null) {
      updates[field] = sent;
    } else if (stored !== sent) {
      throw new HttpError(
        409,
        "version_conflict",
        `Version "${input.version}" of "${input.component}" already has ${field} "${stored}", ` +
          `not "${sent}". Each build needs its own version identifier, such as the commit SHA.`,
      );
    }
  }
  if (Object.keys(updates).length > 0) {
    await tx.update(versions).set(updates).where(eq(versions.id, version.id));
  }
  return version.id;
}
