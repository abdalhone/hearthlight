// Bundles the game into single-file pages:
//   dist/index.html     a complete standalone page (GitHub Pages, any static host, or open locally)
//   dist/artifact.html  the same game as page content for a claude.ai Artifact (the
//                       platform wraps it in its own <html>/<head>/<body> skeleton)
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONTS =
  'https://fonts.googleapis.com/css2?family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400&family=Pixelify+Sans:wght@400..700&display=swap';
const TITLE = 'Hearthlight';

const minify = !process.argv.includes('--no-minify');

const result = await build({
  entryPoints: [path.join(root, 'src/main.js')],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  minify,
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
  charset: 'utf8',
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const css = (await readFile(path.join(root, 'src/styles.css'), 'utf8')).replace(/<\/style/gi, '<\\/style');

const head = `<title>${TITLE}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>
${css}
</style>`;

// Voices (DESIGN.md §21): rendered clips go next to the page as dist/voice/ (packed so an
// Artifact's file limit holds them all); `--kokoro` also builds her live voice into
// dist/kokoro/. The page learns what was built from a one-line tag, so a build without
// them never asks the network for files that are not there.
let voices = null;
if (!process.argv.includes('--no-voices')) {
  const { packVoices } = await import('./voice/pack.mjs');
  const packed = await packVoices({
    src: path.join(root, 'assets/voice'),
    out: path.join(root, 'dist/voice'),
    lines: path.join(root, 'scripts/voice/lines.json'),
    loose: process.argv.includes('--loose-voices'),
  });
  if (packed?.clips) voices = { manifest: 'voice/manifest.json', live: null };
}
if (process.argv.includes('--kokoro')) {
  const { buildKokoro } = await import('./voice/kokoro_build.mjs');
  await buildKokoro({ root, out: path.join(root, 'dist/kokoro') });
  voices = { manifest: voices?.manifest ?? null, live: 'kokoro/' };
}
const voiceTag = voices ? `<script>window.__HEARTHLIGHT_VOICES__=${JSON.stringify(voices)}</script>\n` : '';

const body = `<div id="app"></div>
${voiceTag}<script>
${js}
</script>`;

const artifact = `${head}\n${body}\n`;
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#141332">
${head}
</head>
<body>
${body}
</body>
</html>
`;

await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/index.html'), standalone);
await writeFile(path.join(root, 'dist/artifact.html'), artifact);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(0)} KB`;
console.log(`built dist/index.html (${kb(standalone)}) and dist/artifact.html (${kb(artifact)})`);
