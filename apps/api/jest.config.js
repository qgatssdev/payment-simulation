/**
 * Unit tests and full-stack API tests (real container, in-memory or temp-file store) run
 * together: no external services are needed, so there is one suite and one coverage gate.
 * Tests, helpers, declarations and process entry points (the server, exercised by running the
 * built service, and the demo seed script) are excluded from coverage.
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  setupFiles: ['reflect-metadata'],
  testTimeout: 20_000,
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!**/*.d.ts',
    '!test/**',
    '!server.ts',
    '!scripts/**',
  ],
  coverageDirectory: '../coverage',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 90, branches: 80, functions: 90, lines: 90 },
  },
};
