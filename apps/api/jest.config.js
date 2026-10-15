/**
 * Unit tests: no database. Fast, parallel.
 * @type {import('jest').Config}
 */
module.exports = {
  displayName: 'unit',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  setupFiles: ['reflect-metadata'],
  ...require('./jest.coverage'),
  coverageDirectory: '../coverage/unit',
};
