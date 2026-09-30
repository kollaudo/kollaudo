import { z } from "zod";
import { KIND_PATTERN, TestRun } from "./test-runs.ts";

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
    policy: z
      .object({
        name: z.literal("default"),
        require: z.array(z.string()).meta({ description: "Kinds that must have a run." }),
      })
      .meta({ description: "The rules this verdict applied (ADR 0014)." }),
    reasons: z.array(VerdictReason).meta({ description: "One for each kind, by name." }),
  })
  .meta({ id: "Verdict" });
export type Verdict = z.infer<typeof Verdict>;
