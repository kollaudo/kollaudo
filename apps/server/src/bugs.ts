// Known bugs linked to failed tests (ADR 0022). A link ties one bug to one test of one component,
// and holds for every version and environment until the bug is closed. It never changes a verdict.

import type { Bug, BugInput, BugList, BugQuery } from "@kollaudo/schema";
import { and, desc, eq, type SQL } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "./db/client.ts";
import { apiTokens, bugLinks, components } from "./db/schema.ts";
import { HttpError } from "./errors.ts";
import { componentIdFor } from "./first-use.ts";
import { type FoundToken, outsideLimits, tokenLabel } from "./tokens.ts";

type Input = z.output<typeof BugInput>;
type Query = z.output<typeof BugQuery>;

/** The most links a listing reads. */
const LIST_LIMIT = 2000;

/**
 * Creates or updates the links of a bug in a component. Each test of the request gets a link, a
 * link that exists is updated, and the others of the bug stay. Sending the bug as `closed` closes
 * every link it has, so the request can leave the tests out.
 */
export async function saveBug(db: Db, token: FoundToken, input: Input): Promise<Bug> {
  // A link is per component, not per environment (ADR 0022): only the token's components apply.
  const refused = outsideLimits(
    { components: token.components, environments: null, build: true },
    input.component,
    null,
  );
  if (refused) throw new HttpError(403, "outside_token_limits", refused);

  const now = new Date();
  const tests = [...new Set(input.tests)];
  await db.transaction(async (tx) => {
    const componentId = await componentIdFor(tx, token.projectId, input.component);
    const sent = { url: input.url, state: input.state, tokenId: token.id, updatedAt: now };
    if (tests.length > 0) {
      await tx
        .insert(bugLinks)
        .values(tests.map((test) => ({ componentId, key: input.key, test, ...sent })))
        .onConflictDoUpdate({
          target: [bugLinks.componentId, bugLinks.key, bugLinks.test],
          set: {
            url: sent.url,
            state: sent.state,
            tokenId: sent.tokenId,
            updatedAt: sent.updatedAt,
          },
        });
    }
    // The URL belongs to the bug, so every link of it follows. A closed bug closes them all.
    await tx
      .update(bugLinks)
      .set(input.state === "closed" ? sent : { url: sent.url })
      .where(and(eq(bugLinks.componentId, componentId), eq(bugLinks.key, input.key)));
  });

  const { items } = await listBugs(db, token.projectId, {
    component: input.component,
    key: input.key,
  });
  const [bug] = items;
  if (!bug) throw new Error("Bug was not found after saving it");
  return bug;
}

/** The bugs of the project, each with the tests it is linked to, the last one sent first. */
export async function listBugs(db: Db, projectId: string, query: Query): Promise<BugList> {
  const conditions: (SQL | undefined)[] = [
    eq(components.projectId, projectId),
    query.component ? eq(components.name, query.component) : undefined,
    query.key ? eq(bugLinks.key, query.key) : undefined,
    query.state ? eq(bugLinks.state, query.state) : undefined,
  ];
  const rows = await db
    .select({
      component: components.name,
      key: bugLinks.key,
      url: bugLinks.url,
      state: bugLinks.state,
      test: bugLinks.test,
      byName: apiTokens.name,
      byHint: apiTokens.hint,
      updatedAt: bugLinks.updatedAt,
    })
    .from(bugLinks)
    .innerJoin(components, eq(bugLinks.componentId, components.id))
    .leftJoin(apiTokens, eq(bugLinks.tokenId, apiTokens.id))
    .where(and(...conditions))
    .orderBy(desc(bugLinks.updatedAt), bugLinks.test)
    .limit(LIST_LIMIT);

  // Rows come newest first, so the first row of a bug tells its url, state and author.
  const bugs = new Map<string, Bug>();
  for (const row of rows) {
    const id = `${row.component}\0${row.key}`;
    const bug = bugs.get(id);
    if (bug) {
      bug.tests.push(row.test);
      continue;
    }
    bugs.set(id, {
      key: row.key,
      url: row.url,
      state: row.state,
      component: row.component,
      tests: [row.test],
      by: row.byHint === null ? null : tokenLabel({ name: row.byName, hint: row.byHint }),
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  return { items: [...bugs.values()] };
}
