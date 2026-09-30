import { readFileSync } from "node:fs";
import { ApiError, Healthz, TestRunCreated } from "@kollaudo/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, VERSION } from "./app.ts";
import { components, testResults, testRuns, versions } from "./db/schema.ts";
import { createProject } from "./projects.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
let ingest: string;
let read: string;

beforeAll(async () => {
  testDb = await createTestDb();
  app = createApp({ db: testDb.db });
  const { tokens } = await createProject(testDb.db, "shop");
  ingest = tokens.find((t) => t.scope === "ingest")?.token ?? "";
  read = tokens.find((t) => t.scope === "read")?.token ?? "";
});
afterAll(() => testDb.drop());

const report = (tests: Record<string, unknown>[]) => ({
  reportFormat: "CTRF",
  specVersion: "0.0.0",
  results: {
    tool: { name: "playwright", version: "1.55.0" },
    summary: { tests: tests.length, start: 1_780_000_000_000, stop: 1_780_000_060_000 },
    tests,
  },
});

const tests = [
  { name: "logs in", status: "passed", duration: 120.4, suite: "auth.spec.ts > login" },
  { name: "logs out", status: "passed", duration: 80, flaky: true, retries: 1 },
  {
    name: "pays",
    status: "failed",
    duration: 300,
    suite: ["checkout", "payment"],
    message: "Expected 200, got 500",
    tags: ["@smoke"],
    attachments: [{ name: "screenshot", path: "pays.png" }],
  },
  { name: "refunds", status: "skipped", duration: 0 },
];

function post(body: unknown, token = ingest) {
  return app.request("/v1/test-runs", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("GET /healthz", () => {
  it("answers ok without a token", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
    expect(Healthz.parse(await res.json()).status).toBe("ok");
  });

  it("reports the version of the server package", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});

describe("GET /v1/openapi.json", () => {
  it("documents the API", async () => {
    const doc = await (await app.request("/v1/openapi.json")).json();
    expect(doc.openapi).toBe("3.1.0");
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(["/healthz", "/v1/project", "/v1/test-runs"]),
    );
    expect(doc.components.schemas).toHaveProperty("TestRunInput");
  });
});

describe("authentication", () => {
  it("rejects a missing token with 401", async () => {
    const res = await app.request("/v1/project");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(ApiError.parse(await res.json()).error.code).toBe("unauthorized");
  });

  it("rejects an unknown token with 401", async () => {
    const res = await app.request("/v1/project", {
      headers: { authorization: "Bearer kol_nope" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token with the wrong scope with 403", async () => {
    const res = await app.request("/v1/project", {
      headers: { authorization: `Bearer ${ingest}` },
    });
    expect(res.status).toBe(403);
    expect((await post(report(tests), read)).status).toBe(403);
  });
});

describe("GET /v1/project", () => {
  it("returns the token's project", async () => {
    const res = await app.request("/v1/project", { headers: { authorization: `Bearer ${read}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ name: "shop" });
  });
});

describe("POST /v1/test-runs", () => {
  it("stores a CTRF report and returns its summary", async () => {
    const res = await post({
      component: "frontend",
      environment: "staging",
      version: "1.2.0",
      commit: "a1b2c3",
      report: report(tests),
    });

    expect(res.status).toBe(201);
    const run = TestRunCreated.parse(await res.json());
    expect(run).toMatchObject({
      component: "frontend",
      environment: "staging",
      version: "1.2.0",
      kind: "e2e",
      summary: { tests: 4, passed: 2, failed: 1, skipped: 1, pending: 0, other: 0, flaky: 1 },
    });

    const [stored] = await testDb.db.select().from(testRuns).where(eq(testRuns.id, run.id));
    expect(stored).toMatchObject({ tool: "playwright", failed: 1 });
    expect(stored?.startedAt?.getTime()).toBe(1_780_000_000_000);

    const results = await testDb.db
      .select()
      .from(testResults)
      .where(eq(testResults.testRunId, run.id));
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName["logs in"]).toMatchObject({ suite: ["auth.spec.ts", "login"], durationMs: 120 });
    expect(byName["logs out"]).toMatchObject({ flaky: true, retries: 1 });
    expect(byName.pays).toMatchObject({
      suite: ["checkout", "payment"],
      message: "Expected 200, got 500",
      tags: ["@smoke"],
      extra: { attachments: [{ name: "screenshot", path: "pays.png" }] },
    });
  });

  it("reuses components and versions, and stores build-level runs without an environment", async () => {
    const res = await post({
      component: "frontend",
      version: "1.2.0",
      kind: "unit",
      report: report(tests),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ environment: null, kind: "unit" });
    expect(await testDb.db.select().from(components)).toHaveLength(1);
    expect(await testDb.db.select().from(versions)).toHaveLength(1);
  });

  it("fills in missing version metadata", async () => {
    await post({ component: "frontend", version: "1.2.0", branch: "main", report: report([]) });

    const [version] = await testDb.db.select().from(versions);
    expect(version).toMatchObject({ commit: "a1b2c3", branch: "main" });
  });

  it("refuses to change version metadata with 409", async () => {
    const res = await post({
      component: "frontend",
      version: "1.2.0",
      commit: "ffffff",
      report: report([]),
    });

    expect(res.status).toBe(409);
    expect(ApiError.parse(await res.json()).error.code).toBe("version_conflict");
  });

  it("refuses results of another artifact under the same version", async () => {
    const send = (digest: string) =>
      post({ component: "frontend", version: "1.2.0", digest, report: report([]) });

    expect((await send("sha256:aaa")).status).toBe(201);
    expect((await send("sha256:aaa")).status).toBe(201);
    const res = await send("sha256:bbb");
    expect(res.status).toBe(409);
    expect(ApiError.parse(await res.json()).error.message).toContain('digest "sha256:aaa"');
  });

  it("rejects an invalid report with the path of each problem", async () => {
    const res = await post({
      component: "frontend",
      version: "1.2.0",
      report: report([{ name: "t", status: "broken", duration: 1 }]),
    });

    expect(res.status).toBe(400);
    const { error } = ApiError.parse(await res.json());
    expect(error.issues?.map((i) => i.path)).toEqual(["report.results.tests.0.status"]);
  });

  it("rejects invalid names", async () => {
    const res = await post({ component: "my app", version: "1 2", report: report([]) });

    expect(res.status).toBe(400);
    const paths = ApiError.parse(await res.json()).error.issues?.map((i) => i.path);
    expect(paths).toEqual(["component", "version"]);
  });

  it("rejects malformed JSON", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).error.code).toBe("invalid_request");
  });

  it("keeps projects apart", async () => {
    const other = await createProject(testDb.db, "blog");
    const otherIngest = other.tokens.find((t) => t.scope === "ingest")?.token ?? "";

    await post({ component: "frontend", version: "1.2.0", report: report([]) }, otherIngest);

    const rows = await testDb.db
      .select()
      .from(components)
      .where(eq(components.projectId, other.project.id));
    expect(rows).toHaveLength(1);
    expect(await testDb.db.select().from(components)).toHaveLength(2);
  });
});

describe("unknown routes", () => {
  it("answer 404 with a JSON error", async () => {
    const res = await app.request("/v1/nope");
    expect(res.status).toBe(404);
    expect(ApiError.parse(await res.json()).error.code).toBe("not_found");
  });
});
