import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // All files share one process AND one module graph: Mongoose keeps a global model registry, so
    // re-evaluating the model modules per file (isolate: true) throws OverwriteModelError.
    // Each file still starts its own in-memory MongoDB in beforeAll and resets data per test.
    isolate: false,
    // Spies (e.g. on fetch) must never leak from one test file into the next.
    restoreMocks: true
  }
});
