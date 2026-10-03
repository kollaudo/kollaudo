import { serveStatic } from "@hono/node-server/serve-static";
import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiError,
  Deployment,
  DeploymentInput,
  DeploymentList,
  DeploymentQuery,
  GivenVerdictList,
  GivenVerdictQuery,
  HealthMatrix,
  Healthz,
  Override,
  OverrideInput,
  OverrideList,
  OverrideQuery,
  Policy,
  PolicyDocument,
  PolicyInput,
  Project,
  Readyz,
  TestRunCreated,
  TestRunDetail,
  TestRunInput,
  TestRunList,
  TestRunQuery,
  Verdict,
  VerdictQuery,
} from "@kollaudo/schema";
import { eq, sql } from "drizzle-orm";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { type AuthEnv, requireScope } from "./auth.ts";
import type { Db } from "./db/client.ts";
import { projects } from "./db/schema.ts";
import { listDeployments, recordDeployment } from "./deployments.ts";
import { errorResponse, HttpError, validationResponse } from "./errors.ts";
import { ingestTestRun } from "./ingest.ts";
import { createOverride, listOverrides, revokeOverride } from "./overrides.ts";
import { currentPolicy, parsePolicy, pushPolicy } from "./policies.ts";
import { getHealth, getTestRun, listTestRuns } from "./reads.ts";
import { getVerdict } from "./verdict.ts";
import { listVerdicts, recordVerdict } from "./verdict-log.ts";

/** Same as in package.json: a test checks it, and the release workflow checks the tag. */
export const VERSION = "0.2.0";

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
      path: "/readyz",
      summary: "Readiness check",
      description:
        "Whether this instance can answer requests: 200 when the database answers, 503 when it " +
        "doesn't. Load balancers and Kubernetes send traffic only to ready instances.",
      responses: {
        200: json(Readyz, "The server and its database answer"),
        503: json(Readyz, "The database doesn't answer"),
      },
    }),
    async (c) => {
      const ready = await databaseAnswers(db);
      return ready
        ? c.json({ status: "ready" as const, database: "ok" as const }, 200)
        : c.json({ status: "not_ready" as const, database: "unreachable" as const }, 503);
    },
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
        "The component, environment and version are created if they don't exist yet. The report " +
        "is CTRF: to send JUnit XML, convert it first, with `kollaudo push` or a tool such as " +
        "junit-to-ctrf (ADR 0015).",
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
      const run = await ingestTestRun(db, c.var.token, c.req.valid("json"));
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
    async (c) => c.json(await recordDeployment(db, c.var.token, c.req.valid("json")), 201),
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
      method: "post",
      path: "/v1/policy",
      summary: "Send the project's policy",
      description:
        "Validates a policy file and makes it the project's policy, as a new revision (ADR 0016). " +
        "It needs a token of the policy scope, so CI jobs that send results can't change the rules.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "policy")] as const,
      request: { body: { ...json(PolicyInput, "The policy file"), required: true } },
      responses: {
        201: json(Policy, "The policy is the project's policy"),
        ...errors,
        400: json(ApiError, "The policy isn't valid, with each problem and its path"),
      },
    }),
    async (c) => c.json(await pushPolicy(db, c.var.token, c.req.valid("json").source), 201),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/policy/check",
      summary: "Check a policy without keeping it",
      description: "Validates a policy file as POST /v1/policy does, and keeps nothing.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "policy", "read", "ingest")] as const,
      request: { body: { ...json(PolicyInput, "The policy file"), required: true } },
      responses: {
        200: json(z.object({ document: PolicyDocument }), "The policy is valid"),
        ...errors,
        400: json(ApiError, "The policy isn't valid, with each problem and its path"),
      },
    }),
    async (c) => c.json({ document: parsePolicy(c.req.valid("json").source) }, 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/policy",
      summary: "Get the project's policy",
      description: "The latest revision of the project's policy.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "read", "policy")] as const,
      responses: {
        200: json(Policy, "The project's policy"),
        401: errors[401],
        403: errors[403],
        404: json(ApiError, "The project has no policy: verdicts apply the default rules"),
      },
    }),
    async (c) => {
      const policy = await currentPolicy(db, c.var.projectId);
      if (!policy) {
        throw new HttpError(
          404,
          "no_policy",
          "The project has no policy: verdicts apply the default rules.",
        );
      }
      return c.json(policy, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/overrides",
      summary: "Let a version through a gate",
      description:
        "Makes the verdict of a version in an environment pass until the override expires, at most " +
        "24h (ADR 0018). The verdict says it was overridden, by whom and why. It needs a token of " +
        "the override scope, so pipelines can't override their own gates.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "override")] as const,
      request: { body: { ...json(OverrideInput, "The override"), required: true } },
      responses: {
        201: json(Override, "The override holds"),
        ...errors,
        409: json(ApiError, "The version already exists with different metadata"),
      },
    }),
    async (c) => c.json(await createOverride(db, c.var.token, c.req.valid("json")), 201),
  );

  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/overrides/{id}/revoke",
      summary: "End an override before it expires",
      security: [{ token: [] }],
      middleware: [requireScope(db, "override")] as const,
      request: { params: z.object({ id: z.uuid() }) },
      responses: {
        200: json(Override, "The override no longer holds"),
        ...errors,
        404: json(ApiError, "The project has no override with this id"),
      },
    }),
    async (c) => c.json(await revokeOverride(db, c.var.projectId, c.req.valid("param").id), 200),
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/overrides",
      summary: "List overrides",
      description: "Every override of the project, newest first, expired and revoked ones too.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "read", "override")] as const,
      request: { query: OverrideQuery },
      responses: { 200: json(OverrideList, "The overrides"), ...errors },
    }),
    async (c) => c.json(await listOverrides(db, c.var.projectId, c.req.valid("query")), 200),
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
        "and `ingest` tokens, so a CI gate can use the token it sends results with. Every verdict " +
        "given is recorded, with the token that asked: see `GET /v1/verdicts`. With `record=false` " +
        "it is not, as for the web UI.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "read", "ingest")] as const,
      request: { query: VerdictQuery },
      responses: { 200: json(Verdict, "The verdict"), ...errors },
    }),
    async (c) => {
      const query = c.req.valid("query");
      const verdict = await getVerdict(db, c.var.projectId, query);
      if (query.record) await recordVerdict(db, c.var.token, verdict);
      return c.json(verdict, 200);
    },
  );

  app.openapi(
    createRoute({
      method: "get",
      path: "/v1/verdicts",
      summary: "List the verdicts given",
      description:
        "Every verdict Kollaudo gave in the project, newest first, with the policy revision, the " +
        "override and the token that asked (ADR 0019). Follow `next` to get older ones.",
      security: [{ token: [] }],
      middleware: [requireScope(db, "read")] as const,
      request: { query: GivenVerdictQuery },
      responses: { 200: json(GivenVerdictList, "The verdicts given"), ...errors },
    }),
    async (c) => c.json(await listVerdicts(db, c.var.projectId, c.req.valid("query")), 200),
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
      return errorResponse(c, error.status, error.code, error.message, error.issues);
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

/** How long the readiness check waits for the database: probes have short timeouts too. */
const READY_TIMEOUT_MS = 2_000;

/** Whether the database answers a trivial query in time. */
async function databaseAnswers(db: Db) {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([db.execute(sql`select 1`).then(() => true), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
