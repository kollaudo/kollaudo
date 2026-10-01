import type { TestRun, Verdict, VerdictQuery, VerdictReason } from "@kollaudo/schema";
import { and, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "./db/client.ts";
import { components, environments, testRuns, versions } from "./db/schema.ts";
import { currentDeployments } from "./deployments.ts";
import { runColumns, toTestRun } from "./reads.ts";

type Query = z.output<typeof VerdictQuery>;

/** The verdict of a version in an environment, under the default policy (ADR 0013, 0014). */
export async function getVerdict(db: Db, projectId: string, query: Query): Promise<Verdict> {
  const require = query.require ? [...new Set(query.require.split(","))].sort() : [];

  // The latest run of each kind. Unknown names simply find no runs: missing evidence, not an error.
  const latestRuns = db
    .selectDistinctOn([testRuns.kind], runColumns)
    .from(testRuns)
    .innerJoin(versions, eq(testRuns.versionId, versions.id))
    .innerJoin(components, eq(versions.componentId, components.id))
    .innerJoin(environments, eq(testRuns.environmentId, environments.id))
    .where(
      and(
        eq(components.projectId, projectId),
        eq(components.name, query.component),
        eq(versions.name, query.version),
        eq(environments.name, query.environment),
      ),
    )
    .orderBy(testRuns.kind, desc(testRuns.createdAt), desc(testRuns.id));
  const deployed = currentDeployments(
    db,
    projectId,
    eq(components.name, query.component),
    eq(environments.name, query.environment),
  );
  const [latest, [current]] = await Promise.all([latestRuns, deployed]);

  return {
    component: query.component,
    environment: query.environment,
    version: query.version,
    ...judge(latest.map(toTestRun), require),
    policy: { name: "default", require },
    deployed: current ?? null,
  };
}

/**
 * Judges the latest run of each kind. Every kind that ran is judged, and every required kind must
 * have run. `fail` wins over `unknown`, and `pass` needs at least one run.
 */
export function judge(
  latest: TestRun[],
  require: string[],
): Pick<Verdict, "outcome" | "message" | "reasons"> {
  const kinds = [...new Set([...latest.map((run) => run.kind), ...require])].sort();
  const reasons = kinds.map((kind) =>
    reason(
      kind,
      latest.find((r) => r.kind === kind),
    ),
  );
  if (reasons.length === 0) {
    return {
      outcome: "unknown",
      message: "No test run of this version in this environment.",
      reasons,
    };
  }

  const failed = reasons.filter((r) => r.outcome === "fail").map((r) => r.kind);
  const missing = reasons.filter((r) => r.outcome === "unknown").map((r) => r.kind);
  if (failed.length === 0 && missing.length === 0) {
    return { outcome: "pass", message: `${list(kinds)} passed.`, reasons };
  }
  const message = [
    failed.length > 0 ? `${list(failed)} failed.` : "",
    missing.length > 0 ? `Evidence is missing for ${list(missing)}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return { outcome: failed.length > 0 ? "fail" : "unknown", message, reasons };
}

function reason(kind: string, run: TestRun | undefined): VerdictReason {
  if (!run) return { kind, outcome: "unknown", message: "Required, but no run.", run: null };
  const { tests, failed } = run.summary;
  if (tests === 0) {
    return { kind, outcome: "unknown", message: "The latest run has no tests.", run };
  }
  return { kind, outcome: failed > 0 ? "fail" : "pass", message: counts(run), run };
}

/** "1 failed, 40 passed, 2 skipped, 3 flaky": failures first, zero counts left out. */
function counts({ summary }: TestRun) {
  const { failed, passed, skipped, pending, other, flaky } = summary;
  return Object.entries({ failed, passed, skipped, pending, other, flaky })
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${count} ${name}`)
    .join(", ");
}

/** "e2e", "e2e and smoke", "e2e, smoke and uat". */
function list(items: string[]) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
