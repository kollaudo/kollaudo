// The log of the verdicts Kollaudo gives (ADR 0019): who asked about what, and what they were told.

import type { GivenVerdict, GivenVerdictList, GivenVerdictQuery, Verdict } from "@kollaudo/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "./db/client.ts";
import { apiTokens, verdicts } from "./db/schema.ts";
import { type FoundToken, tokenLabel } from "./tokens.ts";

type Query = z.output<typeof GivenVerdictQuery>;

/** Records a verdict as it was given to a token. */
export async function recordVerdict(db: Db, token: FoundToken, verdict: Verdict): Promise<void> {
  await db.insert(verdicts).values({
    projectId: token.projectId,
    component: verdict.component,
    environment: verdict.environment,
    version: verdict.version,
    outcome: verdict.outcome,
    evidenceOutcome: verdict.evidenceOutcome,
    message: verdict.message,
    policyRevision: verdict.policy.revision,
    require: verdict.policy.require,
    overrideId: verdict.override?.id ?? null,
    tokenId: token.id,
  });
}

/** Lists the verdicts given in a project, newest first, one page at a time. */
export async function listVerdicts(
  db: Db,
  projectId: string,
  query: Query,
): Promise<GivenVerdictList> {
  const rows = await db
    .select({
      id: verdicts.id,
      component: verdicts.component,
      environment: verdicts.environment,
      version: verdicts.version,
      outcome: verdicts.outcome,
      evidenceOutcome: verdicts.evidenceOutcome,
      message: verdicts.message,
      policyRevision: verdicts.policyRevision,
      require: verdicts.require,
      overrideId: verdicts.overrideId,
      askedByName: apiTokens.name,
      askedByHint: apiTokens.hint,
      createdAt: verdicts.createdAt,
    })
    .from(verdicts)
    .leftJoin(apiTokens, eq(verdicts.tokenId, apiTokens.id))
    .where(
      and(
        eq(verdicts.projectId, projectId),
        query.component ? eq(verdicts.component, query.component) : undefined,
        query.environment ? eq(verdicts.environment, query.environment) : undefined,
        query.version ? eq(verdicts.version, query.version) : undefined,
        query.outcome ? eq(verdicts.outcome, query.outcome) : undefined,
        // Keyset pagination, as for test runs: older than the cursor, compared in SQL.
        query.before
          ? sql`(${verdicts.createdAt}, ${verdicts.id}) <
              (select cursor.created_at, cursor.id from verdicts cursor where cursor.id = ${query.before})`
          : undefined,
      ),
    )
    .orderBy(desc(verdicts.createdAt), desc(verdicts.id))
    .limit(query.limit + 1);

  const items = rows.slice(0, query.limit).map(
    ({ askedByName, askedByHint, ...row }): GivenVerdict => ({
      ...row,
      askedBy: askedByHint === null ? null : tokenLabel({ name: askedByName, hint: askedByHint }),
      createdAt: row.createdAt.toISOString(),
    }),
  );
  const next = rows.length > query.limit ? (items.at(-1)?.id ?? null) : null;
  return { items, next };
}
