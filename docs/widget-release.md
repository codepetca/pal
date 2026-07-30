# Pal widget release

`@codepet/pal-widget` is the public npm package consumed by Pika. The npm scope is
owned by the `codepet` npm account; a separate npm organization is not required.
The package remains unpublished until an owner deliberately runs the publish step.

## Release gates

- The release version is changed in `packages/widget/package.json` through a PR.
- CI passes typecheck, lint, widget tests, and a real package-tarball build.
- The tarball contains compiled `dist/` files, the package README, and no source
  tests or sandbox controls.
- A team owner has chosen the package license. It is intentionally marked
  `UNLICENSED` until that decision is made.
- The publishing npm account has two-factor authentication enabled.

## Alpha release

From an up-to-date, clean checkout after the release PR is merged:

```bash
pnpm install --frozen-lockfile
pnpm --filter @codepet/pal-widget test
pnpm --filter @codepet/pal-widget build
pnpm --filter @codepet/pal-widget pack --pack-destination /tmp/pal-widget-pack
```

Inspect or install the generated `.tgz` in Pika before publishing it. When the
artifact is approved, sign in with `npm login`, then publish that exact tarball:

```bash
npm publish /tmp/pal-widget-pack/codepet-pal-widget-<version>.tgz
```

The package metadata fixes access to `public` and the distribution tag to `alpha`,
so an early release cannot accidentally become npm's default `latest` version.
Pika installs the prerelease with:

```bash
pnpm add @codepet/pal-widget@alpha
```

Do not delete old versions to tidy the package list. Release only meaningful
versions, and use npm deprecation messages for versions that integrators should
stop using. Automated trusted publishing can be added after the package boundary
and release cadence stabilize.
