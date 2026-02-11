import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, "..");
const srcDir = path.join(projectRoot, "assets");
const distAssetsDir = path.join(projectRoot, "dist", "assets");

await rm(distAssetsDir, { recursive: true, force: true });
await cp(srcDir, distAssetsDir, { recursive: true, force: true });
console.log(`Copied ${srcDir} -> ${distAssetsDir}`);

