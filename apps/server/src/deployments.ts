import type {
  Deployment,
  DeploymentInput,
  DeploymentList,
  DeploymentQuery,
} from "@kollaudo/schema";
import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "./db/client.ts";
import { components, deployments, environments, versions } from "./db/schema.ts";
import { componentIdFor, environmentIdFor, versionIdFor } from "./first-use.ts";

type Input = z.output<typeof DeploymentInput>;
type Query = z.output<typeof DeploymentQuery>;

const deploymentColumns = {
  id: deployments.id,
  component: components.name,
  environment: environments.name,
  version: versions.name,
  commit: versions.commit,
  branch: versions.branch,
  tag: versions.tag,
  pullRequest: versions.pullRequest,
  digest: versions.digest,
  tool: deployments.tool,
  deployedAt: deployments.deployedAt,
  createdAt: deployments.createdAt,
};

/** Selects deployments with their component, version and environment, limited to one project. */
function selectDeployments(db: Db, projectId: string, ...conditions: (SQL | undefined)[]) {
  return db
    .select(deploymentColumns)
    .from(deployments)
    .innerJoin(versions, eq(deployments.versionId, versions.id))
    .innerJoin(components, eq(versions.componentId, components.id))
    .innerJoin(environments, eq(deployments.environmentId, environments.id))
    .where(and(eq(components.projectId, projectId), ...conditions));
}

type DeploymentRow = Awaited<ReturnType<typeof selectDeployments>>[number];

function toDeployment(row: DeploymentRow): Deployment {
  return {
    ...row,
    deployedAt: row.deployedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Records that a version runs in an environment. The component, environment and version are created
 * on first use, as for test runs (ADR 0005): a version deployed without tests shows up as such.
 */
export async function recordDeployment(
  db: Db,
  projectId: string,
  input: Input,
): Promise<Deployment> {
  const id = await db.transaction(async (tx) => {
    const componentId = await componentIdFor(tx, projectId, input.component);
    const environmentId = await environmentIdFor(tx, projectId, input.environment);
    const versionId = await versionIdFor(tx, componentId, input);
    const [row] = await tx
      .insert(deployments)
      .values({
        versionId,
        environmentId,
        tool: input.tool,
        ...(input.deployedAt && { deployedAt: new Date(input.deployedAt) }),
      })
      .returning({ id: deployments.id });
    if (!row) throw new Error("Deployment was not created");
    return row.id;
  });

  const [row] = await selectDeployments(db, projectId, eq(deployments.id, id));
  if (!row) throw new Error("Deployment was not found after creating it");
  return toDeployment(row);
}

/** Lists deployments newest first, one page at a time. */
export async function listDeployments(
  db: Db,
  projectId: string,
  query: Query,
): Promise<DeploymentList> {
  const rows = await selectDeployments(
    db,
    projectId,
    query.component ? eq(components.name, query.component) : undefined,
    query.environment ? eq(environments.name, query.environment) : undefined,
    // Keyset pagination: deployments older than the cursor, compared in SQL to keep microseconds.
    query.before
      ? sql`(${deployments.deployedAt}, ${deployments.id}) <
          (select cursor.deployed_at, cursor.id from deployments cursor where cursor.id = ${query.before})`
      : undefined,
  )
    .orderBy(desc(deployments.deployedAt), desc(deployments.id))
    .limit(query.limit + 1);

  const items = rows.slice(0, query.limit).map(toDeployment);
  const next = rows.length > query.limit ? (items.at(-1)?.id ?? null) : null;
  return { items, next };
}

/**
 * What runs now: the latest deployment of each component in each environment, by when it happened.
 * Conditions narrow it, such as to one component and one environment.
 */
export async function currentDeployments(
  db: Db,
  projectId: string,
  ...conditions: (SQL | undefined)[]
): Promise<Deployment[]> {
  const rows = await db
    .selectDistinctOn([versions.componentId, deployments.environmentId], deploymentColumns)
    .from(deployments)
    .innerJoin(versions, eq(deployments.versionId, versions.id))
    .innerJoin(components, eq(versions.componentId, components.id))
    .innerJoin(environments, eq(deployments.environmentId, environments.id))
    .where(and(eq(components.projectId, projectId), ...conditions))
    .orderBy(
      versions.componentId,
      deployments.environmentId,
      desc(deployments.deployedAt),
      desc(deployments.id),
    );
  return rows
    .map(toDeployment)
    .sort(
      (a, b) =>
        a.component.localeCompare(b.component) || a.environment.localeCompare(b.environment),
    );
}
