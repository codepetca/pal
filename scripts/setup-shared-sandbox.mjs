import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { verifySharedSandbox } from "./verify-shared-sandbox.mjs";

const VERCEL_TEAM_ID = "team_jKbtHZ7k3VeEdJKdqf2GOToE";
const VERCEL_PROJECT_ID = "prj_PZpZp2maD9iJLjom4YO8hmdKjSa4";
const ALLOWED_ENV_NAMES = [
  "DATABASE_URL",
  "SANDBOX_INTEGRATION_SECRET",
  "PAL_READ_TOKEN_SIGNING_SECRET",
  "PAL_ALLOWED_WIDGET_ORIGINS",
];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localEnv = resolve(repoRoot, "apps/web/.env.local");
const rootEnv = resolve(repoRoot, ".env.local");
const projectMetadata = resolve(repoRoot, ".vercel/project.json");

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

const rootEnvAlreadyExisted = existsSync(rootEnv);
runVercel([
  "link",
  "--yes",
  "--scope",
  VERCEL_TEAM_ID,
  "--project",
  VERCEL_PROJECT_ID,
]);
if (!rootEnvAlreadyExisted && existsSync(rootEnv)) unlinkSync(rootEnv);

const linkedProject = JSON.parse(readFileSync(projectMetadata, "utf8"));
if (
  linkedProject.orgId !== VERCEL_TEAM_ID ||
  linkedProject.projectId !== VERCEL_PROJECT_ID
) {
  throw new Error("Vercel linked the wrong team or Pal project");
}

const temporaryDirectory = mkdtempSync(join(tmpdir(), "pal-sandbox-env-"));
const pulledEnv = join(temporaryDirectory, "development.env");
try {
  runVercel([
    "env",
    "pull",
    pulledEnv,
    "--environment=development",
    "--yes",
  ]);

  const extraction = spawnSync(
    process.execPath,
    [
      `--env-file=${pulledEnv}`,
      "--input-type=module",
      "--eval",
      `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(ALLOWED_ENV_NAMES)}.map((name) => [name, process.env[name]]))))`,
    ],
    { encoding: "utf8" },
  );
  if (extraction.error) throw extraction.error;
  if (extraction.status !== 0) {
    throw new Error(extraction.stderr || "Could not read Vercel sandbox env");
  }
  const values = JSON.parse(extraction.stdout);
  for (const name of ALLOWED_ENV_NAMES) {
    if (typeof values[name] !== "string" || values[name].length === 0) {
      throw new Error(`Vercel Development is missing ${name}`);
    }
  }

  await verifySharedSandbox(values.DATABASE_URL);
  const contents = ALLOWED_ENV_NAMES.map(
    (name) => `${name}=${JSON.stringify(values[name])}`,
  ).join("\n");
  writeFileSync(localEnv, `${contents}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log(
  "Shared sandbox environment installed and production access denied. Run `pnpm dev`, then open http://localhost:3000/sandbox.",
);
