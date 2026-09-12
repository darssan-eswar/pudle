import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'lib/client/recording/**/*.test.{ts,tsx}',
      'components/recording/**/*.test.tsx',
    ],
    restoreMocks: true,
  },
});
