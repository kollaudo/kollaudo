import type {
  Deployment,
  DeploymentInput,
  DeploymentList,
  DeploymentQuery,
  PolicyDocument,
} from "@kollaudo/schema";
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "./db/client.ts";
import {
  apiTokens,
  components,
  deployments,
  environments,
  policies,
  verdicts,
  versions,
} from "./db/schema.ts";
import { HttpError } from "./errors.ts";
import { componentIdFor, environmentIdFor, versionIdFor } from "./first-use.ts";
import { resolveRule } from "./policies.ts";
import { type FoundToken, outsideLimits, tokenLabel } from "./tokens.ts";

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
  sentByName: apiTokens.name,
  sentByHint: apiTokens.hint,
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
    .leftJoin(apiTokens, eq(deployments.tokenId, apiTokens.id))
    .where(and(eq(components.projectId, projectId), ...conditions));
}

type DeploymentRow = Awaited<ReturnType<typeof selectDeployments>>[number];

type Ungated = Omit<Deployment, "gate">;

function toDeployment({ sentByName, sentByHint, ...row }: DeploymentRow): Ungated {
  return {
    ...row,
    sentBy: sentByHint === null ? null : tokenLabel({ name: sentByName, hint: sentByHint }),
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
  token: FoundToken,
  input: Input,
): Promise<Deployment> {
  const projectId = token.projectId;
  const refused = outsideLimits(token, input.component, input.environment);
  if (refused) throw new HttpError(403, "outside_token_limits", refused);

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
        tokenId: token.id,
        ...(input.deployedAt && { deployedAt: new Date(input.deployedAt) }),
      })
      .returning({ id: deployments.id });
    if (!row) throw new Error("Deployment was not created");
    return row.id;
  });

  const [row] = await selectDeployments(db, projectId, eq(deployments.id, id));
  if (!row) throw new Error("Deployment was not found after creating it");
  const [deployment] = await withGates(db, projectId, [toDeployment(row)]);
  return deployment as Deployment;
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

  const items = await withGates(db, projectId, rows.slice(0, query.limit).map(toDeployment));
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
    .leftJoin(apiTokens, eq(deployments.tokenId, apiTokens.id))
    .where(and(eq(components.projectId, projectId), ...conditions))
    .orderBy(
      versions.componentId,
      deployments.environmentId,
      desc(deployments.deployedAt),
      desc(deployments.id),
    );
  return withGates(
    db,
    projectId,
    rows
      .map(toDeployment)
      .sort(
        (a, b) =>
          a.component.localeCompare(b.component) || a.environment.localeCompare(b.environment),
      ),
  );
}

/**
 * Says, for each deployment, whether a gate let it through (ADR 0019). When the policy in force at
 * the time of the deployment says where versions of its environment come from (`from`), the
 * deployment is gated if Kollaudo gave a pass for the same version there before it was deployed.
 */
async function withGates(db: Db, projectId: string, items: Ungated[]): Promise<Deployment[]> {
  if (items.length === 0) return [];
  const revisions = await db
    .select({ document: policies.document, createdAt: policies.createdAt })
    .from(policies)
    .where(eq(policies.projectId, projectId))
    .orderBy(asc(policies.revision));
  const fromOf = (deployment: Ungated) => {
    const deployedAt = Date.parse(deployment.deployedAt);
    const policy = revisions.filter((r) => r.createdAt.getTime() <= deployedAt).at(-1);
    return resolveRule(
      policy?.document as PolicyDocument | undefined,
      deployment.component,
      deployment.environment,
    ).from;
  };
  const withFrom = items.map((deployment) => ({ deployment, from: fromOf(deployment) }));

  const checked = withFrom.filter(({ from }) => from !== null);
  const passes =
    checked.length === 0
      ? []
      : await db
          .select({
            id: verdicts.id,
            component: verdicts.component,
            environment: verdicts.environment,
            version: verdicts.version,
            createdAt: verdicts.createdAt,
          })
          .from(verdicts)
          .where(
            and(
              eq(verdicts.projectId, projectId),
              eq(verdicts.outcome, "pass"),
              inArray(verdicts.version, [...new Set(checked.map((c) => c.deployment.version))]),
              inArray(verdicts.environment, [...new Set(checked.map((c) => c.from as string))]),
            ),
          )
          .orderBy(desc(verdicts.createdAt));

  return withFrom.map(({ deployment, from }) => {
    if (from === null) return { ...deployment, gate: null };
    const pass = passes.find(
      (p) =>
        p.component === deployment.component &&
        p.version === deployment.version &&
        p.environment === from &&
        p.createdAt.getTime() <= Date.parse(deployment.deployedAt),
    );
    return {
      ...deployment,
      gate: {
        from,
        gated: pass !== undefined,
        verdictId: pass?.id ?? null,
        passedAt: pass?.createdAt.toISOString() ?? null,
      },
    };
  });
}
