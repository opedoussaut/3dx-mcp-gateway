import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'retain-on-failure',
    launchOptions: process.env.NOVA_TEST_BROWSER
      ? {
          executablePath: process.env.NOVA_TEST_BROWSER,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-zygote'],
        }
      : {},
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1050 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:3000/api/status',
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      NOVA_TENANT_ORIGIN: '',
      NOVA_RELEASE: '',
      NOVA_CONTRACT_FILE: '',
      NOVA_ACCESS_TOKEN: '',
      NOVA_CLIENT_SECRET: '',
      NOVA_SECURITY_CONTEXT: '',
      NOVA_MODEL_PROVIDER: 'none',
    },
  },
});
