import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, revokeToken } from "./projects.ts";
import { createTestDb } from "./testing.ts";
import { findToken, generateToken, hashToken } from "./tokens.ts";

describe("generateToken", () => {
  it("creates unique kol_ tokens with 256 random bits", () => {
    const a = generateToken();
    expect(a).toMatch(/^kol_[A-Za-z0-9_-]{43}$/);
    expect(generateToken()).not.toBe(a);
  });
});

describe("findToken", () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>;
  beforeAll(async () => {
    testDb = await createTestDb();
  });
  afterAll(() => testDb.drop());

  it("finds a token by its value and records its use", async () => {
    const { project, tokens } = await createProject(testDb.db, "find");
    const [ingest] = tokens;

    const found = await findToken(testDb.db, ingest?.token ?? "");

    expect(found).toEqual({
      id: ingest?.id,
      projectId: project.id,
      scope: "ingest",
      name: null,
      hint: ingest?.token.slice(0, 8),
      // Tokens created with a project have no limits.
      components: null,
      environments: null,
      build: true,
    });
  });

  it("ignores unknown and malformed tokens", async () => {
    expect(await findToken(testDb.db, generateToken())).toBeUndefined();
    expect(await findToken(testDb.db, "not-a-token")).toBeUndefined();
  });

  it("ignores revoked tokens", async () => {
    const { tokens } = await createProject(testDb.db, "revoked");
    const [ingest] = tokens;
    await revokeToken(testDb.db, ingest?.id ?? "");

    expect(await findToken(testDb.db, ingest?.token ?? "")).toBeUndefined();
  });

  it("stores only the hash", async () => {
    const { tokens } = await createProject(testDb.db, "hashed");
    const rows = await testDb.db.query.apiTokens.findMany();
    const values = JSON.stringify(rows);

    for (const t of tokens) {
      expect(values).not.toContain(t.token);
      expect(values).toContain(hashToken(t.token));
    }
  });
});
