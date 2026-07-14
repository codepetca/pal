import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = () => join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// DATABASE_URL lives in apps/web/.env.local, because Next.js only reads env
// files from the app directory (docs/dev-workflow.md). This package sits
// outside that directory, so nothing else would load it — and every command in
// our own README would fail with "DATABASE_URL is not set".
//
// Real environment variables (CI, Vercel) always win: if DATABASE_URL is
// already set, the file is not read at all.
export function loadLocalEnv(): void {
  if (process.env.DATABASE_URL) return;

  const envFile = join(repoRoot(), "apps", "web", ".env.local");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
}
