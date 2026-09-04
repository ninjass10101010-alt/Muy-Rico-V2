import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:8901',
  },
  webServer: {
    command: 'python3 -m http.server 8901',
    port: 8901,
    reuseExistingServer: true,
  },
});
