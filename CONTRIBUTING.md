# Contributing to Kollaudo

Thanks for your interest! Kollaudo is at an early stage, so the most valuable contributions right
now are use cases, feedback on the design and recipes for the tools you use.

## Where to start

- **Good first issues**: [issues labeled `good first issue`](https://github.com/kollaudo/kollaudo/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22)
  are small, and say what to do, where, and when it's done. Comment on one to take it, so that
  nobody else works on it at the same time.
- **Ideas and bugs**: open an [issue](https://github.com/kollaudo/kollaudo/issues) first, so we can
  agree on the approach before you write code.
- **Design**: read the [architecture decisions](docs/adr). A change that goes against an accepted ADR
  needs a new ADR that supersedes it.
- **Tool-specific support** belongs in a recipe, not in the core
  ([ADR 0003](docs/adr/0003-tool-agnostic-core.md)). A recipe is one Markdown file in
  [`docs/recipes`](docs/recipes): see [the Playwright recipe](docs/recipes/playwright.md) for the
  format.

## Set up

You need Node.js 24 and Docker. The repository is a pnpm monorepo:

| Directory | What |
|---|---|
| [`apps/server`](apps/server) | the API, with Hono and PostgreSQL through Drizzle |
| [`apps/web`](apps/web) | the web UI, with React and Vite |
| [`packages/cli`](packages/cli) | the `kollaudo` command, published on npm as `@kollaudo/cli` |
| [`packages/schema`](packages/schema) | the types and Zod schemas shared by all of them |
| [`e2e`](e2e) | the end-to-end test, with the CLI and Playwright against the container |
| [`charts/kollaudo`](charts/kollaudo) | the Helm chart |

```bash
corepack enable                                     # provides the pinned pnpm version
pnpm install
docker compose up -d                                # PostgreSQL for local development
cp apps/server/.env.example apps/server/.env
pnpm admin project create demo                      # prints an ingest and a read token
pnpm dev                                            # API on :8080, UI with hot reload on :5173
```

The README's [Development](README.md#development) section explains the end-to-end test.

## Before you open a pull request

Run what CI runs:

```bash
pnpm check        # lint and format with Biome; pnpm format fixes what it can
pnpm typecheck
pnpm test         # tests that need a database create a temporary one on the local PostgreSQL
```

- Keep each pull request focused on one change.
- Add or update tests for the behavior you change. Tests sit next to the code, as `*.test.ts`.
- Update the documentation when behavior visible to users changes, and add a line to the
  `[Unreleased]` section of [`CHANGELOG.md`](CHANGELOG.md).
- After changing `apps/server/src/db/schema.ts`, generate a migration with
  `pnpm --filter @kollaudo/server db:generate`, and commit it.
- Use [Conventional Commits](https://www.conventionalcommits.org) for commit messages and pull
  request titles, for example `feat(cli): add push command` or `docs: explain versions`. Pull
  requests are squashed, so the title becomes the commit on `main`.

Once your pull request is merged, you appear among the contributors in the README by yourself, within
a few minutes: no need to add your name anywhere.

New dependencies need a reason: Kollaudo tries to stay small. Prefer a version that has been out for
at least a week over one released yesterday.

## Using AI tools

AI assistants are welcome, for code, tests and docs. Two things:

- **You're the author.** You understand every line you send, you've run the checks yourself, and you
  can answer questions about it in the review. A pull request is judged the same way, whoever or
  whatever helped write it.
- **Say so in the pull request**, in a line such as "Written with help from <tool>". It helps the
  review, and it's never a reason to turn a contribution down.

What [Licensing](#licensing) says applies to generated code too: don't send code you couldn't
contribute yourself.

## Licensing

Kollaudo is licensed under [Apache-2.0](LICENSE). By contributing, you agree that your contribution
is licensed under the same terms.

Only contribute code that you wrote yourself, or that you have the right to contribute under
Apache-2.0. Don't copy code from proprietary projects or from projects with incompatible licenses.

## Security issues

Don't open public issues for vulnerabilities. See the
[security policy](https://github.com/kollaudo/.github/blob/main/SECURITY.md).
