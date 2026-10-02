// Policies: the rules a verdict applies, kept by Kollaudo in revisions (ADR 0016).

import { type Policy, PolicyDocument, type Rule } from "@kollaudo/schema";
import { desc, eq, sql } from "drizzle-orm";
import { parseDocument } from "yaml";
import type { Db } from "./db/client.ts";
import { apiTokens, policies } from "./db/schema.ts";
import { HttpError } from "./errors.ts";
import { type FoundToken, matches, tokenLabel } from "./tokens.ts";

/** Reads a policy file, or explains each problem with its path. */
export function parsePolicy(source: string): PolicyDocument {
  const yaml = parseDocument(source, { uniqueKeys: true });
  if (yaml.errors.length > 0) {
    throw new HttpError(
      400,
      "invalid_policy",
      "The policy isn't valid YAML.",
      yaml.errors.map((error) => ({ path: "", message: error.message.split("\n")[0] ?? "" })),
    );
  }
  const result = PolicyDocument.safeParse(yaml.toJS() ?? {});
  if (!result.success) {
    throw new HttpError(
      400,
      "invalid_policy",
      "The policy isn't valid.",
      result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    );
  }
  return result.data;
}

/** Validates a policy and stores it as the next revision of the project. */
export async function pushPolicy(db: Db, token: FoundToken, source: string): Promise<Policy> {
  const document = parsePolicy(source);
  const [row] = await db
    .insert(policies)
    .values({
      projectId: token.projectId,
      // Pushes of one project are rare, and the unique key refuses a concurrent duplicate.
      revision: sql`(select coalesce(max(${policies.revision}), 0) + 1 from ${policies} where ${policies.projectId} = ${token.projectId})`,
      source,
      document,
      tokenId: token.id,
    })
    .returning();
  if (!row) throw new Error("Policy was not stored");
  return {
    revision: row.revision,
    source,
    document,
    sentBy: tokenLabel(token),
    createdAt: row.createdAt.toISOString(),
  };
}

/** The latest revision of the project's policy, or undefined if it has none. */
export async function currentPolicy(db: Db, projectId: string): Promise<Policy | undefined> {
  const [row] = await db
    .select({
      revision: policies.revision,
      source: policies.source,
      document: policies.document,
      createdAt: policies.createdAt,
      name: apiTokens.name,
      hint: apiTokens.hint,
    })
    .from(policies)
    .leftJoin(apiTokens, eq(policies.tokenId, apiTokens.id))
    .where(eq(policies.projectId, projectId))
    .orderBy(desc(policies.revision))
    .limit(1);
  if (!row) return undefined;
  return {
    revision: row.revision,
    source: row.source,
    document: row.document as PolicyDocument,
    sentBy: row.hint === null ? null : tokenLabel({ name: row.name, hint: row.hint }),
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ResolvedRule {
  /** Whether a rule of the policy matched, or the default rules apply. */
  fromPolicy: boolean;
  require: string[];
  deployed: boolean;
  flaky: "allow" | "fail";
  maxAge: string | null;
  from: string | null;
}

/**
 * The rules for a component in an environment: the entry for the component and the environment,
 * then the entry for the environment, matched by exact name before patterns, then `default`. Each
 * field set in a more specific entry replaces the one of a less specific entry.
 */
export function resolveRule(
  document: PolicyDocument | undefined,
  component: string,
  environment: string,
): ResolvedRule {
  const entries: Rule[] = [];
  if (document) {
    if (document.default) entries.push(document.default);
    const forEnvironment = matching(document.environments, environment);
    if (forEnvironment) entries.push(forEnvironment);
    const forComponent = matching(document.components?.[component]?.environments, environment);
    if (forComponent) entries.push(forComponent);
  }
  const rule = Object.assign({}, ...entries) as Rule;
  return {
    fromPolicy: entries.length > 0,
    require: [...new Set(rule.require ?? [])].sort(),
    deployed: rule.deployed ?? false,
    flaky: rule.flaky ?? "allow",
    maxAge: rule.maxAge ?? null,
    from: rule.from ?? null,
  };
}

/** The entry for an environment: its exact name, else the first pattern that matches it. */
function matching(rules: Record<string, Rule> | undefined, environment: string) {
  if (!rules) return undefined;
  if (Object.hasOwn(rules, environment)) return rules[environment];
  const pattern = Object.keys(rules).find((key) => key.includes("*") && matches(key, environment));
  return pattern === undefined ? undefined : rules[pattern];
}

/** "7d" as milliseconds. */
export function duration(maxAge: string): number {
  const unit = { m: 60_000, h: 3_600_000, d: 86_400_000 }[maxAge.slice(-1) as "m" | "h" | "d"];
  return Number(maxAge.slice(0, -1)) * unit;
}
