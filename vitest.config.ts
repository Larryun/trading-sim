import { defineConfig } from 'vitest/config';

// The sim engine is plain TS with no DOM dependency, so tests run in node.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
