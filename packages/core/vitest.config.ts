import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // No wall-clock dependence in fixtures: every time-sensitive unit injects a clock.
    testTimeout: 10_000,
    coverage: {
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
      thresholds: { lines: 85, branches: 80 },
    },
  },
})
