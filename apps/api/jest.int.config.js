/**
 * Integration tests against a real Postgres (TEST_DATABASE_URL, default: local payments_test).
 * Files run one at a time because they share the database.
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.int-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  setupFiles: ['reflect-metadata'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  maxWorkers: 1,
  testTimeout: 20_000,
};
