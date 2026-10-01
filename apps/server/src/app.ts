import { serveStatic } from "@hono/node-server/serve-static";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiError,
  Deployment,
  DeploymentInput,
  DeploymentList,
  DeploymentQuery,
  HealthMatrix,
  Healthz,
  Project,
  TestRunCreated,
  TestRunDetail,
  TestRunInput,
  TestRunList,
  TestRunQuery,
  Verdict,
  VerdictQuery,
} from "@kollaudo/schema";
import { eq } from "drizzle-orm";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { type AuthEnv, requireScope } from "./auth.ts";
import type { Db } from "./db/client.ts";
import { projects } from "./db/schema.ts";
import { listDeployments, recordDeployment } from "./deployments.ts";
import { errorResponse, HttpError, validationResponse } from "./errors.ts";
import { ingestTestRun } from "./ingest.ts";
import { getHealth, getTestRun, listTestRuns } from "./reads.ts";
import { getVerdict } from "./verdict.ts";

/** Same as in package.json: a test checks it, and the release workflow checks the tag. */
export const VERSION = "0.1.1";

/** Largest accepted request body. Big e2e suites with long traces can reach tens of megabytes. */
const MAX_BODY_BYTES = 50 * 1024 * 1024;

const json = <T>(schema: T, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

const errors = {
  400: json(ApiError, "The request is not valid"),
  401: json(ApiError, "The API token is missing, unknown or revoked"),
  403: json(ApiError, "The API token doesn't have the needed scope"),
};

export interface AppOptions {
  db: Db;
  /** Directory of the built web UI. Without it, the server only serves the API. */
  webDir?: string;
}

/** Builds the HTTP application. Kept separate from `main.ts` so tests can call it without a network. */
export function createApp({ db, webDir }: AppOptions) {
  const app = new OpenAPIHono<AuthEnv>({
    defaultHook: (result, c) => {
      if (!result.success) return validationResponse(c, result.error);
    },
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "token", {
    type: "http",
    scheme: "bearer",
    description:
      "A project API token: `ingest` to send data and get verdicts, `read` to read everything.",
  });

  app.use(
    "/v1/*",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: (c) => errorResponse(c, 413, "payload_too_large", "The request body is too large."),
    }),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/healthz",
      summary: "Liveness check",
      responses: { 200: json(Healthz, "The server is up") },
    }),
    (c) => c.json({ status: "ok" as const, version: VERSION }, 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/project",
      summary: "The project of the API token",
      security: [{ token: [] }],
      middleware: [requireScope(db, "read")] as const,
      responses: { 200: json(Project, "The project"), 401: errors[401], 403: errors[403] },
    }),
    async (c) => {
      const [project] = await db
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.id, c.var.projectId));
      if (!project) throw new HttpError(401, "unauthorized", "The project no longer exists.");
      return c.json(project, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/test-runs",
      summary: "Send a CTRF test report",
      description:
        "Stores a test run for a version of a component, in an environment or at build level. " +
        "The component, environment and version are created if they don't exist yet.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "ingest")] as const,
      request: { body: { ...json(TestRunInput, "The test run"), required: true } },
      responses: {
        201: json(TestRunCreated, "The test run was stored"),
        ...errors,
        409: json(ApiError, "The version already exists with different metadata"),
        413: json(ApiError, "The report is too large"),
      },
    }),
    async (c) => {
      const run = await ingestTestRun(db, c.var.projectId, c.req.valid("json"));
      return c.json(run, 201);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/test-runs",
      summary: "List test runs",
      description: "Newest first, optionally filtered. Follow `next` to get older runs.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "read")] as const,
      request: { query: TestRunQuery },
      responses: { 200: json(TestRunList, "A page of test runs"), ...errors },
    }),
    async (c) => c.json(await listTestRuns(db, c.var.projectId, c.req.valid("query")), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/test-runs/{id}",
      summary: "Get a test run with its results",
      security: [{ token: [] }],
      middleware: [requireScope(db, "read")] as const,
      request: { params: z.object({ id: z.uuid() }) },
      responses: {
        200: json(TestRunDetail, "The test run"),
        ...errors,
        404: json(ApiError, "The project has no test run with this id"),
      },
    }),
    async (c) => {
      const run = await getTestRun(db, c.var.projectId, c.req.valid("param").id);
      if (!run) throw new HttpError(404, "not_found", "Test run not found.");
      return c.json(run, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/deployments",
      summary: "Record a deployment",
      description:
        "Records that a version of a component runs in an environment. The component, environment " +
        "and version are created if they don't exist yet, as for test runs.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "ingest")] as const,
      request: { body: { ...json(DeploymentInput, "The deployment"), required: true } },
      responses: {
        201: json(Deployment, "The deployment was recorded"),
        ...errors,
        409: json(ApiError, "The version already exists with different metadata"),
      },
    }),
    async (c) => c.json(await recordDeployment(db, c.var.projectId, c.req.valid("json")), 201),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/deployments",
      summary: "List deployments",
      description: "Newest first, optionally filtered. Follow `next` to get older deployments.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "read")] as const,
      request: { query: DeploymentQuery },
      responses: { 200: json(DeploymentList, "A page of deployments"), ...errors },
    }),
    async (c) => c.json(await listDeployments(db, c.var.projectId, c.req.valid("query")), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/health",
      summary: "Health of the project",
      description:
        "The components and environments of the project, with the latest run for each " +
        "component, environment and kind.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "read")] as const,
      responses: {
        200: json(HealthMatrix, "The health matrix"),
        401: errors[401],
        403: errors[403],
      },
    }),
    async (c) => c.json(await getHealth(db, c.var.projectId), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/verdict",
      summary: "Verdict of a version in an environment",
      description:
        "`pass`, `fail` or `unknown`, with the reasons for each kind of test. A version, component " +
        "or environment Kollaudo has never seen is `unknown`: evidence is missing. Accepts `read` " +
        "and `ingest` tokens, so a CI gate can use the token it sends results with.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "read", "ingest")] as const,
      request: { query: VerdictQuery },
      responses: { 200: json(Verdict, "The verdict"), ...errors },
    }),
    async (c) => c.json(await getVerdict(db, c.var.projectId, c.req.valid("query")), 200),
  );

  app.doc31("/v1/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "Kollaudo API",
      version: VERSION,
      description: "Test results and health of every version, in every environment.",
      license: { name: "Apache-2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
    },
  });

  if (webDir) serveWeb(app, webDir);

  app.notFound((c) => errorResponse(c, 404, "not_found", "Not found."));

  app.onError((error, c) => {
    if (error instanceof HttpError)
      return errorResponse(c, error.status, error.code, error.message);
    if (error instanceof HTTPException) {
      return errorResponse(c, error.status as 400, "invalid_request", error.message);
    }
    console.error(error);
    return errorResponse(c, 500, "internal_error", "Something went wrong on the server.");
  });

  return app;
}

/** Serves the web UI. Paths that aren't files, such as `/test-runs/<id>`, are routes of the UI. */
function serveWeb(app: OpenAPIHono<AuthEnv>, root: string) {
  app.use("/assets/*", async (c, next) => {
    await next();
    // Vite puts a content hash in these file names, so they never change.
    if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.use("*", serveStatic({ root }));

  const index = serveStatic({ root, path: "index.html" });
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/v1/") || c.req.path.startsWith("/assets/")) return next();
    c.header("Cache-Control", "no-cache");
    return index(c, next);
  });
}
