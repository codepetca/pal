import { readFile, writeFile } from "node:fs/promises";

const entry = new URL("../dist/index.js", import.meta.url);
const directive = '"use client";\n';
const source = await readFile(entry, "utf8");

if (!source.startsWith(directive)) {
  await writeFile(entry, `${directive}${source}`);
}
