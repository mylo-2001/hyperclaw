/** @type {import('vitest').UserConfig} */
module.exports = {
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.js'],
    testTimeout: 5000
  }
};
