import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = () => join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// DATABASE_URL and TEST_DATABASE_URL live in apps/web/.env.local, because
// Next.js only reads env files from the app directory (docs/dev-workflow.md).
// This package sits outside that directory, so nothing else would load them —
// and every command in our own README would fail with "DATABASE_URL is not set".
//
// Real environment variables (CI, Vercel) still win: process.loadEnvFile does
// not overwrite a variable that is already set. Do not "optimise" this by
// skipping the file when DATABASE_URL is present — a developer who exports
// DATABASE_URL in their shell would then never get TEST_DATABASE_URL, and the
// integration tests would fail for a reason that points nowhere near here.
export function loadLocalEnv(): void {
  const envFile = join(repoRoot(), "apps", "web", ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
