import { z } from "zod";
import { CtrfReport, CtrfStatus } from "./ctrf.ts";

/** Names of components and environments: they end up in URLs and CLI output. */
export const Name = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/,
    'Use up to 100 letters, digits, ".", "_", "/" or "-", starting with a letter or digit.',
  );

/** Versions are opaque identifiers chosen by the user (ADR 0004). */
export const VersionName = z.string().min(1).max(255).regex(/^\S+$/, "Must not contain spaces.");

export const Metadata = z.string().min(1).max(255);

/** Kinds of test run, such as `e2e`. */
export const KIND_PATTERN = "[a-z][a-z0-9-]{0,31}";

export const TestRunInput = z
  .object({
    component: Name.meta({ example: "frontend" }),
    version: VersionName.meta({ example: "1.2.0" }),
    environment: Name.optional().meta({
      description: "Where the tests ran. Leave it out for build-level tests, such as unit tests.",
      example: "staging",
    }),
    kind: z
      .string()
      .regex(new RegExp(`^${KIND_PATTERN}$`))
      .default("e2e")
      .meta({ description: "unit, e2e, smoke, uat, manual…", example: "e2e" }),
    commit: Metadata.optional(),
    branch: Metadata.optional(),
    tag: Metadata.optional(),
    pullRequest: Metadata.optional(),
    digest: Metadata.optional().meta({
      description: "Digest of the artifact that was built, such as a container image digest.",
      example: "sha256:4f5c2d7e…",
    }),
    report: CtrfReport,
  })
  .meta({ id: "TestRunInput" });
export type TestRunInput = z.input<typeof TestRunInput>;

export const TestRunSummary = z
  .object({
    tests: z.number().int(),
    passed: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
    pending: z.number().int(),
    other: z.number().int(),
    flaky: z.number().int(),
  })
  .meta({ id: "TestRunSummary" });
export type TestRunSummary = z.infer<typeof TestRunSummary>;

export const TestRunCreated = z
  .object({
    id: z.uuid(),
    component: z.string(),
    version: z.string(),
    environment: z.string().nullable(),
    kind: z.string(),
    summary: TestRunSummary,
  })
  .meta({ id: "TestRunCreated" });
export type TestRunCreated = z.infer<typeof TestRunCreated>;

export const Timestamp = z.iso.datetime({ offset: true });

export const TestRun = TestRunCreated.extend({
  commit: z.string().nullable(),
  branch: z.string().nullable(),
  tag: z.string().nullable(),
  pullRequest: z.string().nullable(),
  digest: z.string().nullable(),
  tool: z.string().nullable().meta({ example: "playwright" }),
  sentBy: z
    .string()
    .nullable()
    .meta({ description: "The name of the token that sent the run, or the start of the token." }),
  startedAt: Timestamp.nullable(),
  finishedAt: Timestamp.nullable(),
  createdAt: Timestamp.meta({ description: "When Kollaudo received the run." }),
}).meta({ id: "TestRun" });
export type TestRun = z.infer<typeof TestRun>;

export const TestResult = z
  .object({
    id: z.uuid(),
    name: z.string(),
    suite: z.array(z.string()),
    file: z.string().nullable(),
    status: CtrfStatus,
    durationMs: z.number().int(),
    message: z.string().nullable(),
    trace: z.string().nullable(),
    retries: z.number().int(),
    flaky: z.boolean(),
    tags: z.array(z.string()),
    extra: z
      .record(z.string(), z.unknown())
      .nullable()
      .meta({ description: "Fields of the CTRF test that Kollaudo doesn't model, as sent." }),
  })
  .meta({ id: "TestResult" });
export type TestResult = z.infer<typeof TestResult>;

export const TestRunDetail = TestRun.extend({ results: z.array(TestResult) }).meta({
  id: "TestRunDetail",
});
export type TestRunDetail = z.infer<typeof TestRunDetail>;

export const TestRunQuery = z.object({
  component: z.string().optional(),
  environment: z.string().optional(),
  version: z.string().optional(),
  kind: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.uuid().optional().meta({ description: "The `next` value of the previous page." }),
});

export const TestRunList = z
  .object({
    items: z.array(TestRun).meta({ description: "Newest first." }),
    next: z
      .uuid()
      .nullable()
      .meta({ description: "Pass it as `before` to get the next page. Null on the last page." }),
  })
  .meta({ id: "TestRunList" });
export type TestRunList = z.infer<typeof TestRunList>;
