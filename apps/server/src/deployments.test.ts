import { ApiError, Deployment, DeploymentList, HealthMatrix, Verdict } from "@kollaudo/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createProject } from "./projects.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ingest: string;
let read: string;
let otherRead: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const shop = await createProject(testDb.db, "shop");
  const blog = await createProject(testDb.db, "blog");
  ingest = token(shop, "ingest");
  read = token(shop, "read");
  otherRead = token(blog, "read");
});
afterAll(() => testDb.drop());

function token(project: Awaited<ReturnType<typeof createProject>>, scope: string) {
  return project.tokens.find((t) => t.scope === scope)?.token ?? "";
}

function post(body: unknown, auth = ingest) {
  return app.request("/v1/deployments", {
    method: "POST",
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function get(path: string, auth = read) {
  return app.request(path, { headers: { authorization: `Bearer ${auth}` } });
}

async function deploy(body: Record<string, string>) {
  const res = await post(body);
  expect(res.status).toBe(201);
  return Deployment.parse(await res.json());
}

describe("POST /v1/deployments", () => {
  it("records a deployment, creating the component, environment and version", async () => {
    const deployment = await deploy({
      component: "api",
      environment: "staging",
      version: "3f2a9c1",
      commit: "3f2a9c1",
      digest: "sha256:aaa",
      tool: "argocd",
      deployedAt: "2026-10-01T09:00:00+02:00",
    });

    expect(deployment).toMatchObject({
      component: "api",
      environment: "staging",
      version: "3f2a9c1",
      commit: "3f2a9c1",
      digest: "sha256:aaa",
      branch: null,
      tool: "argocd",
      deployedAt: "2026-10-01T07:00:00.000Z",
    });
  });

  it("uses the time it receives the deployment when none is given", async () => {
    const before = Date.now();
    const deployment = await deploy({ component: "web", environment: "dev", version: "1.0.0" });

    expect(Date.parse(deployment.deployedAt)).toBeGreaterThanOrEqual(before - 1000);
    expect(deployment.deployedAt).toBe(deployment.createdAt);
  });

  it("refuses a different artifact under the same version, as test runs do", async () => {
    const res = await post({
      component: "api",
      environment: "production",
      version: "3f2a9c1",
      digest: "sha256:bbb",
    });

    expect(res.status).toBe(409);
    expect(ApiError.parse(await res.json()).error.message).toContain('digest "sha256:aaa"');
  });

  it("needs an environment, and an ingest token", async () => {
    const noEnvironment = await post({ component: "api", version: "1.0.0" });
    expect(noEnvironment.status).toBe(400);
    const { error } = ApiError.parse(await noEnvironment.json());
    expect(error.issues?.map((i) => i.path)).toEqual(["environment"]);

    expect(
      (await post({ component: "api", environment: "dev", version: "1.0.0" }, read)).status,
    ).toBe(403);
  });
});

describe("GET /v1/deployments", () => {
  beforeAll(async () => {
    for (const [environment, version, deployedAt] of [
      ["staging", "3f2a9c2", "2026-10-01T10:00:00Z"],
      ["staging", "3f2a9c3", "2026-10-01T11:00:00Z"],
      ["production", "3f2a9c2", "2026-10-01T12:00:00Z"],
    ] as const) {
      await deploy({ component: "api", environment, version, deployedAt });
    }
  });

  it("lists deployments newest first, by when they happened", async () => {
    const res = await get("/v1/deployments?component=api");
    expect(res.status).toBe(200);
    const { items, next } = DeploymentList.parse(await res.json());

    expect(items.map((d) => `${d.environment} ${d.version}`)).toEqual([
      "production 3f2a9c2",
      "staging 3f2a9c3",
      "staging 3f2a9c2",
      "staging 3f2a9c1",
    ]);
    expect(next).toBeNull();
  });

  it("filters by environment, and pages with next", async () => {
    const first = DeploymentList.parse(
      await (await get("/v1/deployments?environment=staging&limit=2")).json(),
    );
    expect(first.items.map((d) => d.version)).toEqual(["3f2a9c3", "3f2a9c2"]);

    const second = DeploymentList.parse(
      await (await get(`/v1/deployments?environment=staging&limit=2&before=${first.next}`)).json(),
    );
    expect(second.items.map((d) => d.version)).toEqual(["3f2a9c1"]);
    expect(second.next).toBeNull();
  });

  it("only shows the project's deployments", async () => {
    const { items } = DeploymentList.parse(await (await get("/v1/deployments", otherRead)).json());
    expect(items).toEqual([]);
  });
});

describe("what runs now", () => {
  beforeAll(async () => {
    // Reported late: it happened before the others, so it doesn't replace them.
    await deploy({
      component: "api",
      environment: "staging",
      version: "3f2a9c0",
      deployedAt: "2026-09-01T10:00:00Z",
    });
  });

  it("shows the latest deployment of each component in each environment in the health matrix", async () => {
    const health = HealthMatrix.parse(await (await get("/v1/health")).json());

    expect(health.deployed.map((d) => `${d.component} ${d.environment} ${d.version}`)).toEqual([
      "api production 3f2a9c2",
      "api staging 3f2a9c3",
      "web dev 1.0.0",
    ]);
    // Deployed versions without tests are components and environments of the matrix too.
    expect(health.components).toEqual(["api", "web"]);
    expect(health.latest).toEqual([]);
  });

  it("reports what runs in the environment with the verdict, without changing it", async () => {
    const query = "component=api&environment=staging";
    const running = Verdict.parse(await (await get(`/v1/verdict?${query}&version=3f2a9c3`)).json());
    const other = Verdict.parse(await (await get(`/v1/verdict?${query}&version=3f2a9c1`)).json());
    const nowhere = Verdict.parse(
      await (await get("/v1/verdict?component=api&environment=qa&version=3f2a9c3")).json(),
    );

    expect(running).toMatchObject({ outcome: "unknown", deployed: { version: "3f2a9c3" } });
    expect(other).toMatchObject({ outcome: "unknown", deployed: { version: "3f2a9c3" } });
    expect(nowhere.deployed).toBeNull();
  });
});
