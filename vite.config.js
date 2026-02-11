import basicSsl from "@vitejs/plugin-basic-ssl";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function readPackageVersion() {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return String(pkg.version || "").trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function readGitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "nogit";
  }
}

const APP_VERSION = `v${readPackageVersion()}+${readGitSha()}`;

export default {
  // So the built `dist/` can be hosted under a subpath (e.g. GitHub Pages /selfface/)
  base: "./",
  plugins: [basicSsl()],
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  server: {
    host: true,
    https: true,
  },
  build: {
    // Avoid clobbering our runtime `assets/*` (stickers/libs/jeeliz/stt) which we copy into `dist/assets`.
    assetsDir: "_v",
  },
};
