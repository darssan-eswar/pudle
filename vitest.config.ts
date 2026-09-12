import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: [
      'lib/client/recording/**/*.test.{ts,tsx}',
      'components/recording/**/*.test.tsx',
      'lib/client/app/**/*.test.{ts,tsx}',
      'components/app/**/*.test.tsx',
    ],
    restoreMocks: true,
  },
});
