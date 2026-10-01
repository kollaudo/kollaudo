#!/usr/bin/env node
import { glob, readFile } from "node:fs/promises";
import { run } from "./run.ts";

// Exit quietly when the output is piped to a command that stops reading, such as `head`.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

process.exitCode = await run(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  env: process.env,
  readFile: (path) => readFile(path, "utf8"),
  glob: async (pattern) => {
    const paths: string[] = [];
    for await (const path of glob(pattern)) paths.push(path);
    return paths.sort();
  },
  fetch,
});
