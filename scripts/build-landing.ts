import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LandingPage from '../app/page';

// Reuse the product pitch; never export authenticated HTML or app data.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'deploy/vercel/public');
const cssDirectory = join(root, 'dist/client/_next/static/css');
const cssFiles = (await readdir(cssDirectory)).filter((name) => name.startsWith('index.') && name.endsWith('.css'));
if (cssFiles.length !== 1) throw new Error('Run the production build first; expected one global stylesheet.');
const css = await readFile(join(cssDirectory, cssFiles[0]), 'utf8');
if (!css.includes('.landing-hero')) throw new Error('The production stylesheet is missing the landing design.');
const content = renderToStaticMarkup(createElement(LandingPage));
if (!content.includes('A clearer view') || !content.includes('href="/app"')) throw new Error('Landing export is incomplete.');
const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pudle — A clearer view of the road</title>
<meta name="description" content="A private dashcam with Pudy, your voice companion. Record locally, share confirmed road reports, and keep in touch with your ride.">
<meta name="theme-color" content="#fbf7ef">
<link rel="canonical" href="https://pudle-demo.vercel.app/">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/landing.css">
<meta property="og:title" content="Pudle — A clearer view of the road">
<meta property="og:description" content="A private dashcam with a voice companion. Record locally and share confirmed road reports.">
<meta property="og:type" content="website">
</head><body>${content}</body></html>`;
await mkdir(output, { recursive: true });
await writeFile(join(output, 'index.html'), html);
await writeFile(join(output, 'landing.css'), `${css}\n:root{--font-geist-sans:Arial;--font-geist-mono:monospace}\n`);
for (const filename of ['favicon.svg', 'manifest.webmanifest', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
  await copyFile(join(root, 'public', filename), join(output, filename));
}
console.log(`Exported public landing page to ${output}`);
