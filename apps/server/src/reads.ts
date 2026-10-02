import type {
  HealthMatrix,
  TestRun,
  TestRunDetail,
  TestRunList,
  TestRunQuery,
} from "@kollaudo/schema";
import { and, asc, desc, eq, type SQL, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "./db/client.ts";
import {
  apiTokens,
  components,
  environments,
  testResults,
  testRuns,
  versions,
} from "./db/schema.ts";
import { currentDeployments } from "./deployments.ts";
import { tokenLabel } from "./tokens.ts";

type Query = z.output<typeof TestRunQuery>;

export const runColumns = {
  id: testRuns.id,
  component: components.name,
  version: versions.name,
  environment: environments.name,
  kind: testRuns.kind,
  commit: versions.commit,
  branch: versions.branch,
  tag: versions.tag,
  pullRequest: versions.pullRequest,
  digest: versions.digest,
  tool: testRuns.tool,
  sentByName: apiTokens.name,
  sentByHint: apiTokens.hint,
  startedAt: testRuns.startedAt,
  finishedAt: testRuns.finishedAt,
  createdAt: testRuns.createdAt,
  tests: testRuns.tests,
  passed: testRuns.passed,
  failed: testRuns.failed,
  skipped: testRuns.skipped,
  pending: testRuns.pending,
  other: testRuns.other,
  flaky: testRuns.flaky,
};

/** Selects runs with their component, version and environment, limited to one project. */
function selectRuns(db: Db, projectId: string, ...conditions: (SQL | undefined)[]) {
  return db
    .select(runColumns)
    .from(testRuns)
    .innerJoin(versions, eq(testRuns.versionId, versions.id))
    .innerJoin(components, eq(versions.componentId, components.id))
    .leftJoin(environments, eq(testRuns.environmentId, environments.id))
    .leftJoin(apiTokens, eq(testRuns.tokenId, apiTokens.id))
    .where(and(eq(components.projectId, projectId), ...conditions));
}

type RunRow = Awaited<ReturnType<typeof selectRuns>>[number];

export function toTestRun(row: RunRow): TestRun {
  const { tests, passed, failed, skipped, pending, other, flaky, sentByName, sentByHint, ...run } =
    row;
  return {
    ...run,
    sentBy: sentByHint === null ? null : tokenLabel({ name: sentByName, hint: sentByHint }),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    summary: { tests, passed, failed, skipped, pending, other, flaky },
  };
}

/** Lists runs newest first, one page at a time. */
export async function listTestRuns(db: Db, projectId: string, query: Query): Promise<TestRunList> {
  const rows = await selectRuns(
    db,
    projectId,
    query.component ? eq(components.name, query.component) : undefined,
    query.environment ? eq(environments.name, query.environment) : undefined,
    query.version ? eq(versions.name, query.version) : undefined,
    query.kind ? eq(testRuns.kind, query.kind) : undefined,
    // Keyset pagination: runs older than the cursor, compared in SQL to keep microseconds.
    query.before
      ? sql`(${testRuns.createdAt}, ${testRuns.id}) <
          (select cursor.created_at, cursor.id from test_runs cursor where cursor.id = ${query.before})`
      : undefined,
  )
    .orderBy(desc(testRuns.createdAt), desc(testRuns.id))
    .limit(query.limit + 1);

  const items = rows.slice(0, query.limit).map(toTestRun);
  const next = rows.length > query.limit ? (items.at(-1)?.id ?? null) : null;
  return { items, next };
}

/** One run with its test results, or undefined if the project has no such run. */
export async function getTestRun(
  db: Db,
  projectId: string,
  id: string,
): Promise<TestRunDetail | undefined> {
  const [row] = await selectRuns(db, projectId, eq(testRuns.id, id));
  if (!row) return undefined;

  const results = await db
    .select()
    .from(testResults)
    .where(eq(testResults.testRunId, id))
    .orderBy(asc(testResults.file), asc(testResults.suite), asc(testResults.name));

  return {
    ...toTestRun(row),
    results: results.map(({ testRunId: _, suite, tags, ...result }) => ({
      ...result,
      suite: suite ?? [],
      tags: tags ?? [],
      extra: result.extra as Record<string, unknown> | null,
    })),
  };
}

/** The latest run for each component, environment and kind of a project, and what runs where. */
export async function getHealth(db: Db, projectId: string): Promise<HealthMatrix> {
  const [componentRows, environmentRows, latest, deployed] = await Promise.all([
    db
      .select({ name: components.name })
      .from(components)
      .where(eq(components.projectId, projectId))
      .orderBy(components.name),
    db
      .select({ name: environments.name })
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .orderBy(environments.name),
    db
      .selectDistinctOn([versions.componentId, testRuns.environmentId, testRuns.kind], runColumns)
      .from(testRuns)
      .innerJoin(versions, eq(testRuns.versionId, versions.id))
      .innerJoin(components, eq(versions.componentId, components.id))
      .leftJoin(environments, eq(testRuns.environmentId, environments.id))
      .leftJoin(apiTokens, eq(testRuns.tokenId, apiTokens.id))
      .where(eq(components.projectId, projectId))
      .orderBy(
        versions.componentId,
        testRuns.environmentId,
        testRuns.kind,
        desc(testRuns.createdAt),
        desc(testRuns.id),
      ),
    currentDeployments(db, projectId),
  ]);

  return {
    components: componentRows.map((r) => r.name),
    environments: environmentRows.map((r) => r.name),
    latest: latest
      .map(toTestRun)
      .sort(
        (a, b) =>
          a.component.localeCompare(b.component) ||
          (a.environment ?? "").localeCompare(b.environment ?? "") ||
          a.kind.localeCompare(b.kind),
      ),
    deployed,
  };
}
