#!/usr/bin/env node
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { HELP, runAdmin } from "./admin/run.ts";
import { createApp } from "./app.ts";
import { createDb, migrateDb } from "./db/client.ts";

const args = process.argv.slice(2);

// Exit quietly when the output is piped to a command that stops reading, such as `head`.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write("DATABASE_URL is not set. See kollaudo-server --help.\n");
  process.exit(1);
}

const { db, close } = createDb(databaseUrl);
await migrateDb(db);

if (args.length === 0 || args[0] === "serve") {
  const port = Number(process.env.PORT ?? 8080);
  // Next to the server in the repository and in the container image.
  const webDir =
    process.env.KOLLAUDO_WEB_DIR ?? fileURLToPath(new URL("../../web/dist", import.meta.url));
  const hasWeb = existsSync(webDir);
  if (!hasWeb) console.warn(`No web UI in ${webDir}: serving the API only.`);
  const app = createApp({ db, webDir: hasWeb ? webDir : undefined });
  serve({ fetch: app.fetch, port }, (info) => {
    console.log(`Kollaudo listening on http://localhost:${info.port}`);
  });
} else {
  process.exitCode = await runAdmin(args, db, {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
  await close();
}
