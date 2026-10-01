import { z } from "zod";
import { Deployment } from "./deployments.ts";
import { TestRun } from "./test-runs.ts";

/** The component × environment matrix of a project. */
export const HealthMatrix = z
  .object({
    components: z.array(z.string()),
    environments: z.array(z.string()),
    latest: z.array(TestRun).meta({
      description:
        "The latest run for each component, environment and kind. Build-level runs have a null " +
        "environment.",
    }),
    deployed: z.array(Deployment).meta({
      description:
        "What runs now: the latest deployment of each component in each environment. A component " +
        "that was never deployed to an environment has none there.",
    }),
  })
  .meta({ id: "HealthMatrix" });
export type HealthMatrix = z.infer<typeof HealthMatrix>;
