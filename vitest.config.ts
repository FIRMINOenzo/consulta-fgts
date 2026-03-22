import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    globalSetup: ['src/__tests__/setup.ts'],
    env: {
      DATABASE_URL: 'file:./test.db',
    },
  },
});
