import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export type Db = ReturnType<typeof createDb>["db"];
/** A database or a transaction: functions that accept it can run inside a transaction. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Connects to PostgreSQL. Call `close` when done, or the process won't exit. */
export function createDb(url: string) {
  const client = postgres(url, { onnotice: () => {} });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, close: () => client.end() };
}

/** Any number, the same in every instance: it names the lock that migrations hold. */
const MIGRATION_LOCK = 0x6b6f6c6c; // "koll"

/**
 * Applies pending migrations. Safe to run on every start, and from several instances at once, such
 * as replicas starting together: they take turns, and only the first one finds work to do.
 */
export async function migrateDb(db: Db) {
  // An advisory lock belongs to the connection that took it: one connection holds it while the
  // migrations run on the others.
  const connection = await db.$client.reserve();
  try {
    await connection`select pg_advisory_lock(${MIGRATION_LOCK})`;
    await migrate(db, { migrationsFolder });
  } finally {
    await connection`select pg_advisory_unlock(${MIGRATION_LOCK})`;
    connection.release();
  }
}
