// Known bugs linked to failed tests (ADR 0022). A link ties one bug to one test of one component.

import { z } from "zod";
import { Name, Timestamp } from "./test-runs.ts";

export const BugState = z.enum(["open", "closed"]);
export type BugState = z.infer<typeof BugState>;

const TestName = z.string().trim().min(1).max(500).meta({
  description:
    "The name of the test as it appears in the reports: its suite and its name, joined by ' › '.",
  example: "checkout › pays with a saved card",
});

export const BugInput = z
  .object({
    key: z
      .string()
      .min(1)
      .max(100)
      .regex(/^\S+$/, "Must not contain spaces.")
      .meta({ description: "The key of the bug in the tracker.", example: "SHOP-412" }),
    url: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .meta({ example: "https://example.atlassian.net/browse/SHOP-412" }),
    state: BugState.default("open"),
    component: Name.meta({ example: "checkout" }),
    tests: z
      .array(TestName)
      .max(100)
      .default([])
      .meta({
        description:
          "The tests that fail because of the bug. Needed to open a bug. A closed bug closes all " +
          "its links, so it can leave them out.",
      }),
  })
  .refine((bug) => bug.state === "closed" || bug.tests.length > 0, {
    path: ["tests"],
    message: "Name at least one test that fails because of an open bug.",
  })
  .meta({ id: "BugInput" });
export type BugInput = z.input<typeof BugInput>;

export const Bug = z
  .object({
    key: z.string(),
    url: z.string(),
    state: BugState,
    component: z.string(),
    tests: z.array(z.string()).meta({ description: "Every test linked to the bug." }),
    by: z
      .string()
      .nullable()
      .meta({ description: "The name of the token that last sent it, or the start of the token." }),
    updatedAt: Timestamp,
  })
  .meta({ id: "Bug" });
export type Bug = z.infer<typeof Bug>;

export const BugQuery = z.object({
  component: z.string().optional(),
  key: z.string().optional(),
  state: BugState.optional(),
});

export const BugList = z
  .object({
    items: z.array(Bug).meta({ description: "Newest first." }),
  })
  .meta({ id: "BugList" });
export type BugList = z.infer<typeof BugList>;
