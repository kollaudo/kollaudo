// Which failed tests of a verdict have a known bug (ADR 0022). A known bug never changes the
// outcome: it only says whether a failure is new.

import type { FailedTest, UnmatchedBug } from "@kollaudo/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { bugLinks, components, testResults } from "./db/schema.ts";
import type { Candidate } from "./verdict.ts";

/** The most failed tests a verdict reads for all its runs. */
const FAILURES_PER_VERDICT = 1000;

export interface KnownFailures {
  /** The failed tests of each kind's run. */
  byKind: Map<string, FailedTest[]>;
  /** Open bugs whose test didn't fail in any of the runs. */
  unmatched: UnmatchedBug[];
}

/** A test is named by its suite and its name, as a report shows it. */
export function testName(suite: string[] | null, name: string) {
  return [...(suite ?? []), name].join(" › ");
}

/**
 * Matches the failed tests of the runs that count with the open bugs of the component. Reads
 * nothing when no run has a failed test, which is most verdicts.
 */
export async function knownFailures(
  db: Db,
  projectId: string,
  component: string,
  byKind: Map<string, Candidate>,
): Promise<KnownFailures> {
  const failing = [...byKind.entries()].flatMap(([kind, { run }]) =>
    run && !run.signoff && run.summary.failed > 0 ? [{ kind, run }] : [],
  );
  const known: KnownFailures = { byKind: new Map(), unmatched: [] };
  if (failing.length === 0) return known;

  const [failed, links] = await Promise.all([
    db
      .select({ runId: testResults.testRunId, suite: testResults.suite, name: testResults.name })
      .from(testResults)
      .where(
        and(
          inArray(
            testResults.testRunId,
            failing.map(({ run }) => run.id),
          ),
          eq(testResults.status, "failed"),
        ),
      )
      .orderBy(asc(testResults.name))
      .limit(FAILURES_PER_VERDICT),
    db
      .select({
        key: bugLinks.key,
        url: bugLinks.url,
        state: bugLinks.state,
        test: bugLinks.test,
      })
      .from(bugLinks)
      .innerJoin(components, eq(bugLinks.componentId, components.id))
      .where(
        and(
          eq(components.projectId, projectId),
          eq(components.name, component),
          eq(bugLinks.state, "open"),
        ),
      )
      .orderBy(asc(bugLinks.key)),
  ]);

  // A test with several open bugs shows the first by key.
  const bugOf = new Map<string, (typeof links)[number]>();
  for (const link of links) if (!bugOf.has(link.test)) bugOf.set(link.test, link);

  const seen = new Set<string>();
  for (const { kind, run } of failing) {
    const tests = [
      ...new Set(failed.filter((f) => f.runId === run.id).map((f) => testName(f.suite, f.name))),
    ];
    for (const test of tests) seen.add(test);
    known.byKind.set(
      kind,
      tests.map((test) => {
        const link = bugOf.get(test);
        return { test, bug: link ? { key: link.key, url: link.url, state: link.state } : null };
      }),
    );
  }
  known.unmatched = links
    .filter((link) => !seen.has(link.test))
    .map(({ key, url, test }) => ({ key, url, test }));
  return known;
}
