// Sign-offs: evidence that a person gave, stored and judged as a test run (ADR 0021).

import { z } from "zod";
import { KIND_PATTERN, Name, Timestamp, VersionName } from "./test-runs.ts";

const Kind = z.string().regex(new RegExp(`^${KIND_PATTERN}$`), "Use a kind such as uat or manual.");

export const SignoffInput = z
  .object({
    component: Name.meta({ example: "checkout" }),
    environment: Name.meta({ example: "staging" }),
    version: VersionName.meta({ example: "3f2a9c1" }),
    kind: Kind.meta({ description: "What was checked: uat, manual…", example: "uat" }),
    outcome: z.enum(["pass", "fail"]),
    note: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .meta({ example: "Checked the new payment page with the two test cards" }),
  })
  .meta({ id: "SignoffInput" });
export type SignoffInput = z.input<typeof SignoffInput>;

export const Signoff = z
  .object({
    id: z.uuid().meta({ description: "The id of the test run that holds it." }),
    component: z.string(),
    environment: z.string(),
    version: z.string(),
    kind: z.string(),
    outcome: z.enum(["pass", "fail"]),
    note: z.string().nullable(),
    by: z
      .string()
      .nullable()
      .meta({ description: "The name of the token that gave it, or the start of the token." }),
    createdAt: Timestamp,
  })
  .meta({ id: "Signoff" });
export type Signoff = z.infer<typeof Signoff>;

export const SignoffQuery = z.object({
  component: z.string().optional(),
  environment: z.string().optional(),
  version: z.string().optional(),
  kind: z.string().optional(),
});

export const SignoffList = z
  .object({
    items: z.array(Signoff).meta({ description: "Newest first, earlier ones of a kind too." }),
  })
  .meta({ id: "SignoffList" });
export type SignoffList = z.infer<typeof SignoffList>;
