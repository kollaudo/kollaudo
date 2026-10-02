import { Readyz } from "@kollaudo/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createDb } from "./db/client.ts";
import { createTestDb } from "./testing.ts";

let testDb: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  testDb = await createTestDb();
});
afterAll(() => testDb.drop());

describe("GET /readyz", () => {
  it("is ready when the database answers, without a token", async () => {
    const res = await createApp({ db: testDb.db }).request("/readyz");
    expect(res.status).toBe(200);
    expect(Readyz.parse(await res.json())).toEqual({ status: "ready", database: "ok" });
  });

  it("is not ready when the database doesn't answer", async () => {
    // Nothing listens on port 1: the connection is refused at once.
    const { db, close } = createDb("postgres://kollaudo:kollaudo@127.0.0.1:1/kollaudo");
    try {
      const app = createApp({ db });
      const res = await app.request("/readyz");
      expect(res.status).toBe(503);
      expect(Readyz.parse(await res.json())).toEqual({
        status: "not_ready",
        database: "unreachable",
      });
      // The process is still alive: liveness doesn't depend on the database.
      expect((await app.request("/healthz")).status).toBe(200);
    } finally {
      await close();
    }
  });
});
