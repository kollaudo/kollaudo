import { readFileSync } from "node:fs";
import { afterAll, expect, it } from "vitest";
import { createTestDb } from "../testing.ts";
import { createDb, migrateDb } from "./client.ts";

const testDb = await createTestDb({ migrate: false });
afterAll(() => testDb.drop());

it("migrates once when several instances start together", async () => {
  // Replicas of a deployment starting at the same time, each with its own pool.
  const instances = Array.from({ length: 4 }, () => createDb(testDb.url));
  try {
    await Promise.all(instances.map(({ db }) => migrateDb(db)));
  } finally {
    await Promise.all(instances.map(({ close }) => close()));
  }

  const applied = await testDb.db.execute<{ count: number }>(
    "select count(*)::int as count from drizzle.__drizzle_migrations",
  );
  const journal = JSON.parse(
    readFileSync(new URL("../../drizzle/meta/_journal.json", import.meta.url), "utf8"),
  );
  expect(applied[0]?.count).toBe(journal.entries.length);
});
