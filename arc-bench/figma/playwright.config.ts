import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

if (!process.env.BASE_URL && process.env.PLAYWRIGHT_BASE_URL) {
  process.env.BASE_URL = process.env.PLAYWRIGHT_BASE_URL;
}
const executablePath = process.env.AGENT_BROWSER_EXECUTABLE_PATH;
const standalone = existsSync(new URL('./tests/scenario-index.yaml', import.meta.url));
const runDirectory = process.env.ARC_EVAL_OUTPUT_DIR ?? (standalone ? '../figma-evaluation' : undefined);
const htmlDirectory = process.env.PLAYWRIGHT_HTML_OUTPUT_DIR
  ?? (runDirectory ? resolve(runDirectory, 'html') : undefined);

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/*.spec.ts', '**/*.test.ts'],
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  ...(runDirectory ? { outputDir: resolve(runDirectory, 'artifacts') } : {}),
  reporter: [['list'], ['html', { open: 'never', outputFolder: htmlDirectory }]],
  timeout: 60_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: process.env.BASE_URL,
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'Asia/Shanghai',
    actionTimeout: 10_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
