// Policies: the rules a verdict applies, kept by Kollaudo (ADR 0016).

import { z } from "zod";
import { KIND_PATTERN, Name, Timestamp } from "./test-runs.ts";

/** An environment name, or a pattern where `*` stands for any characters, such as `pr-*`. */
const EnvironmentPattern = z
  .string()
  .regex(
    /^[A-Za-z0-9*][A-Za-z0-9._/*-]{0,99}$/,
    "Use an environment name, or a pattern with * for any characters.",
  );

export const Rule = z
  .strictObject({
    require: z
      .array(z.string().regex(new RegExp(`^${KIND_PATTERN}$`), "Use kinds such as e2e or smoke."))
      .optional()
      .meta({ description: "Kinds of test that must have a run, such as e2e and smoke." }),
    deployed: z
      .boolean()
      .optional()
      .meta({
        description:
          "When true, a test run counts only if the tested version was the one deployed in the " +
          "environment when the run happened.",
      }),
    flaky: z.enum(["allow", "fail"]).optional().meta({
      description: "allow (default): flaky tests that passed don't fail a run. fail: they do.",
    }),
    maxAge: z
      .string()
      .regex(/^[1-9][0-9]*[mhd]$/, "Use a number and m, h or d, such as 30m, 12h or 7d.")
      .optional()
      .meta({ description: "Older test runs don't count, such as 7d." }),
    from: Name.optional().meta({
      description: "The environment versions come from before this one, such as staging.",
    }),
  })
  .meta({ id: "Rule" });
export type Rule = z.infer<typeof Rule>;

/** The content of a policy file. */
export const PolicyDocument = z
  .strictObject({
    default: Rule.optional().meta({
      description: "Rules for environments that no other entry matches.",
    }),
    environments: z.record(EnvironmentPattern, Rule).optional(),
    components: z
      .record(Name, z.strictObject({ environments: z.record(EnvironmentPattern, Rule) }))
      .optional()
      .meta({ description: "Rules for one component, which replace those of the environment." }),
  })
  .meta({ id: "PolicyDocument" });
export type PolicyDocument = z.infer<typeof PolicyDocument>;

export const PolicyInput = z
  .object({
    source: z
      .string()
      .min(1)
      .max(200_000)
      .meta({ description: "The policy file, in YAML, as written. Kollaudo keeps it as sent." }),
  })
  .meta({ id: "PolicyInput" });
export type PolicyInput = z.infer<typeof PolicyInput>;

export const Policy = z
  .object({
    revision: z
      .number()
      .int()
      .meta({ description: "1 for the first policy, then one more per push." }),
    source: z.string(),
    document: PolicyDocument,
    sentBy: z.string().nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: "Policy" });
export type Policy = z.infer<typeof Policy>;

/** The rules a verdict applied, and where they came from. */
export const AppliedPolicy = z
  .object({
    name: z.enum(["default", "project"]).meta({
      description:
        "default: the project has no policy, or none of it matches. project: its policy.",
    }),
    revision: z
      .number()
      .int()
      .nullable()
      .meta({ description: "The revision of the project's policy." }),
    require: z.array(z.string()).meta({
      description: "Kinds that must have a run: from the policy, and from the request.",
    }),
    deployed: z.boolean(),
    flaky: z.enum(["allow", "fail"]),
    maxAge: z.string().nullable(),
  })
  .meta({ id: "AppliedPolicy" });
export type AppliedPolicy = z.infer<typeof AppliedPolicy>;
