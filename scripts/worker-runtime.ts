import type { Plugin } from 'vite';

// Vite 8.0.16 imports its DOM-dependent page client merely to add a query to
// ONNX's dynamic WASM import. Keep that tiny URL operation worker-safe instead.
// Limited to the model runtime in development; production bundles are unchanged.
export function workerSafeImportQuery(code: string, id: string): string {
  if (!/node_modules\/.*(?:onnxruntime-web|@huggingface_transformers)/.test(id)) return code;
  return code.replace(
    /import\s*\{\s*injectQuery as __vite__injectQuery\s*\}\s*from\s*["']\/@vite\/client["'];?/g,
    `function __vite__injectQuery(url, query) {
      if (!url.startsWith('.') && !url.startsWith('/')) return url;
      const hashAt = url.indexOf('#');
      const path = hashAt < 0 ? url : url.slice(0, hashAt);
      const fragment = hashAt < 0 ? '' : url.slice(hashAt);
      return path + (path.includes('?') ? '&' : '?') + query + fragment;
    }`,
  );
}

export function workerRuntimeCompatibility(): Plugin {
  return {
    name: 'pudle-worker-runtime-compatibility',
    apply: 'serve',
    enforce: 'post',
    transform: {
      order: 'post',
      handler(code, id) {
        const result = workerSafeImportQuery(code, id);
        return result === code ? null : { code: result, map: null };
      },
    },
  };
}
