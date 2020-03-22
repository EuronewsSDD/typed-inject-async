// eslint-disable-next-line no-undef
module.exports = function(config) {
  config.set({
    mutator: 'typescript',
    packageManager: 'npm',
    reporters: ['html', 'clear-text', 'progress', 'dashboard'],
    testRunner: 'mocha',
    transpilers: ['typescript'],
    testFramework: 'mocha',
    coverageAnalysis: 'perTest',
    tsconfigFile: 'tsconfig.lint.json',
    mutate: ['src/**/*.ts'],
    mochaOptions: {
      spec: ['dist/test/helpers/**/*.js', 'dist/test/unit/**/*.js']
    },
    maxConcurrentTestRunners: 2,
    thresholds: {
      high: 90,
      low: 80,
      break: 92
    },
    dashboard: {
      reportType: 'full'
    }
  });
};
