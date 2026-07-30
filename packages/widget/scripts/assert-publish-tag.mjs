const version = process.env.npm_package_version ?? "";
const tag = process.env.npm_config_tag ?? "latest";

if (version.includes("-") && tag === "latest") {
  console.error(
    `Refusing to publish prerelease ${version} with the latest tag. Use --tag alpha.`,
  );
  process.exit(1);
}
