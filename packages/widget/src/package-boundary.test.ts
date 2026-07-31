import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const sandboxSource = readFileSync(
  new URL(
    "../../../apps/web/src/app/sandbox/WidgetSandbox.tsx",
    import.meta.url,
  ),
  "utf8",
);
const sandboxStyles = readFileSync(
  new URL(
    "../../../apps/web/src/app/sandbox/widget-sandbox.module.css",
    import.meta.url,
  ),
  "utf8",
);
const widgetPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as {
  name?: string;
  version?: string;
  license?: string;
  private?: boolean;
  main?: string;
  types?: string;
  files?: string[];
  peerDependencies?: { react?: string; "react-dom"?: string };
  scripts?: {
    prepublishOnly?: string;
    "release:alpha"?: string;
    "verify:package"?: string;
  };
  publishConfig?: { access?: string };
  exports?: Record<string, unknown>;
};

function runReleaseGuard(version: string | undefined, tag: string) {
  return spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL("../scripts/assert-publish-tag.mjs", import.meta.url),
      ),
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_tag: tag,
        npm_package_version: version,
      },
    },
  );
}

test("package metadata exposes only compiled public entry points", () => {
  assert.equal(widgetPackage.name, "@codepet/pal-widget");
  assert.match(widgetPackage.version ?? "", /^0\.1\.0-alpha\.\d+$/);
  assert.equal(widgetPackage.license, "MIT");
  assert.notEqual(widgetPackage.private, true);
  assert.equal(widgetPackage.main, "./dist/index.js");
  assert.equal(widgetPackage.types, "./dist/index.d.ts");
  assert.deepEqual(widgetPackage.files, ["dist", "LICENSE", "README.md"]);
  assert.equal(widgetPackage.publishConfig?.access, "public");
  assert.equal(
    widgetPackage.scripts?.prepublishOnly,
    "node scripts/assert-publish-tag.mjs",
  );
  assert.equal(
    widgetPackage.scripts?.["release:alpha"],
    "npm publish --access public --tag alpha",
  );
  assert.equal(
    widgetPackage.scripts?.["verify:package"],
    "node scripts/verify-package.mjs",
  );
  assert.equal(
    widgetPackage.peerDependencies?.react,
    "^18.3.0 || ^19.0.0",
  );
  assert.equal(
    widgetPackage.peerDependencies?.["react-dom"],
    "^18.3.0 || ^19.0.0",
  );
  assert.deepEqual(Object.keys(widgetPackage.exports ?? {}), [
    ".",
    "./theme-contract",
    "./styles.css",
    "./package.json",
  ]);
});

test("release guard accepts the licensed alpha release configuration", () => {
  const result = runReleaseGuard(widgetPackage.version, "alpha");

  assert.equal(result.status, 0, result.stderr);
});

test("release guard rejects every non-alpha prerelease tag", () => {
  const result = runReleaseGuard(widgetPackage.version, "beta");

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /with the beta tag\. Use --tag alpha/);
});

test("release guard rejects stable versions with any distribution tag", () => {
  for (const tag of ["latest", "beta"]) {
    const result = runReleaseGuard("0.1.0", tag);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to publish non-alpha version 0\.1\.0/);
  }
});

test("sandbox consumes only the widget public package boundary", () => {
  assert.match(sandboxSource, /from "@codepet\/pal-widget"/);
  assert.doesNotMatch(sandboxSource, /packages\/widget\/src/);
  assert.doesNotMatch(sandboxSource, /@codepet\/pal-widget\//);
});

test("sandbox distinguishes persisted companion state from fixture-only surfaces", () => {
  assert.match(sandboxSource, /Fixture preview/);
  assert.match(sandboxSource, /persisted rule-engine state/);
  assert.match(sandboxSource, /roadmap and reward states remain fixtures/);
});

test("sandbox reset rotates provider identity and controls start collapsed", () => {
  assert.match(sandboxSource, /useState\(true\)/);
  assert.match(sandboxSource, /\$\{learnerId\}-\$\{resetGeneration\}/);
  assert.match(sandboxSource, /key=\{fixtureScopeKey\}/);
  assert.match(sandboxSource, /setResetGeneration\(\(current\) => current \+ 1\)/);
});

test("sandbox navigation keeps accessible names when labels are visually hidden", () => {
  assert.match(sandboxSource, /aria-label=\{label\}/);
});

test("sandbox modal host makes application siblings inert and intercepts its backdrop", () => {
  assert.match(sandboxSource, /inert=\{celebrationOpen \|\| undefined\}/);
  assert.match(sandboxSource, /<PalRewardCelebration[\s\S]*modal/);
  assert.match(sandboxSource, /onOpenChange=\{setCelebrationOpen\}/);
  assert.match(
    sandboxStyles,
    /\.celebrationLayer \{[\s\S]*pointer-events: auto/,
  );
  assert.match(
    sandboxStyles,
    /\.celebrationLayer\[data-open="false"\] \{[\s\S]*pointer-events: none/,
  );
  assert.match(
    sandboxStyles,
    /\.celebrationLayer\[data-open="true"\] \{[\s\S]*background:/,
  );
  const baseLayerRule =
    sandboxStyles.match(/\.celebrationLayer \{([^}]+)\}/)?.[1] ?? "";
  assert.doesNotMatch(baseLayerRule, /background:/);
});
