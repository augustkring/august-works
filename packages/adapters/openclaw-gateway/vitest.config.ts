import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [{
      find: "openclaw/plugin-sdk/channel-actions",
      replacement: fileURLToPath(new URL("./src/test-fixtures/openclaw-channel-actions.ts", import.meta.url)),
    }],
  },
  test: {
    environment: "node",
  },
});
