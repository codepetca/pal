import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localEnv = resolve(repoRoot, "apps/web/.env.local");

if (existsSync(localEnv)) {
  console.error(
    "apps/web/.env.local already exists. Move it aside first so this setup cannot overwrite your local configuration.",
  );
  process.exit(1);
}

function runVercel(args) {
  const result = spawnSync(
    "pnpm",
    ["dlx", "vercel@54.17.2", ...args],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

runVercel(["link", "--yes", "--project", "pal"]);
runVercel([
  "env",
  "pull",
  "apps/web/.env.local",
  "--environment=development",
  "--yes",
]);

console.log(
  "Shared sandbox environment installed. Run `pnpm dev`, then open http://localhost:3000/sandbox.",
);
