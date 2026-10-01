import type { CtrfTest, TestRunCreated, TestRunInput, TestRunSummary } from "@kollaudo/schema";
import type { z } from "zod";
import type { Db } from "./db/client.ts";
import { testResults, testRuns } from "./db/schema.ts";
import { componentIdFor, environmentIdFor, versionIdFor } from "./first-use.ts";

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
