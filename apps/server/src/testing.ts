// Test helper: a fresh, migrated database for each test file, dropped afterwards.

import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createDb, migrateDb } from "./db/client.ts";

const adminUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://kollaudo:kollaudo@localhost:5432/kollaudo";

export async function createTestDb() {
  const name = `kollaudo_test_${randomBytes(6).toString("hex")}`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`CREATE DATABASE ${name}`);
  } catch (error) {
    await admin.end();
    throw new Error(
      `Can't create a test database on ${adminUrl}. Start PostgreSQL with ` +
        `"docker compose up -d", or set TEST_DATABASE_URL.`,
      { cause: error },
    );
  }

  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const { db, close } = createDb(url.toString());
  await migrateDb(db);

  return {
    db,
    async drop() {
      await close();
      await admin.unsafe(`DROP DATABASE ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
