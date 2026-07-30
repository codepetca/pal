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

test("package metadata exposes only compiled public entry points", () => {
  assert.equal(widgetPackage.name, "@codepet/pal-widget");
  assert.match(widgetPackage.version ?? "", /^0\.1\.0-alpha\.\d+$/);
  assert.equal(widgetPackage.private, true);
  assert.equal(widgetPackage.main, "./dist/index.js");
  assert.equal(widgetPackage.types, "./dist/index.d.ts");
  assert.deepEqual(widgetPackage.files, ["dist", "README.md"]);
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

test("release guard blocks publication before the license decision", () => {
  const result = spawnSync(
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
        npm_config_tag: "alpha",
        npm_package_version: widgetPackage.version,
      },
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /approved license and is no longer private/,
  );
});

test("sandbox consumes only the widget public package boundary", () => {
  assert.match(sandboxSource, /from "@codepet\/pal-widget"/);
  assert.doesNotMatch(sandboxSource, /packages\/widget\/src/);
  assert.doesNotMatch(sandboxSource, /@codepet\/pal-widget\//);
});

test("sandbox labels fixture mode as visual state rather than pipeline proof", () => {
  assert.match(sandboxSource, /Fixture preview/);
  assert.match(sandboxSource, /Visual states only/);
  assert.match(sandboxSource, /no production state is connected/);
});

test("sandbox reset rotates provider identity and controls start collapsed", () => {
  assert.match(sandboxSource, /useState\(true\)/);
  assert.match(sandboxSource, /fixture-learner-\$\{resetGeneration\}/);
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
