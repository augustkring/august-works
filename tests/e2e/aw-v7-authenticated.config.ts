import path from "node:path";
import { defineConfig } from "@playwright/test";
import authenticated from "./aw-v5-authenticated.config.js";

export default defineConfig({
  ...authenticated,
  testMatch: "aw-v7-authenticated.spec.ts",
  outputDir: path.resolve(import.meta.dirname, "../../test-results/v7-authenticated"),
});
