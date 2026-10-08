import { matchesGlob } from "node:path";
import type { Io } from "./io.ts";

interface FakeIo {
  env?: Io["env"];
  files?: Record<string, string>;
  fetch?: Io["fetch"];
}

/** A server that answers every request 200 with a web page, like the UI or a login portal. */
export const webPage: Io["fetch"] = async () =>
  new Response("<!DOCTYPE html><html><body>Kollaudo</body></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });

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
    glob: async (pattern) =>
      Object.keys(fake.files ?? {})
        .filter((path) => matchesGlob(path, pattern))
        .sort(),
    fetch: fake.fetch ?? (() => Promise.reject(new Error("No network in tests"))),
  });
  return { code, out, err };
}
