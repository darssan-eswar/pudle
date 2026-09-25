import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'deploy/vercel/.next/**', 'deploy/vercel/node_modules/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);

export default eslintConfig;
