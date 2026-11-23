// `node --test cli/test` resolves this folder to index.js: load every test file from here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".test.mjs")).sort()) await import(pathToFileURL(path.join(dir, f)).href);
