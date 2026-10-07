import {defineConfig} from "@playwright/test";
export default defineConfig({
  testDir:".",testMatch:"decision-intelligence.spec.ts",workers:1,fullyParallel:false,timeout:60000,retries:0,
  outputDir:"./test-results/decision-intelligence",reporter:[["list"]],
  use:{browserName:"chromium",baseURL:"http://127.0.0.1:6145",reducedMotion:"reduce",trace:"retain-on-failure",launchOptions:process.env.AW_BROWSER_EXECUTABLE_PATH?{executablePath:process.env.AW_BROWSER_EXECUTABLE_PATH}:{}},
  webServer:{command:"node ../../scripts/serve-storybook-static.mjs --port 6145",url:"http://127.0.0.1:6145/index.json",reuseExistingServer:false},
});
