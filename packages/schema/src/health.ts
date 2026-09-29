import { z } from "zod";
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
  })
  .meta({ id: "HealthMatrix" });
export type HealthMatrix = z.infer<typeof HealthMatrix>;
