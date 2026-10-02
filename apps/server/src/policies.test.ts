import { ApiError, Policy, Verdict } from "@kollaudo/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { resolveRule } from "./policies.ts";
import { createProject, createProjectToken } from "./projects.ts";
import { createTestDb } from "./testing.ts";
import { candidates } from "./verdict.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ingest: string;
let read: string;
let policyToken: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const { tokens } = await createProject(testDb.db, "shop");
  ingest = tokens.find((t) => t.scope === "ingest")?.token ?? "";
  read = tokens.find((t) => t.scope === "read")?.token ?? "";
  policyToken = (await createProjectToken(testDb.db, "shop", "policy", { name: "rules" })).token;
});
afterAll(() => testDb.drop());

function request(method: string, path: string, token: string, body?: unknown) {
  return app.request(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Sends a run of api. "flaky" is a test that passed after a retry. */
async function push(fields: Record<string, string>, statuses: string[]) {
  const tests = statuses.map((status, i) => ({
    name: `test ${i}`,
    status: status === "flaky" ? "passed" : status,
    flaky: status === "flaky",
    duration: 1,
  }));
  const res = await request("POST", "/v1/test-runs", ingest, {
    component: "api",
    ...fields,
    report: { results: { tool: { name: "t" }, summary: { tests: tests.length }, tests } },
  });
  expect(res.status).toBe(201);
}

async function deploy(version: string, environment: string) {
  const res = await request("POST", "/v1/deployments", ingest, {
    component: "api",
    environment,
    version,
  });
  expect(res.status).toBe(201);
}

async function verdict(query: string) {
  const res = await request("GET", `/v1/verdict?component=api&${query}`, read);
  expect(res.status).toBe(200);
  return Verdict.parse(await res.json());
}

async function setPolicy(source: string) {
  const res = await request("POST", "/v1/policy", policyToken, { source });
  expect(res.status).toBe(201);
  return Policy.parse(await res.json());
}

describe("POST /v1/policy", () => {
  it("needs a policy token: CI tokens can't change the rules", async () => {
    for (const token of [ingest, read]) {
      const res = await request("POST", "/v1/policy", token, { source: "environments: {}" });
      expect(res.status).toBe(403);
    }
  });

  it("refuses invalid policies, with the path of each problem", async () => {
    const cases = [
      ["environments:\n  staging: [1\n", ""],
      ["environments:\n  staging:\n    require: [E2E]\n", "environments.staging.require.0"],
      ["environments:\n  staging:\n    requires: [e2e]\n", "environments.staging"],
      ["environments:\n  staging:\n    maxAge: 1 week\n", "environments.staging.maxAge"],
      ["environments:\n  staging:\n    flaky: maybe\n", "environments.staging.flaky"],
    ];
    for (const [source, path] of cases) {
      const res = await request("POST", "/v1/policy", policyToken, { source });
      expect(res.status).toBe(400);
      const { error } = ApiError.parse(await res.json());
      expect(error.code).toBe("invalid_policy");
      expect(error.issues?.[0]?.path).toBe(path);
    }
  });

  it("checks a policy without keeping it", async () => {
    const res = await request("POST", "/v1/policy/check", ingest, {
      source: "environments:\n  staging:\n    require: [e2e]\n",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      document: { environments: { staging: { require: ["e2e"] } } },
    });
    expect((await request("GET", "/v1/policy", read)).status).toBe(404);
  });
});

describe("verdicts under a policy (ADR 0016)", () => {
  beforeAll(async () => {
    // 1.0.0: e2e passed with a flaky test, while 1.0.0 was deployed. No smoke run.
    await deploy("1.0.0", "staging");
    await push({ environment: "staging", version: "1.0.0", kind: "e2e" }, ["passed", "flaky"]);
    // 1.1.0 is tested in staging, but staging still runs 1.0.0.
    await push({ environment: "staging", version: "1.1.0", kind: "e2e" }, ["passed"]);
    await push({ environment: "staging", version: "1.1.0", kind: "smoke" }, ["passed"]);
    // In a preview environment, 2.0.0 ran its e2e tests.
    await push({ environment: "pr-42", version: "2.0.0", kind: "e2e" }, ["passed"]);
  });

  it("uses the default rules until the project has a policy", async () => {
    expect(await verdict("environment=staging&version=1.0.0")).toMatchObject({
      outcome: "pass",
      policy: { name: "default", revision: null, require: [], deployed: false, flaky: "allow" },
    });
  });

  it("requires what the policy requires, even when the pipeline doesn't ask", async () => {
    const policy = await setPolicy(
      "# Rules of the shop\nenvironments:\n  staging:\n    require: [e2e, smoke]\n",
    );
    expect(policy).toMatchObject({ revision: 1, sentBy: "rules" });
    expect(policy.source).toContain("# Rules of the shop");

    // The pipeline asks without --require: smoke is still required.
    expect(await verdict("environment=staging&version=1.0.0")).toMatchObject({
      outcome: "unknown",
      message: "Evidence is missing for smoke.",
      policy: { name: "project", revision: 1, require: ["e2e", "smoke"] },
    });
  });

  it("lets a request add kinds, never remove them", async () => {
    const stricter = await verdict("environment=staging&version=1.1.0&require=uat");
    expect(stricter.policy.require).toEqual(["e2e", "smoke", "uat"]);
    expect(stricter.outcome).toBe("unknown");

    const same = await verdict("environment=staging&version=1.1.0&require=e2e");
    expect(same.policy.require).toEqual(["e2e", "smoke"]);
    expect(same.outcome).toBe("pass");
  });

  it("with deployed, counts only tests of the version that was deployed", async () => {
    await setPolicy("environments:\n  staging:\n    require: [e2e, smoke]\n    deployed: true\n");
    const notDeployed = await verdict("environment=staging&version=1.1.0");

    expect(notDeployed).toMatchObject({
      outcome: "unknown",
      policy: { revision: 2, deployed: true },
    });
    for (const reason of notDeployed.reasons) {
      expect(reason.message).toMatch(
        /^The latest run started at .+, while 1\.0\.0 was deployed, not 1\.1\.0\.$/,
      );
    }

    // Once 1.1.0 is deployed and tested again, its new runs count.
    await deploy("1.1.0", "staging");
    await push({ environment: "staging", version: "1.1.0", kind: "e2e" }, ["passed"]);
    await push({ environment: "staging", version: "1.1.0", kind: "smoke" }, ["passed"]);
    expect((await verdict("environment=staging&version=1.1.0")).outcome).toBe("pass");
  });

  it("applies patterns, component rules, flaky and maxAge", async () => {
    await setPolicy(`
default:
  require: [e2e]
environments:
  "pr-*":
    require: [e2e, a11y]
  staging:
    require: [e2e]
    flaky: fail
components:
  api:
    environments:
      dev:
        maxAge: 1m
`);
    // pr-42 matches the pattern: a11y is required.
    expect(await verdict("environment=pr-42&version=2.0.0")).toMatchObject({
      outcome: "unknown",
      message: "Evidence is missing for a11y.",
    });
    // In staging, a flaky test fails the run.
    const flaky = await verdict("environment=staging&version=1.0.0");
    expect(flaky).toMatchObject({ outcome: "fail", message: "e2e failed." });
    expect(flaky.reasons[0]?.message).toBe("2 passed, 1 flaky (flaky tests fail it)");
    // An environment that no entry names gets the default rules of the policy.
    expect((await verdict("environment=qa&version=1.0.0")).policy).toMatchObject({
      name: "project",
      require: ["e2e"],
    });
  });
});

describe("resolveRule", () => {
  const document = {
    default: { require: ["e2e"], flaky: "fail" as const },
    environments: {
      "pr-*": { require: ["e2e", "a11y"] },
      "pr-1": { require: ["smoke"] },
    },
    components: { api: { environments: { "pr-*": { deployed: true } } } },
  };

  it("takes the most specific entry for each field", () => {
    expect(resolveRule(document, "web", "pr-2")).toMatchObject({
      fromPolicy: true,
      require: ["a11y", "e2e"],
      flaky: "fail",
      deployed: false,
    });
    // An exact name wins over a pattern.
    expect(resolveRule(document, "web", "pr-1").require).toEqual(["smoke"]);
    // A component's entry adds to the environment's.
    expect(resolveRule(document, "api", "pr-2")).toMatchObject({
      require: ["a11y", "e2e"],
      deployed: true,
    });
  });

  it("falls back to the default rules of Kollaudo without a policy", () => {
    expect(resolveRule(undefined, "api", "staging")).toEqual({
      fromPolicy: false,
      require: [],
      deployed: false,
      flaky: "allow",
      maxAge: null,
      from: null,
    });
  });
});

describe("candidates", () => {
  const run = (id: string, createdAt: string, startedAt: string | null = null) =>
    ({ id, kind: "e2e", createdAt, startedAt }) as Parameters<typeof candidates>[0][number];
  const now = Date.parse("2026-10-10T12:00:00Z");

  it("with maxAge, counts the latest recent run, or says why none counts", () => {
    const recent = run("recent", "2026-10-10T11:00:00Z");
    const old = run("old", "2026-10-01T12:00:00Z");
    const rule = { deployed: false, maxAge: "2d" };

    expect(candidates([recent, old], rule, "1", [], now).get("e2e")).toEqual({ run: recent });
    expect(candidates([old], rule, "1", [], now).get("e2e")).toEqual({
      run: null,
      excluded: "The latest run is older than 2d.",
    });
  });

  it("with deployed, uses when the run started, and keeps an older run that counts", () => {
    const history = [
      { version: "1", deployedAt: new Date("2026-10-10T08:00:00Z") },
      { version: "2", deployedAt: new Date("2026-10-10T10:00:00Z") },
    ];
    // Received after 2 was deployed, but started while 1 still ran.
    const startedEarly = run("early", "2026-10-10T10:30:00Z", "2026-10-10T09:30:00Z");
    const afterTwo = run("late", "2026-10-10T11:00:00Z");
    const rule = { deployed: true, maxAge: null };

    expect(candidates([afterTwo, startedEarly], rule, "1", history, now).get("e2e")).toEqual({
      run: startedEarly,
    });
    expect(candidates([afterTwo], rule, "1", history, now).get("e2e")).toEqual({
      run: null,
      excluded: "The latest run started at 2026-10-10T11:00:00Z, while 2 was deployed, not 1.",
    });
    expect(candidates([startedEarly], rule, "1", [], now).get("e2e")?.excluded).toBe(
      "The latest run started at 2026-10-10T09:30:00Z, before any deployment Kollaudo knows of.",
    );
  });
});
