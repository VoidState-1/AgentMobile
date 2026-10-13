import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'expo/fetch': path.resolve(__dirname, 'tests/fetch.ts'),
    },
  },
  test: { include: ['tests/**/*.test.ts'], testTimeout: 15000 },
});
