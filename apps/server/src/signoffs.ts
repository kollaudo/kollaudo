// A sign-off is a test run of a kind with one test, given by a person with a `signoff` token
// (ADR 0021). The verdict judges it like any other run, and a policy can require it.

import type { Signoff, SignoffInput, SignoffList, SignoffQuery } from "@kollaudo/schema";
import { and, desc, eq, type SQL } from "drizzle-orm";
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
import { HttpError } from "./errors.ts";
import { componentIdFor, environmentIdFor, versionIdFor } from "./first-use.ts";
import { type FoundToken, outsideLimits, tokenLabel } from "./tokens.ts";

type Input = z.output<typeof SignoffInput>;
type Query = z.output<typeof SignoffQuery>;

/** The most sign-offs a listing returns. */
const LIST_LIMIT = 500;

const signoffColumns = {
  id: testRuns.id,
  component: components.name,
  environment: environments.name,
  version: versions.name,
  kind: testRuns.kind,
  failed: testRuns.failed,
  note: testRuns.note,
  byName: apiTokens.name,
  byHint: apiTokens.hint,
  createdAt: testRuns.createdAt,
};

function selectSignoffs(db: Db, projectId: string, ...conditions: (SQL | undefined)[]) {
  return db
    .select(signoffColumns)
    .from(testRuns)
    .innerJoin(versions, eq(testRuns.versionId, versions.id))
    .innerJoin(components, eq(versions.componentId, components.id))
    .innerJoin(environments, eq(testRuns.environmentId, environments.id))
    .leftJoin(apiTokens, eq(testRuns.tokenId, apiTokens.id))
    .where(and(eq(components.projectId, projectId), eq(testRuns.signoff, true), ...conditions));
}

type SignoffRow = Awaited<ReturnType<typeof selectSignoffs>>[number];

function toSignoff({ byName, byHint, failed, createdAt, ...row }: SignoffRow): Signoff {
  return {
    ...row,
    outcome: failed > 0 ? "fail" : "pass",
    by: byHint === null ? null : tokenLabel({ name: byName, hint: byHint }),
    createdAt: createdAt.toISOString(),
  };
}

/**
 * Stores a sign-off as a test run with one test. The component, environment and version are
 * created on first use (ADR 0005). Giving it again adds a run: the latest one counts.
 */
export async function createSignoff(db: Db, token: FoundToken, input: Input): Promise<Signoff> {
  const refused = outsideLimits(token, input.component, input.environment);
  if (refused) throw new HttpError(403, "outside_token_limits", refused);

  const passed = input.outcome === "pass";
  const id = await db.transaction(async (tx) => {
    const componentId = await componentIdFor(tx, token.projectId, input.component);
    const environmentId = await environmentIdFor(tx, token.projectId, input.environment);
    const versionId = await versionIdFor(tx, componentId, input);
    const [run] = await tx
      .insert(testRuns)
      .values({
        versionId,
        environmentId,
        kind: input.kind,
        signoff: true,
        note: input.note || null,
        tokenId: token.id,
        tests: 1,
        passed: passed ? 1 : 0,
        failed: passed ? 0 : 1,
        skipped: 0,
        pending: 0,
        other: 0,
        flaky: 0,
      })
      .returning({ id: testRuns.id });
    if (!run) throw new Error("Sign-off was not created");
    await tx.insert(testResults).values({
      testRunId: run.id,
      name: `${input.kind} sign-off`,
      status: passed ? "passed" : "failed",
      durationMs: 0,
      message: input.note || null,
      retries: 0,
      flaky: false,
    });
    return run.id;
  });
  const [row] = await selectSignoffs(db, token.projectId, eq(testRuns.id, id));
  if (!row) throw new Error("Sign-off was not found after creating it");
  return toSignoff(row);
}

/** Every sign-off of the project, newest first: earlier ones stay, as a record of who said what. */
export async function listSignoffs(db: Db, projectId: string, query: Query): Promise<SignoffList> {
  const rows = await selectSignoffs(
    db,
    projectId,
    query.component ? eq(components.name, query.component) : undefined,
    query.environment ? eq(environments.name, query.environment) : undefined,
    query.version ? eq(versions.name, query.version) : undefined,
    query.kind ? eq(testRuns.kind, query.kind) : undefined,
  )
    .orderBy(desc(testRuns.createdAt), desc(testRuns.id))
    .limit(LIST_LIMIT);
  return { items: rows.map(toSignoff) };
}
