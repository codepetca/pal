# Pal widget release

`@codepet/pal-widget` is the public npm package consumed by Pika. The npm scope is
owned by the `codepet` npm account; a separate npm organization is not required.
The package remains unpublished until an owner deliberately runs the publish step.

## Release gates

- The release version is changed in `packages/widget/package.json` through a PR.
- CI passes typecheck, lint, widget tests, and a real package-tarball build.
- The tarball contains compiled `dist/` files, the package README, and no source
  tests or sandbox controls.
- The widget package is licensed under MIT in `packages/widget/LICENSE`, declares
  `"license": "MIT"`, and is not marked private.
- The publishing npm account has two-factor authentication enabled.

## Alpha release

From an up-to-date, clean checkout after the release PR is merged:

```bash
pnpm install --frozen-lockfile
pnpm --filter @codepet/pal-widget test
pnpm --filter @codepet/pal-widget build
pnpm --filter @codepet/pal-widget verify:package
pnpm --filter @codepet/pal-widget pack --pack-destination /tmp/pal-widget-pack
```

Inspect or install the generated `.tgz` in Pika before publishing it. When the
artifact is approved, sign in with `npm login`, then run the guarded release
command from the same clean checkout:

```bash
pnpm --filter @codepet/pal-widget release:alpha
```

The package metadata fixes access to `public`. The package lifecycle guard rejects
publication if the MIT license/private configuration regresses and rejects a
prerelease that omits the `alpha` tag. Do not publish the `.tgz` directly: npm
skips package lifecycle guards when publishing an existing tarball. Pika installs
the prerelease with:

```bash
pnpm add @codepet/pal-widget@alpha
```

Do not delete old versions to tidy the package list. Release only meaningful
versions, and use npm deprecation messages for versions that integrators should
stop using. Automated trusted publishing can be added after the package boundary
and release cadence stabilize.
