import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = fileURLToPath(new URL("..", import.meta.url));
const temporaryDirectory = mkdtempSync(join(tmpdir(), "pal-widget-package-"));
const packDirectory = join(temporaryDirectory, "pack");
const consumerDirectory = join(temporaryDirectory, "consumer");

try {
  mkdirSync(packDirectory);
  mkdirSync(consumerDirectory);

  execFileSync(
    "pnpm",
    ["pack", "--pack-destination", packDirectory],
    { cwd: packageDirectory, stdio: "inherit" },
  );

  const archiveName = readdirSync(packDirectory).find((name) =>
    name.endsWith(".tgz"),
  );
  assert.ok(archiveName, "pnpm pack did not create a tarball");

  execFileSync(
    "npm",
    [
      "install",
      "--prefix",
      consumerDirectory,
      "--no-package-lock",
      "--no-save",
      join(packDirectory, archiveName),
      "react@18.3.1",
      "react-dom@18.3.1",
    ],
    { stdio: "inherit" },
  );

  const installedPackage = join(
    consumerDirectory,
    "node_modules",
    "@codepet",
    "pal-widget",
  );
  assert.deepEqual(readdirSync(installedPackage).sort(), [
    "LICENSE",
    "README.md",
    "dist",
    "package.json",
  ]);

  const smokeTest = `
    import assert from "node:assert/strict";
    import { readFileSync } from "node:fs";

    const widget = await import("@codepet/pal-widget");
    const theme = await import("@codepet/pal-widget/theme-contract");
    const entryUrl = import.meta.resolve("@codepet/pal-widget");
    const stylesheetUrl = import.meta.resolve("@codepet/pal-widget/styles.css");
    const license = readFileSync(
      new URL("./node_modules/@codepet/pal-widget/LICENSE", import.meta.url),
      "utf8",
    );
    const packageJson = JSON.parse(
      readFileSync(new URL("./node_modules/@codepet/pal-widget/package.json", import.meta.url), "utf8"),
    );

    assert.equal(typeof widget.PalProvider, "function");
    assert.equal(typeof widget.PalAchievements, "function");
    assert.equal(typeof widget.PalCollection, "function");
    assert.equal(theme.PAL_THEME_CONTRACT_VERSION, 1);
    assert.match(stylesheetUrl, /\\/dist\\/styles\\.css$/);
    assert.match(readFileSync(new URL(entryUrl), "utf8"), /^"use client";/);
    assert.equal(packageJson.peerDependencies.react, "^18.3.0 || ^19.0.0");
    assert.equal(packageJson.peerDependencies["react-dom"], "^18.3.0 || ^19.0.0");
    assert.equal(packageJson.license, "MIT");
    assert.notEqual(packageJson.private, true);
    assert.match(license, /^MIT License/);
  `;

  execFileSync(
    process.execPath,
    ["--input-type=module", "--eval", smokeTest],
    { cwd: consumerDirectory, stdio: "inherit" },
  );

  console.log("Packed React 18.3 consumer verification passed.");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
