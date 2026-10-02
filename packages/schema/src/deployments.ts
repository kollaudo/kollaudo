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
