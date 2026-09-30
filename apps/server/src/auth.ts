import { createMiddleware } from "hono/factory";
import type { Db } from "./db/client.ts";
import { errorResponse } from "./errors.ts";
import { findToken, type TokenScope } from "./tokens.ts";

export interface AuthEnv {
  Variables: { projectId: string };
}

/** Requires a valid API token with one of the given scopes (ADR 0007): `401` without one, `403` if the scope is wrong. */
export function requireScope(db: Db, ...scopes: TokenScope[]) {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "")?.[1];
    const found = token ? await findToken(db, token) : undefined;
    if (!found) {
      c.header("WWW-Authenticate", "Bearer");
      return errorResponse(c, 401, "unauthorized", "A valid API token is required.");
    }
    if (!scopes.includes(found.scope)) {
      return errorResponse(
        c,
        403,
        "forbidden",
        `This endpoint needs a token with the ${scopes.join(" or ")} scope.`,
      );
    }
    c.set("projectId", found.projectId);
    await next();
  });
}
