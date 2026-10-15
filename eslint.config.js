const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const boundaries = require('./scripts/architecture-rule.cjs');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/**', 'work/**', 'outputs/**', 'android/**', 'ios/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { architecture: { rules: { boundaries } } },
    rules: { 'architecture/boundaries': 'error' },
  },
]);
