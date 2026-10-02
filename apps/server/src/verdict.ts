import type { TestRun, Verdict, VerdictQuery, VerdictReason } from "@kollaudo/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "./db/client.ts";
import {
  apiTokens,
  components,
  deployments,
  environments,
  testRuns,
  versions,
} from "./db/schema.ts";
import { currentDeployments } from "./deployments.ts";
import { currentPolicy, duration, type ResolvedRule, resolveRule } from "./policies.ts";
import { runColumns, toTestRun } from "./reads.ts";

type Query = z.output<typeof VerdictQuery>;

/** The runs of one version in one environment that a verdict looks at, newest first. */
const RUNS_PER_VERDICT = 1000;

/**
 * The verdict of a version in an environment (ADR 0013), under the rules of the project's policy
 * for that component and environment (ADR 0016). The request can add required kinds, never relax.
 */
export async function getVerdict(db: Db, projectId: string, query: Query): Promise<Verdict> {
  const forComponentAndEnvironment = [
    eq(components.projectId, projectId),
    eq(components.name, query.component),
    eq(environments.name, query.environment),
  ];
  const [policy, rows, [deployed], history] = await Promise.all([
    currentPolicy(db, projectId),
    db
      .select(runColumns)
      .from(testRuns)
      .innerJoin(versions, eq(testRuns.versionId, versions.id))
      .innerJoin(components, eq(versions.componentId, components.id))
      .innerJoin(environments, eq(testRuns.environmentId, environments.id))
      .leftJoin(apiTokens, eq(testRuns.tokenId, apiTokens.id))
      .where(and(...forComponentAndEnvironment, eq(versions.name, query.version)))
      .orderBy(desc(testRuns.createdAt), desc(testRuns.id))
      .limit(RUNS_PER_VERDICT),
    currentDeployments(
      db,
      projectId,
      eq(components.name, query.component),
      eq(environments.name, query.environment),
    ),
    // Every deployment of the component in the environment, to tell what ran when.
    db
      .select({ version: versions.name, deployedAt: deployments.deployedAt })
      .from(deployments)
      .innerJoin(versions, eq(deployments.versionId, versions.id))
      .innerJoin(components, eq(versions.componentId, components.id))
      .innerJoin(environments, eq(deployments.environmentId, environments.id))
      .where(and(...forComponentAndEnvironment))
      .orderBy(asc(deployments.deployedAt), asc(deployments.id)),
  ]);

  const rule = resolveRule(policy?.document, query.component, query.environment);
  const requested = query.require ? query.require.split(",") : [];
  const require = [...new Set([...rule.require, ...requested])].sort();

  return {
    component: query.component,
    environment: query.environment,
    version: query.version,
    ...judge(candidates(rows.map(toTestRun), rule, query.version, history), require, rule),
    policy: {
      name: rule.fromPolicy ? "project" : "default",
      revision: policy?.revision ?? null,
      require,
      deployed: rule.deployed,
      flaky: rule.flaky,
      maxAge: rule.maxAge,
    },
    deployed: deployed ?? null,
  };
}

/** For each kind, the latest run that counts, or why the latest run doesn't count. */
export interface Candidate {
  run: TestRun | null;
  /** Why the latest run of the kind doesn't count, when no run counts. */
  excluded?: string;
}

/**
 * Picks, for each kind, the latest run that the rules let count. With `deployed`, a run counts only
 * if the latest deployment before it was the tested version. With `maxAge`, only recent runs count.
 */
export function candidates(
  runs: TestRun[],
  rule: Pick<ResolvedRule, "deployed" | "maxAge">,
  version: string,
  history: { version: string; deployedAt: Date }[],
  now = Date.now(),
): Map<string, Candidate> {
  const byKind = new Map<string, Candidate>();
  for (const run of runs) {
    const current = byKind.get(run.kind);
    if (current?.run) continue;
    const excluded = whyExcluded(run, rule, version, history, now);
    if (!excluded) byKind.set(run.kind, { run });
    // Keep the reason of the latest run, the one people expect to count.
    else if (!current) byKind.set(run.kind, { run: null, excluded });
  }
  return byKind;
}

function whyExcluded(
  run: TestRun,
  rule: Pick<ResolvedRule, "deployed" | "maxAge">,
  version: string,
  history: { version: string; deployedAt: Date }[],
  now: number,
) {
  if (rule.maxAge && Date.parse(run.createdAt) < now - duration(rule.maxAge)) {
    return `The latest run is older than ${rule.maxAge}.`;
  }
  if (rule.deployed) {
    // When the tests started, as the report says, else when Kollaudo received them.
    const ranAt = run.startedAt ?? run.createdAt;
    const before = history.filter((d) => d.deployedAt.getTime() <= Date.parse(ranAt)).at(-1);
    if (!before) {
      return `The latest run started at ${ranAt}, before any deployment Kollaudo knows of.`;
    }
    if (before.version !== version) {
      return `The latest run started at ${ranAt}, while ${before.version} was deployed, not ${version}.`;
    }
  }
  return undefined;
}

/**
 * Judges the latest run of each kind that counts. Every kind that ran is judged, and every required
 * kind must have a run that counts. `fail` wins over `unknown`, and `pass` needs at least one run.
 */
export function judge(
  byKind: Map<string, Candidate>,
  require: string[],
  rule: Pick<ResolvedRule, "flaky">,
): Pick<Verdict, "outcome" | "message" | "reasons"> {
  const kinds = [...new Set([...byKind.keys(), ...require])].sort();
  const reasons = kinds.map((kind) => reason(kind, byKind.get(kind), rule));
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

function reason(
  kind: string,
  candidate: Candidate | undefined,
  rule: Pick<ResolvedRule, "flaky">,
): VerdictReason {
  const run = candidate?.run;
  if (!run) {
    const message = candidate?.excluded ?? "Required, but no run.";
    return { kind, outcome: "unknown", message, run: null };
  }
  const { tests, failed, flaky } = run.summary;
  if (tests === 0) {
    return { kind, outcome: "unknown", message: "The latest run has no tests.", run };
  }
  const fails = failed > 0 || (rule.flaky === "fail" && flaky > 0);
  const note = failed === 0 && fails ? " (flaky tests fail it)" : "";
  return { kind, outcome: fails ? "fail" : "pass", message: `${counts(run)}${note}`, run };
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
