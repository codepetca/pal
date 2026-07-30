import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/theme-contract.ts", "src/styles.css"],
  external: ["react", "react-dom", "react/jsx-runtime"],
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  treeshake: true,
});
