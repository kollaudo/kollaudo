import type {
  Bug,
  Deployment,
  TestResult,
  TestRun,
  TestRunSummary,
  Verdict,
} from "@kollaudo/schema";

export type Outcome = "failed" | "passed" | "empty";

/** The color of a run: red if any test failed, green if tests passed, gray otherwise. */
export function outcome(summary: TestRunSummary): Outcome {
  if (summary.failed > 0) return "failed";
  if (summary.passed > 0) return "passed";
  return "empty";
}

export interface SuiteGroup {
  suite: string[];
  results: TestResult[];
  failed: number;
}

const STATUS_ORDER = ["failed", "other", "pending", "skipped", "passed"];

/** Groups results by suite. Suites and tests with failures come first. */
export function groupBySuite(results: TestResult[]): SuiteGroup[] {
  const groups = new Map<string, SuiteGroup>();
  for (const result of results) {
    const key = result.suite.join("\u0000");
    let group = groups.get(key);
    if (!group) {
      group = { suite: result.suite, results: [], failed: 0 };
      groups.set(key, group);
    }
    group.results.push(result);
    if (result.status === "failed") group.failed++;
  }

  for (const group of groups.values()) {
    group.results.sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
  }
  return [...groups.values()].sort((a, b) => Number(b.failed > 0) - Number(a.failed > 0));
}

// Environments usually go from development to production. Kollaudo doesn't know their order, so
// the matrix guesses it from common names, and falls back to alphabetical order.
// The first matching pattern wins: "preview" and "preprod" aren't production.
const STAGES: [RegExp, number][] = [
  [/preview|review|pr-?\d/i, 1],
  [/stag|uat|pre/i, 3],
  [/prod/i, 5],
  // "qua" and "quality": a common name in Italy and elsewhere for the environment before production.
  [/test|qa|qua|int/i, 2],
  [/dev|local/i, 0],
];

function stage(environment: string) {
  return STAGES.find(([pattern]) => pattern.test(environment))?.[1] ?? 4;
}

export function sortEnvironments(environments: string[]) {
  return [...environments].sort((a, b) => stage(a) - stage(b) || a.localeCompare(b));
}

/**
 * The version whose verdict a cell of the matrix shows: the one deployed in the environment, which
 * is the one a gate asks about, else the newest one tested there.
 */
export function versionToJudge(runs: TestRun[], deployed?: Deployment) {
  if (deployed) return deployed.version;
  return runs.reduce<TestRun | undefined>(
    (newest, run) => (newest && newest.createdAt >= run.createdAt ? newest : run),
    undefined,
  )?.version;
}

/** The name a link to a bug uses for a test (ADR 0022): its suite and its name, joined by " › ". */
export function testName(result: Pick<TestResult, "suite" | "name">) {
  return [...result.suite, result.name].join(" › ");
}

/** The open bugs of a component by the name of the test they are linked to. */
export function bugsByTest(bugs: Bug[]) {
  const byTest = new Map<string, { key: string; url: string }[]>();
  for (const bug of bugs) {
    if (bug.state !== "open") continue;
    for (const test of bug.tests) {
      byTest.set(test, [...(byTest.get(test) ?? []), { key: bug.key, url: bug.url }]);
    }
  }
  return byTest;
}

/**
 * The keys of the bugs in a failed verdict when every failure has one, else undefined. A failed
 * kind with no listed test, such as a sign-off or flaky tests that fail the run, isn't known.
 */
export function knownBugs(verdict: Verdict) {
  const failed = verdict.reasons.filter((reason) => reason.outcome === "fail");
  if (verdict.outcome !== "fail" && verdict.evidenceOutcome !== "fail") return undefined;
  if (failed.length === 0) return undefined;
  const failures = failed.map((reason) => reason.failures ?? []);
  if (failures.some((list) => list.length === 0 || list.some((f) => !f.bug))) return undefined;
  return [...new Set(failures.flat().flatMap((f) => (f.bug ? [f.bug.key] : [])))];
}
