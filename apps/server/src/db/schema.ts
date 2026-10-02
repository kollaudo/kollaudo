// Database schema for the internal model (ADR 0004). Migrations in `drizzle/` are generated from
// this file with `pnpm db:generate`.

import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid().primaryKey().defaultRandom();
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const projects = pgTable("projects", {
  id: id(),
  name: text().notNull().unique(),
  createdAt: createdAt(),
});

export const tokenScope = pgEnum("token_scope", ["ingest", "read", "policy", "override"]);

/** API tokens (ADR 0007). Only the SHA-256 hash of a token is stored. */
export const apiTokens = pgTable("api_tokens", {
  id: id(),
  projectId: uuid()
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  scope: tokenScope().notNull(),
  hash: text().notNull().unique(),
  /** First characters of the token, to recognize it in listings. */
  hint: text().notNull(),
  /** A name for people, such as `ci-staging`, shown wherever the token appears. */
  name: text(),
  /**
   * Limits of an `ingest` token (ADR 0017): names or `*` patterns of the components and environments
   * it may send data for. Null means no limit.
   */
  components: text().array(),
  environments: text().array(),
  /** Whether a token limited to environments may also send build-level runs. */
  build: boolean().notNull().default(true),
  createdAt: createdAt(),
  lastUsedAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
});

export const components = pgTable(
  "components",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.projectId, t.name)],
);

export const environments = pgTable(
  "environments",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.projectId, t.name)],
);

/** A version of a component: an opaque identifier with optional metadata (ADR 0004, 0005). */
export const versions = pgTable(
  "versions",
  {
    id: id(),
    componentId: uuid()
      .notNull()
      .references(() => components.id, { onDelete: "cascade" }),
    name: text().notNull(),
    commit: text(),
    branch: text(),
    tag: text(),
    pullRequest: text(),
    /** Digest of the built artifact, such as a container image digest. */
    digest: text(),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.componentId, t.name)],
);

/**
 * A test session on a version. Without an environment it is build level (unit, static analysis),
 * with an environment it is environment level (e2e, smoke, UAT…).
 */
export const testRuns = pgTable(
  "test_runs",
  {
    id: id(),
    versionId: uuid()
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    environmentId: uuid().references(() => environments.id, { onDelete: "cascade" }),
    kind: text().notNull(),
    /** Name of the tool that produced the report, such as `playwright`. */
    tool: text(),
    /** The token that sent the run (ADR 0017). */
    tokenId: uuid().references(() => apiTokens.id, { onDelete: "set null" }),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
    tests: integer().notNull(),
    passed: integer().notNull(),
    failed: integer().notNull(),
    skipped: integer().notNull(),
    pending: integer().notNull(),
    other: integer().notNull(),
    flaky: integer().notNull(),
    /** Report fields Kollaudo doesn't model, kept as sent. */
    extra: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.versionId, t.environmentId, t.createdAt), index().on(t.environmentId)],
);

/** A version of a component that started running in an environment, at a point in time. */
export const deployments = pgTable(
  "deployments",
  {
    id: id(),
    versionId: uuid()
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    environmentId: uuid()
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    /** Name of the tool that deployed it, such as `argocd`. */
    tool: text(),
    /** The token that sent the deployment (ADR 0017). */
    tokenId: uuid().references(() => apiTokens.id, { onDelete: "set null" }),
    deployedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.environmentId, t.deployedAt), index().on(t.versionId)],
);

/** Revisions of a project's policy (ADR 0016). The latest one applies. */
export const policies = pgTable(
  "policies",
  {
    id: id(),
    projectId: uuid()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    revision: integer().notNull(),
    /** The file as it was sent, with its comments. */
    source: text().notNull(),
    /** The file as validated: what verdicts apply. */
    document: jsonb().notNull(),
    tokenId: uuid().references(() => apiTokens.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.projectId, t.revision)],
);

/** A version let through a gate in an environment, for a while (ADR 0018). */
export const overrides = pgTable(
  "overrides",
  {
    id: id(),
    versionId: uuid()
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    environmentId: uuid()
      .notNull()
      .references(() => environments.id, { onDelete: "cascade" }),
    reason: text().notNull(),
    tokenId: uuid().references(() => apiTokens.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    revokedAt: timestamp({ withTimezone: true }),
  },
  (t) => [index().on(t.versionId, t.environmentId)],
);

export const testStatus = pgEnum("test_status", [
  "passed",
  "failed",
  "skipped",
  "pending",
  "other",
]);

export const testResults = pgTable(
  "test_results",
  {
    id: id(),
    testRunId: uuid()
      .notNull()
      .references(() => testRuns.id, { onDelete: "cascade" }),
    name: text().notNull(),
    suite: text().array(),
    file: text(),
    status: testStatus().notNull(),
    durationMs: integer().notNull(),
    message: text(),
    trace: text(),
    retries: integer().notNull().default(0),
    flaky: boolean().notNull().default(false),
    tags: text().array(),
    extra: jsonb(),
  },
  (t) => [index().on(t.testRunId)],
);
