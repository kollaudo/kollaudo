import { ApiError, HealthMatrix, TestRunDetail, TestRunList } from "@kollaudo/schema";
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

  // Oldest first: frontend 1.0.0 then 1.1.0 on staging, 1.1.0 on dev, api on staging, one smoke
  // run, and one build-level unit run.
  await push({ component: "frontend", environment: "staging", version: "1.0.0" }, ["failed"]);
  await push({ component: "frontend", environment: "staging", version: "1.1.0", commit: "abc" }, [
    "passed",
    "passed",
  ]);
  await push({ component: "frontend", environment: "dev", version: "1.1.0" }, ["passed"]);
  await push({ component: "api", environment: "staging", version: "2.0.0" }, ["skipped"]);
  await push({ component: "api", environment: "staging", version: "2.0.0", kind: "smoke" }, []);
  await push({ component: "api", version: "2.0.1", kind: "unit" }, ["passed", "failed"]);
  await push(
    { component: "draft", environment: "staging", version: "0.1.0" },
    [],
    token(blog, "ingest"),
  );
});
afterAll(() => testDb.drop());

function token(project: Awaited<ReturnType<typeof createProject>>, scope: string) {
  return project.tokens.find((t) => t.scope === scope)?.token ?? "";
}

async function push(fields: Record<string, string>, statuses: string[], auth = ingest) {
  const tests = statuses.map((status, i) => ({
    name: `test ${i}`,
    status,
    duration: 10,
    suite: ["checkout", `step ${i}`],
    message: status === "failed" ? "boom" : undefined,
  }));
  const res = await app.request("/v1/test-runs", {
    method: "POST",
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({
      ...fields,
      report: {
        results: {
          tool: { name: "playwright" },
          summary: { tests: tests.length, start: 1_780_000_000_000, stop: 1_780_000_001_000 },
          tests,
        },
      },
    }),
  });
  expect(res.status).toBe(201);
}

function get(path: string, auth = read) {
  return app.request(path, { headers: { authorization: `Bearer ${auth}` } });
}

describe("GET /v1/test-runs", () => {
  it("lists the project's runs, newest first", async () => {
    const res = await get("/v1/test-runs");
    expect(res.status).toBe(200);
    const { items, next } = TestRunList.parse(await res.json());

    expect(items.map((r) => `${r.component} ${r.version} ${r.environment} ${r.kind}`)).toEqual([
      "api 2.0.1 null unit",
      "api 2.0.0 staging smoke",
      "api 2.0.0 staging e2e",
      "frontend 1.1.0 dev e2e",
      "frontend 1.1.0 staging e2e",
      "frontend 1.0.0 staging e2e",
    ]);
    expect(next).toBeNull();
    expect(items[4]).toMatchObject({
      commit: "abc",
      branch: null,
      tool: "playwright",
      startedAt: "2026-05-28T20:26:40.000Z",
      summary: { tests: 2, passed: 2 },
    });
  });

  it("filters by component, environment, version and kind", async () => {
    const list = async (query: string) =>
      TestRunList.parse(await (await get(`/v1/test-runs?${query}`)).json()).items;

    expect(await list("component=frontend")).toHaveLength(3);
    expect(await list("component=frontend&environment=staging")).toHaveLength(2);
    expect(await list("version=2.0.0&kind=smoke")).toHaveLength(1);
    expect(await list("component=nope")).toEqual([]);
  });

  it("pages with limit and before", async () => {
    const pages: string[][] = [];
    let before = "";
    do {
      const page = TestRunList.parse(
        await (await get(`/v1/test-runs?limit=4${before && `&before=${before}`}`)).json(),
      );
      pages.push(page.items.map((r) => r.version));
      before = page.next ?? "";
    } while (before);

    expect(pages).toEqual([
      ["2.0.1", "2.0.0", "2.0.0", "1.1.0"],
      ["1.1.0", "1.0.0"],
    ]);
  });

  it("rejects an invalid limit", async () => {
    const res = await get("/v1/test-runs?limit=1000");
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.issues?.[0]?.path).toBe("limit");
  });

  it("needs a read token", async () => {
    expect((await get("/v1/test-runs", ingest)).status).toBe(403);
  });
});

describe("GET /v1/test-runs/{id}", () => {
  it("returns a run with its results", async () => {
    const { items } = TestRunList.parse(await (await get("/v1/test-runs?kind=unit")).json());
    const res = await get(`/v1/test-runs/${items[0]?.id}`);
    expect(res.status).toBe(200);
    const run = TestRunDetail.parse(await res.json());

    expect(run).toMatchObject({ component: "api", environment: null, summary: { failed: 1 } });
    expect(run.results).toEqual([
      expect.objectContaining({ name: "test 0", status: "passed", suite: ["checkout", "step 0"] }),
      expect.objectContaining({ name: "test 1", status: "failed", message: "boom", tags: [] }),
    ]);
  });

  it("hides runs of other projects", async () => {
    const { items } = TestRunList.parse(await (await get("/v1/test-runs")).json());
    const res = await get(`/v1/test-runs/${items[0]?.id}`, otherRead);
    expect(res.status).toBe(404);
    expect(ApiError.parse(await res.json()).error.code).toBe("not_found");
  });

  it("rejects an id that isn't a UUID", async () => {
    expect((await get("/v1/test-runs/nope")).status).toBe(400);
  });
});

describe("GET /v1/health", () => {
  it("returns the latest run for each component, environment and kind", async () => {
    const res = await get("/v1/health");
    expect(res.status).toBe(200);
    const health = HealthMatrix.parse(await res.json());

    expect(health.components).toEqual(["api", "frontend"]);
    expect(health.environments).toEqual(["dev", "staging"]);
    expect(
      health.latest.map((r) => `${r.component} ${r.environment} ${r.kind} ${r.version}`),
    ).toEqual([
      "api null unit 2.0.1",
      "api staging e2e 2.0.0",
      "api staging smoke 2.0.0",
      "frontend dev e2e 1.1.0",
      "frontend staging e2e 1.1.0",
    ]);
  });

  it("keeps projects apart", async () => {
    const health = HealthMatrix.parse(await (await get("/v1/health", otherRead)).json());
    expect(health.components).toEqual(["draft"]);
    expect(health.latest).toHaveLength(1);
  });
});
