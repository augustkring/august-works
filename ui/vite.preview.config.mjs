import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Builds the actual onboarding wizard as a self-contained preview. */

const OUT_DIR = "dist-preview";

/**
 * Land the entry as `index.html` so the mock is the site root and the output
 * directory deploys as-is — no rename step to forget on a redeploy.
 *
 * Renamed on disk in `writeBundle` rather than rekeyed in `generateBundle`:
 * Vite's own HTML plugin emits the document after user plugins have had their
 * `generateBundle` turn, so a bundle-level rename finds nothing to rename. The
 * document's asset links are absolute (`/assets/...`), so moving the file
 * itself breaks nothing.
 */
const previewAsIndex = {
  name: "preview-html-as-index",
  writeBundle() {
    const built = path.resolve(__dirname, OUT_DIR, "wizard-preview.html");
    if (!fs.existsSync(built)) return;
    fs.renameSync(built, path.resolve(__dirname, OUT_DIR, "index.html"));
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), previewAsIndex],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      lexical: path.resolve(__dirname, "./node_modules/lexical/dist/Lexical.mjs"),
    },
  },
  build: {
    outDir: OUT_DIR,
    emptyOutDir: true,
    minify: "esbuild",
    rollupOptions: {
      input: path.resolve(__dirname, "wizard-preview.html"),
    },
  },
  esbuild: {
    drop: ["console", "debugger"],
    legalComments: "none",
  },
});
