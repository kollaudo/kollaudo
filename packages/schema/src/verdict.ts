import { z } from "zod";
import { Deployment } from "./deployments.ts";
import { Override } from "./overrides.ts";
import { AppliedPolicy } from "./policy.ts";
import { KIND_PATTERN, TestRun, Timestamp } from "./test-runs.ts";

export const VerdictOutcome = z.enum(["pass", "fail", "unknown"]).meta({
  id: "VerdictOutcome",
  description: "`unknown` means that evidence is missing. It never counts as a pass (ADR 0013).",
});
export type VerdictOutcome = z.infer<typeof VerdictOutcome>;

export const VerdictQuery = z.object({
  component: z.string().min(1).meta({ example: "frontend" }),
  environment: z.string().min(1).meta({ example: "staging" }),
  version: z.string().min(1).meta({ example: "1.2.0" }),
  require: z
    .string()
    .regex(
      new RegExp(`^${KIND_PATTERN}(,${KIND_PATTERN})*$`),
      "Give kinds separated by commas, such as e2e,smoke.",
    )
    .optional()
    .meta({
      description:
        "Kinds that must have a run in the environment, separated by commas. They add to the " +
        "policy: they can't relax it.",
      example: "e2e,smoke",
    }),
  record: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
    .meta({
      description:
        "false asks without being a gate, as the web UI does: the verdict isn't recorded in the " +
        "log, so it doesn't count as the pass that makes a deployment gated (ADR 0019).",
    }),
});

export const VerdictReason = z
  .object({
    kind: z.string(),
    outcome: VerdictOutcome,
    message: z.string().meta({ example: "1 failed, 41 passed" }),
    run: TestRun.nullable().meta({ description: "The latest run of this kind, if any." }),
  })
  .meta({ id: "VerdictReason" });
export type VerdictReason = z.infer<typeof VerdictReason>;

export const Verdict = z
  .object({
    component: z.string(),
    environment: z.string(),
    version: z.string(),
    outcome: VerdictOutcome,
    message: z.string().meta({ example: "e2e failed." }),
    policy: AppliedPolicy.meta({ description: "The rules this verdict applied (ADR 0016)." }),
    reasons: z.array(VerdictReason).meta({ description: "One for each kind, by name." }),
    deployed: Deployment.nullable().meta({
      description:
        "What runs in the environment now, if Kollaudo knows. It doesn't change the outcome: when " +
        "it's another version, the tests judged a version that no longer runs there, or not yet.",
    }),
    override: Override.nullable().meta({
      description:
        "An active override for this version in this environment (ADR 0018). It makes the outcome " +
        "pass; evidenceOutcome says what the evidence alone gives.",
    }),
    evidenceOutcome: VerdictOutcome.meta({
      description: "The outcome of the evidence alone, without an override.",
    }),
  })
  .meta({ id: "Verdict" });
export type Verdict = z.infer<typeof Verdict>;

/**
 * A verdict Kollaudo gave, as it was given (ADR 0019). The log records the answers: later verdicts
 * are still computed from the evidence, not read from it.
 */
export const GivenVerdict = z
  .object({
    id: z.uuid(),
    component: z.string(),
    environment: z.string(),
    version: z.string(),
    outcome: VerdictOutcome,
    evidenceOutcome: VerdictOutcome.meta({
      description: "The outcome of the evidence alone: it differs from outcome under an override.",
    }),
    message: z.string(),
    policyRevision: z
      .number()
      .int()
      .nullable()
      .meta({ description: "The policy revision of the project, null without a policy." }),
    require: z.array(z.string()).meta({ description: "The kinds the verdict required." }),
    overrideId: z
      .uuid()
      .nullable()
      .meta({ description: "The override that let the version through, if any." }),
    askedBy: z
      .string()
      .nullable()
      .meta({ description: "The name of the token that asked, or the start of the token." }),
    createdAt: Timestamp,
  })
  .meta({ id: "GivenVerdict" });
export type GivenVerdict = z.infer<typeof GivenVerdict>;

export const GivenVerdictQuery = z.object({
  component: z.string().optional(),
  environment: z.string().optional(),
  version: z.string().optional(),
  outcome: VerdictOutcome.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.uuid().optional().meta({ description: "The `next` value of the previous page." }),
});

export const GivenVerdictList = z
  .object({
    items: z.array(GivenVerdict).meta({ description: "Newest first." }),
    next: z
      .uuid()
      .nullable()
      .meta({ description: "Pass it as `before` to get the next page. Null on the last page." }),
  })
  .meta({ id: "GivenVerdictList" });
export type GivenVerdictList = z.infer<typeof GivenVerdictList>;
