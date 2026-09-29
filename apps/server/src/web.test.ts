import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;
let app: ReturnType<typeof createApp>;
const webDir = mkdtempSync(join(tmpdir(), "kollaudo-web-"));

beforeAll(async () => {
  writeFileSync(join(webDir, "index.html"), "<!doctype html><title>Kollaudo</title>");
  mkdirSync(join(webDir, "assets"));
  writeFileSync(join(webDir, "assets", "app-1a2b3c.js"), "console.log('hi')");
  testDb = await createTestDb();
  app = createApp({ db: testDb.db, webDir });
});
afterAll(async () => {
  await testDb.drop();
  rmSync(webDir, { recursive: true, force: true });
});

describe("web UI", () => {
  it("serves the UI at the root", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<title>Kollaudo</title>");
  });

  it("serves the UI for its own routes, such as the link printed by the CLI", async () => {
    const res = await app.request("/test-runs/4f5c2d7e-8a1b-4c3d-9e0f-123456789abc");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("<title>Kollaudo</title>");
  });

  it("caches hashed assets forever", async () => {
    const res = await app.request("/assets/app-1a2b3c.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("answers 404 for missing assets and API paths", async () => {
    expect((await app.request("/assets/missing.js")).status).toBe(404);
    const api = await app.request("/v1/nope");
    expect(api.status).toBe(404);
    expect(await api.json()).toMatchObject({ error: { code: "not_found" } });
  });

  it("keeps the API working", async () => {
    expect((await app.request("/healthz")).status).toBe(200);
    expect((await app.request("/v1/project")).status).toBe(401);
  });
});
