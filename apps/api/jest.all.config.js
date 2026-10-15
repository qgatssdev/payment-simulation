/**
 * Unit and integration suites in one run, with coverage merged across both: the repositories,
 * controllers and wiring are deliberately tested against real Postgres, so unit-only coverage
 * would understate them. Serial because the integration files share one database.
 * @type {import('jest').Config}
 */
module.exports = {
  projects: ['<rootDir>/jest.config.js', '<rootDir>/jest.int.config.js'],
  maxWorkers: 1,
  coverageDirectory: '<rootDir>/coverage/all',
  coverageReporters: ['text-summary', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 90, branches: 80, functions: 90, lines: 90 },
  },
};
