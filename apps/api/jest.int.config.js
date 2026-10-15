/**
 * Integration tests against a real Postgres (TEST_DATABASE_URL, default: local payments_test).
 * Files must run one at a time because they share the database: the test:int script passes
 * --runInBand, and jest.all.config.js sets maxWorkers: 1.
 * @type {import('jest').Config}
 */
module.exports = {
  displayName: 'integration',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.int-spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  setupFiles: ['reflect-metadata'],
  globalSetup: '<rootDir>/test/global-setup.ts',
  testTimeout: 20_000,
  ...require('./jest.coverage'),
  coverageDirectory: '../coverage/integration',
};
