const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/**', 'work/**', 'outputs/**', 'android/**', 'ios/**'] },
  {
    files: ['src/core/**/*.{ts,tsx}', 'src/application/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', {
      paths: ['react', 'react-native', 'fs', 'path', 'crypto', 'os', 'stream', 'util'],
      patterns: [{ group: ['react/*', 'react-native/*', 'expo', 'expo-*', 'expo/*', 'node:*', '@earendil-works/*', '@modelcontextprotocol/*',
        '@/adapters/**', '**/adapters/**', '@/features/**', '**/features/**', '@/bootstrap/**', '**/bootstrap/**', '@/shared/**', '**/shared/**'],
        message: '领域与应用层只能依赖平台无关的规则和端口。' }],
    }] },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@/adapters/**', '**/adapters/**', '@/core/prototype/**'],
      message: '界面通过 AppServices 访问业务能力，类型从正式领域模块导入。' }] }] },
  },
  {
    files: ['src/shared/ui/**/*.{ts,tsx}', 'src/shared/theme/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@/features/**', '**/features/**', '@/adapters/**', '**/adapters/**'],
      message: '共享界面组件不能依赖业务 feature 或平台服务实现。' }] }] },
  },
]);
