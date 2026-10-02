import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "./db/client.ts";
import { apiTokens, projects } from "./db/schema.ts";
import { createToken, type TokenOptions, type TokenScope } from "./tokens.ts";

/** An error caused by the user's input, reported without a stack trace. */
export class UserError extends Error {}

const PROJECT_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** Creates a project with one `ingest` and one `read` token (ADR 0007). */
export async function createProject(db: Db, name: string) {
  if (!PROJECT_NAME.test(name)) {
    throw new UserError(
      `Invalid project name "${name}": use up to 64 lowercase letters, digits, ".", "_" or "-", starting with a letter or digit.`,
    );
  }

  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ name })
      .onConflictDoNothing()
      .returning({ id: projects.id, name: projects.name });
    if (!project) throw new UserError(`Project "${name}" already exists.`);

    const ingest = await createToken(tx, project.id, "ingest");
    const read = await createToken(tx, project.id, "read");
    return { project, tokens: [ingest, read] };
  });
}

async function getProject(db: Db, name: string) {
  const [project] = await db.select().from(projects).where(eq(projects.name, name));
  if (!project) throw new UserError(`Project "${name}" not found.`);
  return project;
}

/** Names and patterns of components and environments, as in the API, with `*` for any characters. */
const LIMIT = /^[A-Za-z0-9*][A-Za-z0-9._/*-]{0,99}$/;
const TOKEN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export async function createProjectToken(
  db: Db,
  projectName: string,
  scope: TokenScope,
  options: TokenOptions = {},
) {
  if (options.name !== undefined && !TOKEN_NAME.test(options.name)) {
    throw new UserError(
      `Invalid token name "${options.name}": use up to 64 letters, digits, ".", "_" or "-".`,
    );
  }
  for (const limit of [...(options.components ?? []), ...(options.environments ?? [])]) {
    if (!LIMIT.test(limit)) {
      throw new UserError(
        `Invalid limit "${limit}": use a component or environment name, with * for any characters.`,
      );
    }
  }
  const limited =
    options.components?.length || options.environments?.length || options.build !== undefined;
  if (limited && scope !== "ingest") {
    throw new UserError("Only ingest tokens can be limited to components and environments.");
  }
  if (options.build && !options.environments?.length) {
    throw new UserError("--build only matters with --environment: other tokens send build runs.");
  }
  const project = await getProject(db, projectName);
  return createToken(db, project.id, scope, options);
}

export async function listProjectTokens(db: Db, projectName: string) {
  const project = await getProject(db, projectName);
  return db
    .select({
      id: apiTokens.id,
      scope: apiTokens.scope,
      hint: apiTokens.hint,
      name: apiTokens.name,
      components: apiTokens.components,
      environments: apiTokens.environments,
      build: apiTokens.build,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
      revokedAt: apiTokens.revokedAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.projectId, project.id))
    .orderBy(asc(apiTokens.createdAt));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function revokeToken(db: Db, tokenId: string) {
  if (!UUID.test(tokenId)) throw new UserError(`Invalid token id "${tokenId}".`);
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiTokens.id, tokenId), isNull(apiTokens.revokedAt)))
    .returning({ id: apiTokens.id });
  if (!row) throw new UserError(`No active token with id "${tokenId}".`);
}
