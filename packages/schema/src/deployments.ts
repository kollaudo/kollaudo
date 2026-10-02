import { z } from "zod";
import { Metadata, Name, Timestamp, VersionName } from "./test-runs.ts";

export const DeploymentInput = z
  .object({
    component: Name.meta({ example: "api" }),
    environment: Name.meta({ example: "staging" }),
    version: VersionName.meta({ example: "3f2a9c1" }),
    commit: Metadata.optional(),
    branch: Metadata.optional(),
    tag: Metadata.optional(),
    pullRequest: Metadata.optional(),
    digest: Metadata.optional().meta({
      description: "Digest of the deployed artifact, such as a container image digest.",
      example: "sha256:4f5c2d7e…",
    }),
    deployedAt: Timestamp.optional().meta({
      description: "When the version started running. Defaults to when Kollaudo receives it.",
    }),
    tool: Metadata.optional().meta({
      description: "Tool that deployed the version.",
      example: "argocd",
    }),
  })
  .meta({ id: "DeploymentInput" });
export type DeploymentInput = z.input<typeof DeploymentInput>;

/**
 * Whether a gate let the version through before it was deployed (ADR 0019). Only for environments
 * whose policy says where versions come from (`from`).
 */
export const DeploymentGate = z
  .object({
    from: z.string().meta({
      description: "The environment versions come from, as the policy said when it was deployed.",
      example: "staging",
    }),
    gated: z.boolean().meta({
      description:
        "Whether Kollaudo gave a pass for this version in `from` before it was deployed. False " +
        "means no gate asked, or none got a pass: the deployment went around the gate.",
    }),
    verdictId: z.uuid().nullable().meta({
      description: "The latest pass given before the deployment, from GET /v1/verdicts.",
    }),
    passedAt: Timestamp.nullable().meta({ description: "When that pass was given." }),
  })
  .meta({ id: "DeploymentGate" });
export type DeploymentGate = z.infer<typeof DeploymentGate>;

export const Deployment = z
  .object({
    id: z.uuid(),
    component: z.string(),
    environment: z.string(),
    version: z.string(),
    commit: z.string().nullable(),
    branch: z.string().nullable(),
    tag: z.string().nullable(),
    pullRequest: z.string().nullable(),
    digest: z.string().nullable(),
    tool: z.string().nullable(),
    sentBy: z.string().nullable().meta({
      description: "The name of the token that sent the deployment, or the start of the token.",
    }),
    deployedAt: Timestamp,
    createdAt: Timestamp.meta({ description: "When Kollaudo received the deployment." }),
    gate: DeploymentGate.nullable().meta({
      description:
        "Whether a gate let it through. Null when the policy doesn't say where versions of this " +
        "environment come from.",
    }),
  })
  .meta({ id: "Deployment" });
export type Deployment = z.infer<typeof Deployment>;

export const DeploymentQuery = z.object({
  component: z.string().optional(),
  environment: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.uuid().optional().meta({ description: "The `next` value of the previous page." }),
});

export const DeploymentList = z
  .object({
    items: z.array(Deployment).meta({ description: "Newest first." }),
    next: z
      .uuid()
      .nullable()
      .meta({ description: "Pass it as `before` to get the next page. Null on the last page." }),
  })
  .meta({ id: "DeploymentList" });
export type DeploymentList = z.infer<typeof DeploymentList>;
