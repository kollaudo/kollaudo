import type { Io } from "./io.ts";

interface FakeIo {
  env?: Io["env"];
  files?: Record<string, string>;
  fetch?: Io["fetch"];
}

/** Runs a CLI function with fake files, environment and network, and collects its output. */
export async function runWith(
  fn: (args: string[], io: Io) => Promise<number>,
  args: string[],
  fake: FakeIo = {},
) {
  let out = "";
  let err = "";
  const code = await fn(args, {
    out: (t) => {
      out += t;
    },
    err: (t) => {
      err += t;
    },
    env: fake.env ?? {},
    readFile: async (path) => {
      const content = fake.files?.[path];
      if (content === undefined) throw new Error(`ENOENT: no such file or directory '${path}'`);
      return content;
    },
    fetch: fake.fetch ?? (() => Promise.reject(new Error("No network in tests"))),
  });
  return { code, out, err };
}
