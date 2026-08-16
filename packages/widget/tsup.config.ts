import { defineConfig } from "tsup";

export default defineConfig([
  {
    // Cleaning happens once in the package scripts. Either watch context cleaning
    // here would delete the other context's output after an isolated file change.
    clean: false,
    dts: true,
    entry: [
      "src/index.ts",
      "src/achievement-presentation.ts",
      "src/theme-contract.ts",
      "src/fixture-client.ts",
    ],
    external: ["react", "react-dom", "react/jsx-runtime"],
    format: ["esm"],
    outDir: "dist",
    splitting: false,
    treeshake: true,
  },
  {
    // Keep this aligned with the TypeScript context above.
    clean: false,
    dts: false,
    entry: ["src/styles.css"],
    format: ["esm"],
    outDir: "dist",
  },
]);
