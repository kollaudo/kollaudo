import type { CtrfTest, TestRunCreated, TestRunInput, TestRunSummary } from "@kollaudo/schema";
import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db, Executor } from "./db/client.ts";
import { components, environments, testResults, testRuns, versions } from "./db/schema.ts";
import { HttpError } from "./errors.ts";

type Input = z.output<typeof TestRunInput>;

/** Rows per insert, well below PostgreSQL's limit of 65535 parameters per statement. */
const BATCH_SIZE = 1000;

/**
 * Stores a CTRF report as a test run. The component, environment and version are created on first
 * use (ADR 0005).
 */
export async function ingestTestRun(
  db: Db,
  projectId: string,
  input: Input,
): Promise<TestRunCreated> {
  const { tool, summary, tests, environment, extra } = input.report.results;
  const counts = summarize(tests);

  return db.transaction(async (tx) => {
    const componentId = await componentIdFor(tx, projectId, input.component);
    const environmentId = input.environment
      ? await environmentIdFor(tx, projectId, input.environment)
      : null;
    const versionId = await versionIdFor(tx, componentId, input);

    const [run] = await tx
      .insert(testRuns)
      .values({
        versionId,
        environmentId,
        kind: input.kind,
        tool: tool.name,
        startedAt: timestamp(summary.start),
        finishedAt: timestamp(summary.stop),
        ...counts,
        extra: compact({ tool, environment, extra }),
      })
      .returning({ id: testRuns.id });
    if (!run) throw new Error("Test run was not created");

    const rows = tests.map((test) => resultRow(run.id, test));
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      await tx.insert(testResults).values(rows.slice(i, i + BATCH_SIZE));
    }

    return {
      id: run.id,
      component: input.component,
      version: input.version,
      environment: input.environment ?? null,
      kind: input.kind,
      summary: counts,
    };
  });
}

function summarize(tests: CtrfTest[]): TestRunSummary {
  const counts = {
    tests: tests.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    pending: 0,
    other: 0,
    flaky: 0,
  };
  for (const test of tests) {
    counts[test.status]++;
    if (test.flaky) counts.flaky++;
  }
  return counts;
}

function resultRow(testRunId: string, test: CtrfTest): typeof testResults.$inferInsert {
  const { name, status, duration, suite, message, trace, filePath, retries, flaky, tags, ...rest } =
    test;
  return {
    testRunId,
    name,
    status,
    durationMs: Math.round(duration),
    suite: typeof suite === "string" ? splitSuite(suite) : suite,
    file: filePath,
    message,
    trace,
    retries: retries ?? 0,
    flaky: flaky ?? false,
    tags,
    extra: compact(rest),
  };
}

/** Older reporters send the suite as one string, such as "login.spec.ts > login > form". */
function splitSuite(suite: string) {
  return suite
    .split(" > ")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** CTRF timestamps are milliseconds since the epoch. Missing or zero means unknown. */
function timestamp(ms: number | undefined) {
  return ms ? new Date(ms) : null;
}

/** Drops undefined values, and returns null for an empty object. */
function compact(value: Record<string, unknown>) {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

async function componentIdFor(tx: Executor, projectId: string, name: string) {
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

async function environmentIdFor(tx: Executor, projectId: string, name: string) {
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

/**
 * Finds or creates a version. Metadata fills in missing fields, but never changes a field that is
 * already set: a different value means two builds share one version identifier (ADR 0005).
 */
async function versionIdFor(tx: Executor, componentId: string, input: Input) {
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
