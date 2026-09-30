# Releasing

A release publishes the container image `ghcr.io/kollaudo/kollaudo`, the CLI `@kollaudo/cli` on npm,
and a GitHub release. Pushing a tag `v<version>` starts [`release.yml`](../.github/workflows/release.yml),
which refuses the tag unless:

- it points to a commit on `main`;
- every `package.json` in `apps/`, `packages/` and `e2e/` has that version (tests check that the
  `VERSION` constants of the server and the CLI match them);
- `CHANGELOG.md` has a section `## [<version>] - <date>`.

A version with a suffix, such as `0.2.0-rc.1`, is a pre-release: the image doesn't get the
`latest` and `0.2` tags, the CLI is published under the npm tag `next`, and the GitHub release is
marked as a pre-release.

## Steps

1. On a branch, set the version in every `package.json` and in the `VERSION` constants of
   `apps/server/src/app.ts` and `packages/cli/src/run.ts`. Date the section of `CHANGELOG.md`.
   Merge the pull request.
2. Tag the merge commit and push the tag:

   ```bash
   git switch main && git pull
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. Follow the workflow in the Actions tab.

## One-time setup

npm can only trust a workflow for a package that already exists, so the first version of the CLI is
published by hand, before its tag. The workflow then sees it on npm and skips it.

1. On npmjs.com, create the `kollaudo` organization, and turn on two-factor authentication.
2. From an up-to-date `main`, publish the CLI:

   ```bash
   pnpm install && pnpm --filter @kollaudo/cli build
   cd packages/cli && pnpm pack
   npm login
   npm publish kollaudo-cli-0.1.0.tgz --access public
   ```

   `pnpm pack` replaces the `workspace:` versions, which `npm publish` wouldn't understand.
3. In the settings of `@kollaudo/cli` on npmjs.com, add a trusted publisher: GitHub Actions,
   organization `kollaudo`, repository `kollaudo`, workflow `release.yml`, and allow `npm publish`.
   Then, under *Publishing access*, require two-factor authentication and disallow tokens: only the
   workflow and people with 2FA can publish.
4. After the first release, open the `kollaudo` package in the organization's *Packages* on GitHub,
   and in *Package settings* change its visibility to public. Images on ghcr.io are private until then.
