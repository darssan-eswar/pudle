import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'lib/client/recording/**/*.test.ts',
      'components/recording/**/*.test.tsx',
    ],
    restoreMocks: true,
  },
});
