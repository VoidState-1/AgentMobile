const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const boundaries = require('./scripts/architecture-rule.cjs');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      'dist/**',
      'work/**',
      'outputs/**',
      'android/**',
      'ios/**',
      'modules/agent-mobile-git/vendor/**',
      'modules/agent-mobile-git/android/build/**',
      'modules/agent-mobile-git/android/.cxx/**',
      'modules/agent-mobile-git/ios/Frameworks/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { architecture: { rules: { boundaries } } },
    rules: { 'architecture/boundaries': 'error' },
  },
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/shared/**/*.{ts,tsx}'],
    ignores: [
      'src/shared/ui/primitives.tsx',
      'src/shared/ui/sheets.tsx',
      'src/features/workbench/editor.tsx',
      'src/features/workbench/project-drawer.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Text', 'TextInput', 'Modal'],
              allowTypeImports: true,
              message:
                '文本和输入使用 shared/ui/primitives；弹层使用 shared/ui/sheets，避免另写主题、字体或外壳。',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'src/features/workbench/editor.tsx',
      'src/features/workbench/project-drawer.tsx',
      'src/shared/ui/sheets.tsx',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react-native',
              importNames: ['Text', 'TextInput'],
              allowTypeImports: true,
              message: '文本和输入使用 shared/ui/primitives。',
            },
          ],
        },
      ],
    },
  },
]);
