import { defineConfig } from 'vitest/config';

// Mutation-testing config: only the fast suites (unit/component/contract) that
// cover the domain + application logic Stryker mutates. Integration/E2E need
// native/system deps and never cover pure logic, so they only slow Stryker down.
export default defineConfig({
  test: {
    include: [
      'test/unit/**/*.test.ts',
      'test/component/**/*.test.ts',
      'test/contract/**/*.test.ts',
    ],
  },
});
