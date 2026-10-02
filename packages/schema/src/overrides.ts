// Overrides: one version let through in one environment, with who, why and until when (ADR 0018).

import { z } from "zod";
import { Name, Timestamp, VersionName } from "./test-runs.ts";

/** How long an override holds, unless given. */
export const DEFAULT_OVERRIDE_DURATION = "4h";

export const OverrideInput = z
  .object({
    component: Name.meta({ example: "api" }),
    environment: Name.meta({ example: "staging" }),
    version: VersionName.meta({ example: "3f2a9c1" }),
    reason: z
      .string()
      .trim()
      .min(10, "Say why, in a few words: it's what people will read when they wonder.")
      .max(500)
      .meta({ example: "Hotfix for incident 1234, e2e environment down" }),
    for: z
      .string()
      .regex(/^[1-9][0-9]*[mh]$/, "Use a number and m or h, such as 30m or 4h.")
      .default(DEFAULT_OVERRIDE_DURATION)
      .meta({ description: "How long it holds: at most 24h.", example: "4h" }),
  })
  .meta({ id: "OverrideInput" });
export type OverrideInput = z.input<typeof OverrideInput>;

export const Override = z
  .object({
    id: z.uuid(),
    component: z.string(),
    environment: z.string(),
    version: z.string(),
    reason: z.string(),
    by: z
      .string()
      .nullable()
      .meta({ description: "The name of the token that made it, or the start of the token." }),
    createdAt: Timestamp,
    expiresAt: Timestamp,
    revokedAt: Timestamp.nullable(),
    active: z.boolean().meta({ description: "Neither expired nor revoked." }),
  })
  .meta({ id: "Override" });
export type Override = z.infer<typeof Override>;

export const OverrideQuery = z.object({
  component: z.string().optional(),
  environment: z.string().optional(),
  version: z.string().optional(),
});

export const OverrideList = z
  .object({ items: z.array(Override).meta({ description: "Newest first, expired ones too." }) })
  .meta({ id: "OverrideList" });
export type OverrideList = z.infer<typeof OverrideList>;
