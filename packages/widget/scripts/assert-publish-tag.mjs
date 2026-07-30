import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const version = process.env.npm_package_version ?? "";
const tag = process.env.npm_config_tag ?? "latest";

if (packageJson.private || packageJson.license === "UNLICENSED") {
  console.error(
    "Refusing to publish until the package has an approved license and is no longer private.",
  );
  process.exit(1);
}

if (version.includes("-") && tag === "latest") {
  console.error(
    `Refusing to publish prerelease ${version} with the latest tag. Use --tag alpha.`,
  );
  process.exit(1);
}
