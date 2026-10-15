/**
 * What counts as source for coverage, shared by every Jest config. Tests, test helpers,
 * type declarations and process entry points (server, migrate script) are excluded; the
 * entry points are exercised by running the built service, not by Jest.
 */
module.exports = {
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.spec.ts',
    '!**/*.int-spec.ts',
    '!**/*.d.ts',
    '!test/**',
    '!server.ts',
    '!scripts/**',
  ],
};
