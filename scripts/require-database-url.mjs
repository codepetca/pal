if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is required for pnpm test:db; use pnpm test:unit for the database-free suite.",
  );
  process.exit(1);
}
