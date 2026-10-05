import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://127.0.0.1:8766',
    viewport: { width: 1100, height: 800 },
    reducedMotion: 'reduce',
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
  },
  webServer: { command: 'python3 -m http.server 8766 --bind 127.0.0.1', url: 'http://127.0.0.1:8766', reuseExistingServer: !process.env.CI }
});
