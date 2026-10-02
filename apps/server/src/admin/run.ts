import { parseArgs } from "node:util";
import type { Db } from "../db/client.ts";
import {
  createProject,
  createProjectToken,
  listProjectTokens,
  revokeToken,
  UserError,
} from "../projects.ts";
import type { TokenScope } from "../tokens.ts";

export const HELP = `Usage: kollaudo-server [command]

Without a command, starts the Kollaudo server.

Commands:
  serve                                         Start the server (default)
  project create <project>                      Create a project, with one ingest and one read token
  token create <project> --scope <scope>        Create a token for a project
  token list <project>                          List the tokens of a project
  token revoke <token-id>                       Revoke a token

Token scopes:
  ingest    send test results and deployments, and ask for verdicts
  read      read everything, and ask for verdicts
  policy    send the rules of the verdict (kollaudo policy push)
  override  let a version through a gate, with a reason (kollaudo override)

Options of token create:
  --name <name>          A name for people, such as ci-staging, shown with what the token sends
  --component <name>     Limit an ingest token to components: repeat it, use * for any characters
  --environment <name>   Limit an ingest token to environments, such as staging or pr-*
  --build                Let a token limited to environments also send build-level runs

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
        name: { type: "string" },
        component: { type: "string", multiple: true },
        environment: { type: "string", multiple: true },
        build: { type: "boolean" },
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
      for (const t of tokens) io.out(`${t.scope.padEnd(8)} ${t.token}\n`);
      io.out("\nStore these tokens now: they can't be shown again.\n");
      return 0;
    }

    if (group === "token" && action === "create" && target) {
      if (!SCOPES.includes(values.scope as TokenScope)) {
        throw new UserError(`--scope must be ${SCOPES.join(", ")}.`);
      }
      const t = await createProjectToken(db, target, values.scope as TokenScope, {
        name: values.name,
        components: values.component,
        environments: values.environment,
        build: values.build,
      });
      io.out(`${t.scope.padEnd(8)} ${t.token}\n\nStore this token now: it can't be shown again.\n`);
      return 0;
    }

    if (group === "token" && action === "list" && target) {
      const tokens = await listProjectTokens(db, target);
      io.out(
        "ID                                    SCOPE    TOKEN     NAME         CREATED     LAST USED   STATUS        LIMITS\n",
      );
      for (const t of tokens) {
        const columns = [
          t.id,
          t.scope.padEnd(8),
          `${t.hint}…`.padEnd(9),
          (t.name ?? "-").padEnd(12),
          day(t.createdAt),
          day(t.lastUsedAt).padEnd(11),
          (t.revokedAt ? `revoked ${day(t.revokedAt)}` : "active").padEnd(13),
          limits(t),
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

const SCOPES: TokenScope[] = ["ingest", "read", "policy", "override"];

function limits(t: { components: string[] | null; environments: string[] | null; build: boolean }) {
  const parts = [
    t.components && `components ${t.components.join(",")}`,
    t.environments && `environments ${t.environments.join(",")}`,
    t.environments && t.build && "build",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : "-";
}

function day(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "never";
}

function isArgsError(error: unknown): error is Error {
  return (
    error instanceof Error && "code" in error && String(error.code).startsWith("ERR_PARSE_ARGS")
  );
}
