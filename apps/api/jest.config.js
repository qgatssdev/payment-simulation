/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  setupFiles: ['reflect-metadata'],
  collectCoverageFrom: ['**/*.ts', '!server.ts', '!test/**'],
  coverageDirectory: '../coverage',
};
