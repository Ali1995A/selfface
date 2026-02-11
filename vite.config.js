import basicSsl from "@vitejs/plugin-basic-ssl";

export default {
  // So the built `dist/` can be hosted under a subpath (e.g. GitHub Pages /selfface/)
  base: "./",
  plugins: [basicSsl()],
  server: {
    host: true,
    https: true,
  },
  build: {
    // Avoid clobbering our runtime `assets/*` (stickers/libs/jeeliz/stt) which we copy into `dist/assets`.
    assetsDir: "_v",
  },
};
