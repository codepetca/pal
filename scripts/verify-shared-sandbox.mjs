import { fileURLToPath } from "node:url";

import pg from "../apps/web/node_modules/pg/lib/index.js";

const { Client } = pg;
const SANDBOX_DATABASE = "pal_sandbox";
const SANDBOX_ROLE = "pal_sandbox_app";
const PRODUCTION_DATABASE = "neondb";

export async function verifySharedSandbox(databaseUrl) {
  const sandboxUrl = new URL(databaseUrl);
  const sandbox = new Client({ connectionString: sandboxUrl.toString() });
  await sandbox.connect();
  try {
    const identity = await sandbox.query(
      "select current_database() as database, current_user as role, has_database_privilege(current_user, $1, $2) as production_connect",
      [PRODUCTION_DATABASE, "CONNECT"],
    );
    const row = identity.rows[0];
    if (
      row.database !== SANDBOX_DATABASE ||
      row.role !== SANDBOX_ROLE ||
      row.production_connect !== false
    ) {
      throw new Error(
        "Shared sandbox credentials are not isolated from production",
      );
    }
  } finally {
    await sandbox.end();
  }

  const productionUrl = new URL(sandboxUrl);
  productionUrl.pathname = `/${PRODUCTION_DATABASE}`;
  const production = new Client({ connectionString: productionUrl.toString() });
  let productionConnected = false;
  try {
    await production.connect();
    productionConnected = true;
  } catch (error) {
    if (error?.code !== "42501") {
      throw new Error(
        "Could not prove that production rejects the shared sandbox role",
        { cause: error },
      );
    }
  } finally {
    await production.end().catch(() => {});
  }
  if (productionConnected) {
    throw new Error("Shared sandbox credentials connected to production");
  }

  return { database: SANDBOX_DATABASE, role: SANDBOX_ROLE };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = await verifySharedSandbox(process.env.DATABASE_URL ?? "");
  console.log(
    `Verified database=${result.database} role=${result.role} production_connect=false`,
  );
}
