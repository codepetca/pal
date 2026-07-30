import { readFileSync } from "node:fs";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const version = process.env.npm_package_version ?? "";
const tag = process.env.npm_config_tag ?? "latest";

if (version.includes("-") && tag !== "alpha") {
  console.error(
    `Refusing to publish prerelease ${version} with the ${tag} tag. Use --tag alpha.`,
  );
  process.exit(1);
}

if (packageJson.private || packageJson.license !== "MIT") {
  console.error(
    "Refusing to publish unless the package is MIT licensed and is not private.",
  );
  process.exit(1);
}
