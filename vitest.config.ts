import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/tests/setup.ts'],
    include: ['src/**/*.test.ts'],
    testTimeout: 15_000,
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
