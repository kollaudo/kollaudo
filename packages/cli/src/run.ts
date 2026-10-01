import { parseArgs } from "node:util";
import type { Io } from "./io.ts";
import { push } from "./push.ts";
import { verdict } from "./verdict.ts";

/** Same as in package.json: a test checks it, and the release workflow checks the tag. */
export const VERSION = "0.1.1";

export const HELP = `Usage: kollaudo <command> [options]

Send test results to Kollaudo and gate promotions on its verdict, from any CI or script.

Commands:
  push <report>   Send test results: CTRF or JUnit reports
  verdict         Ask whether a version is healthy in an environment

Options:
  -h, --help      Show this help
  -v, --version   Show the CLI version

Environment:
  KOLLAUDO_URL    URL of your Kollaudo server
  KOLLAUDO_TOKEN  API token of your project

Run "kollaudo <command> --help" for the options of a command.
`;

/** Runs the CLI with the given arguments and returns the exit code. */
export async function run(args: string[], io: Io): Promise<number> {
  // Commands parse their own options: `push --version` is the version under test, not the CLI's.
  if (args[0] === "push") return push(args.slice(1), io);
  if (args[0] === "verdict") return verdict(args.slice(1), io);

  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(args);
  } catch (error) {
    io.err(`${(error as Error).message}\n\n${HELP}`);
    return 1;
  }

  const { values, positionals } = parsed;

  if (values.version) {
    io.out(`${VERSION}\n`);
    return 0;
  }

  if (values.help || positionals.length === 0) {
    io.out(HELP);
    return 0;
  }

  io.err(`Unknown command: ${positionals[0]}\n\n${HELP}`);
  return 1;
}

function parse(args: string[]) {
  return parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}
