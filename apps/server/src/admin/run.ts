import { parseArgs } from "node:util";
import type { Db } from "../db/client.ts";
import {
  createProject,
  createProjectToken,
  listProjectTokens,
  revokeToken,
  UserError,
} from "../projects.ts";

export const HELP = `Usage: kollaudo-server [command]

Without a command, starts the Kollaudo server.

Commands:
  serve                                         Start the server (default)
  project create <project>                      Create a project, with one ingest and one read token
  token create <project> --scope ingest|read    Create a token for a project
  token list <project>                          List the tokens of a project
  token revoke <token-id>                       Revoke a token

Environment:
  DATABASE_URL      PostgreSQL connection string (required)
  PORT              HTTP port of the server (default 8080)
  KOLLAUDO_WEB_DIR  Directory of the built web UI (default: apps/web/dist)
`;

export interface Io {
  out: (text: string) => void;
  err: (text: string) => void;
}

/** Runs an admin command and returns the exit code. */
export async function runAdmin(args: string[], db: Db, io: Io): Promise<number> {
  try {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        scope: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    const [group, action, target] = positionals;

    if (values.help || !group) {
      io.out(HELP);
      return 0;
    }

    if (group === "project" && action === "create" && target) {
      const { project, tokens } = await createProject(db, target);
      io.out(`Created project "${project.name}".\n\n`);
      for (const t of tokens) io.out(`${t.scope.padEnd(7)} ${t.token}\n`);
      io.out("\nStore these tokens now: they can't be shown again.\n");
      return 0;
    }

    if (group === "token" && action === "create" && target) {
      if (values.scope !== "ingest" && values.scope !== "read") {
        throw new UserError("--scope must be ingest or read.");
      }
      const t = await createProjectToken(db, target, values.scope);
      io.out(`${t.scope.padEnd(7)} ${t.token}\n\nStore this token now: it can't be shown again.\n`);
      return 0;
    }

    if (group === "token" && action === "list" && target) {
      const tokens = await listProjectTokens(db, target);
      io.out(
        "ID                                    SCOPE   TOKEN     CREATED     LAST USED   STATUS\n",
      );
      for (const t of tokens) {
        const columns = [
          t.id,
          t.scope.padEnd(7),
          `${t.hint}…`.padEnd(9),
          day(t.createdAt),
          day(t.lastUsedAt).padEnd(11),
          t.revokedAt ? `revoked ${day(t.revokedAt)}` : "active",
        ];
        io.out(`${columns.join(" ")}\n`);
      }
      return 0;
    }

    if (group === "token" && action === "revoke" && target) {
      await revokeToken(db, target);
      io.out(`Revoked token ${target}.\n`);
      return 0;
    }

    throw new UserError(`Unknown command: ${positionals.join(" ")}`);
  } catch (error) {
    if (!(error instanceof UserError) && !isArgsError(error)) throw error;
    io.err(`${error.message}\n\nRun "kollaudo-server --help" for usage.\n`);
    return 1;
  }
}

function day(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "never";
}

function isArgsError(error: unknown): error is Error {
  return (
    error instanceof Error && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS")
  );
}
