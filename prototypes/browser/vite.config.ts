import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import hostingConfig from './.openai/hosting.json';
import { onnxRuntimeAssets, workerRuntimeCompatibility } from './scripts/worker-runtime';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';
const localStatePath = process.env.PUDLE_LOCAL_STATE_PATH;
const localVars = Object.fromEntries(
  [
    'APP_ORIGIN',
    'DEMO_MODE',
    'DEMO_RESET_SECRET',
    'DEMO_DRIVER_PASSWORD',
    'DEMO_PASSENGER_PASSWORD',
    'GEMINI_API_KEY',
    'GEMINI_MODEL',
  ]
    .map((name) => [name, process.env[name]])
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);

const localBindingConfig = {
  main: 'vinext/server/app-router-entry',
  compatibility_flags: ['nodejs_compat'],
  vars: localVars,
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    // Prebundle the model runtime; the scoped compatibility hook below keeps
    // Vite's dynamic-import helper from loading page-only HMR in its worker.
    optimizeDeps: { include: ['@huggingface/transformers'] },
    worker: { plugins: () => [onnxRuntimeAssets()] },
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      onnxRuntimeAssets(),
      workerRuntimeCompatibility(),
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        persistState: localStatePath ? { path: localStatePath } : true,
        config: localBindingConfig,
      }),
    ],
  };
});
