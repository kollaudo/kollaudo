import { describe, expect, it } from "vitest";
import { createTestDb } from "../testing.ts";
import { DatabaseUnreachable, describeTarget, waitForDatabase } from "./wait.ts";

describe("waitForDatabase", () => {
  it("resolves when the database answers", async () => {
    const testDb = await createTestDb({ migrate: false });
    try {
      await expect(waitForDatabase(testDb.url, { waitMs: 5_000, log: () => {} })).resolves.toBe(
        undefined,
      );
    } finally {
      await testDb.drop();
    }
  });

  it("gives up with a message that says what to check, without the password", async () => {
    const logs: string[] = [];
    const started = Date.now();
    // Nothing listens on port 1: the connection is refused at once.
    const waiting = waitForDatabase("postgres://kollaudo:s3cret@127.0.0.1:1/kollaudo", {
      waitMs: 3_000,
      log: (text) => logs.push(text),
    });

    await expect(waiting).rejects.toThrow(DatabaseUnreachable);
    await expect(waiting).rejects.toThrow(
      /^Can't reach the database at 127\.0\.0\.1:1\/kollaudo \(ECONNREFUSED\)\. Check DATABASE_URL/,
    );
    await expect(waiting).rejects.not.toThrow(/s3cret/);
    expect(Date.now() - started).toBeLessThan(6_000);
    expect(logs).toEqual(["Waiting for the database at 127.0.0.1:1/kollaudo (ECONNREFUSED)…\n"]);
  });

  it("gives up at once on errors that waiting won't fix, such as an unknown database", async () => {
    const testDb = await createTestDb({ migrate: false });
    const url = new URL(testDb.url);
    url.pathname = "/kollaudo_does_not_exist";
    try {
      const started = Date.now();
      await expect(
        waitForDatabase(url.toString(), { waitMs: 30_000, log: () => {} }),
      ).rejects.toThrow(/refused the connection \(3D000\).*Check the user, the password/);
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      await testDb.drop();
    }
  });

  it("describes where a URL points, without credentials", () => {
    expect(describeTarget("postgres://u:p@postgres:5432/kollaudo")).toBe("postgres:5432/kollaudo");
    expect(describeTarget("postgres://u:p@db.example.com/k")).toBe("db.example.com:5432/k");
    expect(describeTarget("not a url")).toBe("the DATABASE_URL");
  });
});
