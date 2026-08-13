import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function run(args) {
  const result = spawnSync("pnpm", args, {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Public previews are fixture-only and must neither require nor contact a
// database. Production keeps the existing migrate-before-build release gate.
if (process.env.VERCEL_ENV === "production") {
  run(["--filter", "@pal/db", "migrate"]);
}

run(["turbo", "build", "--filter=@pal/web"]);
