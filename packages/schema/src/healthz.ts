import { z } from "zod";

/** Response of `GET /healthz`: the server is up and able to answer. */
export const Healthz = z.object({
  status: z.literal("ok"),
  version: z.string(),
});

export type Healthz = z.infer<typeof Healthz>;

/** Response of `GET /readyz`: whether the server can answer requests, its database included. */
export const Readyz = z.object({
  status: z.enum(["ready", "not_ready"]),
  database: z.enum(["ok", "unreachable"]),
});

export type Readyz = z.infer<typeof Readyz>;
