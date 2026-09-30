import { ApiError, Verdict } from "@kollaudo/schema";
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

  // 1.0.0 passed on staging, with a flaky test. Its failed unit tests are build level, and its dev
  // run is in another environment: neither counts for staging.
  await push({ version: "1.0.0", environment: "staging" }, ["passed", "flaky"]);
  await push({ version: "1.0.0", kind: "unit" }, ["failed"]);
  await push({ version: "1.0.0", environment: "dev" }, ["failed"]);
  // 1.1.0 failed e2e, then passed after a fix, but smoke failed.
  await push({ version: "1.1.0", environment: "staging" }, ["failed"]);
  await push({ version: "1.1.0", environment: "staging" }, ["passed"]);
  await push({ version: "1.1.0", environment: "staging", kind: "smoke" }, ["passed", "failed"]);
  // 1.2.0 sent a report with no tests.
  await push({ version: "1.2.0", environment: "staging" }, []);
});
afterAll(() => testDb.drop());

function token(project: Awaited<ReturnType<typeof createProject>>, scope: string) {
  return project.tokens.find((t) => t.scope === scope)?.token ?? "";
}

/** Sends a run of "api". A "flaky" test passed after a retry. */
async function push(fields: Record<string, string>, statuses: string[]) {
  const tests = statuses.map((status, i) => ({
    name: `test ${i}`,
    status: status === "flaky" ? "passed" : status,
    flaky: status === "flaky",
    duration: 10,
  }));
  const res = await app.request("/v1/test-runs", {
    method: "POST",
    headers: { authorization: `Bearer ${ingest}`, "content-type": "application/json" },
    body: JSON.stringify({
      component: "api",
      ...fields,
      report: {
        results: { tool: { name: "playwright" }, summary: { tests: tests.length }, tests },
      },
    }),
  });
  expect(res.status).toBe(201);
}

function get(query: string, auth = read) {
  return app.request(`/v1/verdict?${query}`, { headers: { authorization: `Bearer ${auth}` } });
}

async function verdict(query: string, auth = read) {
  const res = await get(query, auth);
  expect(res.status).toBe(200);
  return Verdict.parse(await res.json());
}

const staging = "component=api&environment=staging";

describe("GET /v1/verdict", () => {
  it("passes when the latest run of every kind passed", async () => {
    const result = await verdict(`${staging}&version=1.0.0`);

    expect(result).toMatchObject({
      component: "api",
      environment: "staging",
      version: "1.0.0",
      outcome: "pass",
      message: "e2e passed.",
      policy: { name: "default", require: [] },
    });
    expect(result.reasons).toEqual([
      expect.objectContaining({ kind: "e2e", outcome: "pass", message: "2 passed, 1 flaky" }),
    ]);
    expect(result.reasons[0]?.run).toMatchObject({ version: "1.0.0", environment: "staging" });
  });

  it("judges each kind by its latest run, and fails if one failed", async () => {
    const result = await verdict(`${staging}&version=1.1.0`);

    expect(result).toMatchObject({ outcome: "fail", message: "smoke failed." });
    expect(result.reasons.map((r) => [r.kind, r.outcome, r.message])).toEqual([
      ["e2e", "pass", "1 passed"],
      ["smoke", "fail", "1 failed, 1 passed"],
    ]);
  });

  it("is unknown when a required kind never ran", async () => {
    const result = await verdict(`${staging}&version=1.0.0&require=smoke,e2e,smoke`);

    expect(result).toMatchObject({
      outcome: "unknown",
      message: "Evidence is missing for smoke.",
      policy: { require: ["e2e", "smoke"] },
    });
    expect(result.reasons[1]).toEqual({
      kind: "smoke",
      outcome: "unknown",
      message: "Required, but no run.",
      run: null,
    });
  });

  it("fails rather than being unknown when evidence is both failed and missing", async () => {
    const result = await verdict(`${staging}&version=1.1.0&require=uat`);

    expect(result).toMatchObject({
      outcome: "fail",
      message: "smoke failed. Evidence is missing for uat.",
    });
  });

  it("doesn't count a run with no tests as evidence", async () => {
    const result = await verdict(`${staging}&version=1.2.0`);

    expect(result).toMatchObject({ outcome: "unknown", message: "Evidence is missing for e2e." });
    expect(result.reasons[0]?.message).toBe("The latest run has no tests.");
  });

  it("is unknown for versions, components and environments it has never seen", async () => {
    for (const query of [
      `${staging}&version=9.9.9`,
      "component=web&environment=staging&version=1.0.0",
      "component=api&environment=production&version=1.0.0",
    ]) {
      expect(await verdict(query)).toMatchObject({
        outcome: "unknown",
        message: "No test run of this version in this environment.",
        reasons: [],
      });
    }
  });

  it("only counts runs of the project", async () => {
    expect(await verdict(`${staging}&version=1.0.0`, otherRead)).toMatchObject({
      outcome: "unknown",
    });
  });

  it("accepts ingest tokens, so gates can use the token they send results with", async () => {
    expect(await verdict(`${staging}&version=1.0.0`, ingest)).toMatchObject({ outcome: "pass" });
  });

  it("requires a token", async () => {
    const res = await app.request(`/v1/verdict?${staging}&version=1.0.0`);
    expect(res.status).toBe(401);
  });

  it("rejects a missing version and an invalid list of kinds", async () => {
    for (const [query, path] of [
      [staging, "version"],
      [`${staging}&version=1.0.0&require=e2e,,Smoke`, "require"],
    ]) {
      const res = await get(query as string);
      expect(res.status).toBe(400);
      const { error } = ApiError.parse(await res.json());
      expect(error.issues?.map((i) => i.path)).toEqual([path]);
    }
  });
});
