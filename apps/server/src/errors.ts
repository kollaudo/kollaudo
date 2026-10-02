import type { ApiError } from "@kollaudo/schema";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

/** An error with a meaning for API clients, turned into a JSON error response. */
export class HttpError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;
  readonly issues: ApiError["error"]["issues"];

  constructor(
    status: ContentfulStatusCode,
    code: string,
    message: string,
    issues?: ApiError["error"]["issues"],
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  issues?: ApiError["error"]["issues"],
) {
  return c.json({ error: { code, message, issues } } satisfies ApiError, status);
}

export function validationResponse(c: Context, error: z.ZodError) {
  const issues = error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
  return errorResponse(c, 400, "invalid_request", "The request is not valid.", issues);
}
