import { Deployment, DeploymentList, HealthMatrix, Verdict } from "@kollaudo/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createProject, createProjectToken } from "./projects.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ingest: string;
let read: string;

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const { tokens } = await createProject(testDb.db, "shop");
  ingest = tokens.find((t) => t.scope === "ingest")?.token ?? "";
  read = tokens.find((t) => t.scope === "read")?.token ?? "";

  // Before the policy said where production versions come from, nothing could be gated.
  await deploy("1.0.0", "production", { deployedAt: hoursAgo(48) });

  const policy = (await createProjectToken(testDb.db, "shop", "policy")).token;
  const res = await request("POST", "/v1/policy", policy, {
    source: [
      "environments:",
      "  staging:",
      "    require: [e2e]",
      "  production:",
      "    from: staging",
      "components:",
      "  worker:",
      "    environments:",
      "      production:",
      "        from: qa",
    ].join("\n"),
  });
  expect(res.status).toBe(201);
});
afterAll(() => testDb.drop());

function request(method: string, path: string, token: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function test(version: string, status: string, component = "api", environment = "staging") {
  const res = await request("POST", "/v1/test-runs", ingest, {
    component,
    version,
    environment,
    report: {
      results: {
        tool: { name: "playwright" },
        summary: { tests: 1 },
        tests: [{ name: "home", status, duration: 10 }],
      },
    },
  });
  expect(res.status).toBe(201);
}

async function ask(version: string, component = "api", environment = "staging") {
  const res = await request(
    "GET",
    `/v1/verdict?component=${component}&environment=${environment}&version=${version}`,
    read,
  );
  expect(res.status).toBe(200);
  return Verdict.parse(await res.json());
}

async function deploy(
  version: string,
  environment: string,
  fields: { component?: string; deployedAt?: string } = {},
) {
  const res = await request("POST", "/v1/deployments", ingest, {
    component: "api",
    version,
    environment,
    ...fields,
  });
  expect(res.status).toBe(201);
  return Deployment.parse(await res.json());
}

describe("gated and ungated deployments (ADR 0019)", () => {
  it("are gated when a pass was given where versions come from, before the deployment", async () => {
    await test("1.1.0", "passed");
    const verdict = await ask("1.1.0");
    expect(verdict.outcome).toBe("pass");

    const { gate } = await deploy("1.1.0", "production");
    expect(gate).toMatchObject({ from: "staging", gated: true, passedAt: expect.any(String) });
    expect(gate?.verdictId).toEqual(expect.any(String));
  });

  it("are ungated when no gate asked", async () => {
    const { gate } = await deploy("1.2.0", "production");
    expect(gate).toEqual({ from: "staging", gated: false, verdictId: null, passedAt: null });
  });

  it("are ungated when the gate got another answer than pass", async () => {
    await test("1.3.0", "failed");
    expect((await ask("1.3.0")).outcome).toBe("fail");
    expect((await deploy("1.3.0", "production")).gate?.gated).toBe(false);
  });

  it("are ungated when the pass came after the deployment", async () => {
    const { id } = await deploy("1.4.0", "production");
    await test("1.4.0", "passed");
    expect((await ask("1.4.0")).outcome).toBe("pass");

    const { items } = DeploymentList.parse(
      await (await request("GET", "/v1/deployments?environment=production", read)).json(),
    );
    expect(items.find((d) => d.id === id)?.gate?.gated).toBe(false);
  });

  it("don't count a pass of another version or environment", async () => {
    await test("1.5.0", "passed");
    expect((await ask("1.5.0")).outcome).toBe("pass");
    expect((await deploy("1.6.0", "production")).gate?.gated).toBe(false);

    await test("1.7.0", "passed", "api", "dev");
    expect((await ask("1.7.0", "api", "dev")).outcome).toBe("pass");
    expect((await deploy("1.7.0", "production")).gate?.gated).toBe(false);
  });

  it("follow where the component's versions come from", async () => {
    await test("2.0.0", "passed", "worker", "qa");
    expect((await ask("2.0.0", "worker", "qa")).outcome).toBe("pass");
    const { gate } = await deploy("2.0.0", "production", { component: "worker" });
    expect(gate).toMatchObject({ from: "qa", gated: true });
  });

  it("have no gate where the policy doesn't say where versions come from", async () => {
    expect((await deploy("1.1.0", "staging")).gate).toBeNull();
  });

  it("follow the policy in force when the version was deployed", async () => {
    const { items } = DeploymentList.parse(
      await (await request("GET", "/v1/deployments?environment=production", read)).json(),
    );
    expect(items.find((d) => d.version === "1.0.0")?.gate).toBeNull();
  });

  it("show in the health matrix and in the verdict of the environment", async () => {
    const health = HealthMatrix.parse(await (await request("GET", "/v1/health", read)).json());
    const running = health.deployed.find(
      (d) => d.component === "api" && d.environment === "production",
    );
    expect(running).toMatchObject({ version: "1.7.0", gate: { from: "staging", gated: false } });

    const verdict = await ask("1.7.0", "api", "production");
    expect(verdict.deployed?.gate).toMatchObject({ from: "staging", gated: false });
  });
});
