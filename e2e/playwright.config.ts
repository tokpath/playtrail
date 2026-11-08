import { defineConfig, type Project } from "@playwright/test";

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8091";
const WEB = process.env.E2E_WEB_URL ?? "http://127.0.0.1:3100";

// Specs that mutate shared state or run without a browser (request/child
// process only) execute once, on the chromium desktop project. The remaining
// browser scenarios run on all four browser × viewport projects (PRD 12.11).
const ONCE_ONLY = /\/e(10|11|12|13|14|16|17|18|19|20|23|24|25|26|27)-/;
const browserProjects: Project[] = [
  { name: "chromium-1440", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
  { name: "chromium-390", use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: "webkit-1440", use: { browserName: "webkit", viewport: { width: 1440, height: 900 } } },
  { name: "webkit-390", use: { browserName: "webkit", viewport: { width: 390, height: 844 } } },
];

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: [
    ["list"],
    ["html", { outputFolder: "report/html", open: "never" }],
    ["json", { outputFile: "report/results.json" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL: WEB,
    screenshot: "on",
    trace: { mode: "retain-on-failure", snapshots: true, screenshots: true },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: browserProjects.map((p) =>
    p.name === "chromium-1440" ? p : { ...p, testIgnore: ONCE_ONLY },
  ),
});
