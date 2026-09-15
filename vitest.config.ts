import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src/', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: [
      'src/lib/client/recording/**/*.test.{ts,tsx}',
      'src/components/recording/**/*.test.tsx',
      'src/lib/client/app/**/*.test.{ts,tsx}',
      'src/components/app/**/*.test.tsx',
      'src/app/**/*.test.tsx',
    ],
    restoreMocks: true,
  },
});
