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
const sandboxClientSource = readFileSync(
  new URL(
    "../../../apps/web/src/app/sandbox/sandbox-client.ts",
    import.meta.url,
  ),
  "utf8",
);
const sandboxPageSource = readFileSync(
  new URL(
    "../../../apps/web/src/app/sandbox/page.tsx",
    import.meta.url,
  ),
  "utf8",
);
const homePageSource = readFileSync(
  new URL("../../../apps/web/src/app/page.tsx", import.meta.url),
  "utf8",
);
const sandboxSetupSource = readFileSync(
  new URL("../../../scripts/setup-shared-sandbox.mjs", import.meta.url),
  "utf8",
);
const sandboxVerifierSource = readFileSync(
  new URL("../../../scripts/verify-shared-sandbox.mjs", import.meta.url),
  "utf8",
);
const turboConfigSource = readFileSync(
  new URL("../../../turbo.json", import.meta.url),
  "utf8",
);
const vercelConfig = JSON.parse(
  readFileSync(
    new URL("../../../apps/web/vercel.json", import.meta.url),
    "utf8",
  ),
) as { buildCommand?: string };
const vercelBuildSource = readFileSync(
  new URL(
    "../../../apps/web/scripts/vercel-build.mjs",
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
  // The sandbox client imports the widget as well, so it is held to the same
  // boundary as the sandbox component itself.
  for (const source of [sandboxSource, sandboxClientSource]) {
    assert.match(source, /from "@codepet\/pal-widget"/);
    assert.doesNotMatch(source, /packages\/widget\/src/);
    assert.doesNotMatch(source, /@codepet\/pal-widget\//);
  }
});

test("sandbox page is visible only in an allowed runtime and identifies its build", () => {
  assert.match(sandboxPageSource, /isSandboxPageAllowed\(\)/);
  assert.match(sandboxPageSource, /notFound\(\)/);
  assert.match(sandboxPageSource, /Public fixture preview/);
  assert.match(sandboxPageSource, /Local persisted pipeline/);
  assert.match(sandboxPageSource, /PAL_SANDBOX_MODE === "persisted"/);
  assert.match(sandboxPageSource, /widgetPackage\.version/);
  assert.match(homePageSource, /isSandboxPageAllowed\(\)/);
  assert.match(homePageSource, /redirect\("\/sandbox"\)/);
  assert.doesNotMatch(homePageSource, /WidgetSandbox/);
});

test("shared sandbox setup is pinned, minimal, and verifies production isolation", () => {
  assert.match(sandboxSetupSource, /VERCEL_TEAM_ID/);
  assert.match(sandboxSetupSource, /VERCEL_PROJECT_ID/);
  assert.match(sandboxSetupSource, /ALLOWED_ENV_NAMES/);
  assert.match(sandboxSetupSource, /PAL_SANDBOX_MODE=persisted/);
  assert.match(sandboxSetupSource, /verifySharedSandbox/);
  assert.match(sandboxVerifierSource, /pal_sandbox_app/);
  assert.match(sandboxVerifierSource, /has_database_privilege/);
  assert.match(sandboxVerifierSource, /database_owner/);
  assert.match(sandboxVerifierSource, /superuser/);
  assert.match(sandboxVerifierSource, /create_database/);
  assert.match(sandboxVerifierSource, /create_role/);
  assert.match(sandboxVerifierSource, /production_connect/);
  assert.match(sandboxVerifierSource, /42501/);
  assert.match(sandboxVerifierSource, /pal\.codepet\.ca/);
  assert.match(sandboxVerifierSource, /api\/v1\/events/);
  assert.match(sandboxVerifierSource, /api\/v1\/integration\/read-token/);
  assert.match(sandboxVerifierSource, /response\.status !== 401/);
  assert.match(turboConfigSource, /PAL_SANDBOX_MODE/);
  assert.match(turboConfigSource, /@pal\/web#build/);
  assert.match(turboConfigSource, /PAL_INTEGRATION_SECRET/);
  assert.match(turboConfigSource, /SANDBOX_INTEGRATION_SECRET/);
  assert.match(turboConfigSource, /PAL_READ_TOKEN_SIGNING_SECRET/);
  assert.match(turboConfigSource, /DATABASE_URL/);
  assert.match(turboConfigSource, /VERCEL_ENV/);
});

test("Vercel previews build without migrations while production keeps its release gate", () => {
  assert.equal(vercelConfig.buildCommand, "node scripts/vercel-build.mjs");
  assert.match(vercelBuildSource, /VERCEL_ENV === "production"/);
  assert.match(vercelBuildSource, /\["--filter", "@pal\/db", "migrate"\]/);
  assert.doesNotMatch(vercelBuildSource, /VERCEL_ENV === "preview"/);
  assert.match(vercelBuildSource, /\["turbo", "build", "--filter=@pal\/web"\]/);
});

test("sandbox uses one public widget boundary for fixture and persisted clients", () => {
  assert.match(
    sandboxSource,
    /create(?:FixturePalClient\(createEmptyFixtureSnapshot\(\)\)|StoryFixturePalClient\(apiBaseUrl\))/,
  );
  assert.match(sandboxSource, /createSandboxPalClient\(learnerId, apiBaseUrl\)/);
  assert.match(sandboxSource, /<PalProvider/);
  assert.match(sandboxSource, /<PalAchievements \/>/);
  assert.match(sandboxSource, /<PalCompanion/);
  assert.match(sandboxSource, /<PalRewardCelebration/);
  assert.match(sandboxSource, /Production-shaped fixture/);
  assert.match(sandboxSource, /Real pipeline/);
  assert.match(
    sandboxSource,
    /The roadmap,\s+companion, rewards, and acknowledgements all read persisted state/,
  );
  assert.doesNotMatch(sandboxSource, /initialSnapshot=/);
});

test("sandbox mounts the public companion without rebuilding its internals", () => {
  assert.match(
    sandboxSource,
    /<PalCompanion\s+scale=\{scale\}/,
  );
  assert.doesNotMatch(sandboxSource, /<PalCompanion[\s\S]*variant=/);
  assert.doesNotMatch(sandboxSource, /pal-companion-sprite|querySelectorAll/);
  assert.doesNotMatch(sandboxSource, /grassPatch|companionCatBox|companionHitArea/);
  assert.doesNotMatch(sandboxStyles, /grass\.png|grassPatch|companionCatBox/);
  assert.match(
    sandboxSource,
    /if \(sandboxError\) setControlsCollapsed\(false\)/,
  );
});

test("only the engine decides the companion's mood", () => {
  // The sandbox delegates snapshot reads to the public client. If it ever
  // starts choosing a mood from a control action, the engine is no longer the
  // sole authority over learner state.
  assert.match(sandboxClientSource, /createPalHttpClient/);
  assert.doesNotMatch(
    sandboxClientSource,
    /action === .*mood|mood = "(happy|excited|sleeping)"/,
  );
});

test("sandbox reset rotates provider identity and controls start collapsed", () => {
  assert.match(sandboxSource, /useState\(true\)/);
  assert.match(sandboxSource, /\$\{learnerId\}-\$\{clientGeneration\}/);
  assert.match(sandboxSource, /key=\{scopeKey\}/);
  assert.match(sandboxSource, /setClientGeneration\(\(current\) => current \+ 1\)/);
  assert.match(sandboxSource, /setSimulatedDate\(new Date\(FICTIONAL_SEMESTER_START_ISO\)\)/);
});

test("sandbox navigation keeps accessible names when labels are visually hidden", () => {
  assert.match(sandboxSource, /aria-label=\{label\}/);
});

test("sandbox does not add a Pal destination to host navigation", () => {
  assert.doesNotMatch(sandboxSource, /label: "Pal"/);
  assert.doesNotMatch(sandboxSource, /\| "pal"/);
  assert.doesNotMatch(sandboxStyles, /\.palScene/);
});

test("sandbox controls manage focus and hide covered navigation from interaction", () => {
  assert.match(sandboxSource, /closeButtonRef\.current\?\.focus\(\)/);
  assert.match(sandboxSource, /openButtonRef\.current\?\.focus\(\)/);
  assert.match(sandboxSource, /aria-controls="sandbox-control-panel"/);
  assert.equal(
    sandboxSource.match(/inert=\{!controlsCollapsed \|\| undefined\}/g)?.length,
    2,
  );
});

test("sandbox keeps its launcher reachable in short viewports", () => {
  assert.match(
    sandboxStyles,
    /\.navItems \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/,
  );
  assert.match(
    sandboxStyles,
    /\.sidebarFooter \{[\s\S]*?flex: 0 0 auto;/,
  );
});

test("sandbox keeps the companion in its positioned container after size changes", () => {
  assert.match(sandboxSource, /window\.addEventListener\("resize", clampToContainer\)/);
  assert.match(sandboxSource, /new ResizeObserver\(clampToContainer\)/);
  assert.match(sandboxSource, /rect\.left - containerRect\.left/);
  assert.match(sandboxSource, /e\.clientY - offset\.dy - containerRect\.top/);
  assert.match(sandboxSource, /\[widgetScale, widgetVisible\]/);
});

test("sandbox settings stack in narrow viewports", () => {
  assert.match(
    sandboxStyles,
    /@media \(max-width: 720px\) \{[\s\S]*?\.settingsGrid \{[\s\S]*?grid-template-columns: 1fr/,
  );
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
