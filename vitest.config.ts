import { defineConfig } from "vitest/config";

export default defineConfig({
  ssr: {
    resolve: {
      conditions: ["development"],
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "server", root: "apps/server" },
      },
      {
        extends: true,
        test: { name: "cli", root: "packages/cli" },
      },
      {
        extends: true,
        test: { name: "schema", root: "packages/schema" },
      },
      {
        extends: true,
        test: { name: "web", root: "apps/web" },
      },
    ],
  },
});
