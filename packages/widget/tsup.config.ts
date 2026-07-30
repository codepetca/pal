import { defineConfig } from "tsup";

export default defineConfig([
  {
    clean: true,
    dts: true,
    entry: ["src/index.ts", "src/theme-contract.ts"],
    external: ["react", "react-dom", "react/jsx-runtime"],
    format: ["esm"],
    outDir: "dist",
    splitting: false,
    treeshake: true,
  },
  {
    clean: false,
    dts: false,
    entry: ["src/styles.css"],
    format: ["esm"],
    outDir: "dist",
  },
]);
