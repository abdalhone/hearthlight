#!/usr/bin/env node
// How many of the lines actually said in a play session would find a clip (DESIGN.md §21).
// Plays the built game headless for a while (talking to Lyra, walking the village, letting
// the clock run), records every `speech` event, and checks each against
// scripts/voice/lines.json (run collect.mjs first). Lines that miss are listed, so new
// line banks that collect.mjs does not read yet show up.
//
//   node scripts/voice/coverage.mjs [--seconds 60]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../serve.mjs';
import { lineKey, speakerIdOf, isFixedLine } from '../../src/audio/voice_key.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const seconds = Number(args.includes('--seconds') ? args[args.indexOf('--seconds') + 1] : 60);
const known = new Set(JSON.parse(readFileSync(path.join(ROOT, 'scripts/voice/lines.json'), 'utf8')).lines.map((l) => l.key));

const server = await startServer(0);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:${server.address().port}/dist/index.html`);
await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 20000 });
await page.evaluate(() => {
  const g = window.__game;
  window.__heard = [];
  g.bus.on('speech', (p) => {
    const s = p?.speaker;
    const id = s === g.companion ? 'lyra' : s?.profile?.id || (s?.species ? `species:${s.species}` : s?.id || '?');
    window.__heard.push({ id, text: String(p?.text || ''), kind: p?.kind || 'say' });
  });
  g.newGame();
});
await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 20000 });
await page.evaluate(async () => {
  const g = window.__game;
  for (const m of ['hello', 'follow me', 'how are you?', 'attack mode', 'tell me a joke', 'thank you', 'stay here', 'what do you think of Bram?', 'good night']) {
    try {
      await g.brain.handlePlayerMessage(m);
    } catch {
      /* the offline mind answers */
    }
  }
});
const kb = page.keyboard;
const end = Date.now() + seconds * 1000;
const dirs = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
for (let i = 0; Date.now() < end; i++) {
  await kb.down(dirs[i % 4]);
  await page.waitForTimeout(900);
  await kb.up(dirs[i % 4]);
  await page.evaluate(() => window.__game.clock.skipTo?.(((window.__game.clock.hour + 1.5) % 24)));
}
const heard = await page.evaluate(() => window.__heard);
await browser.close();
server.close();

const SPECIES = { 'species:bandit': 'bandit', 'species:bandit_archer': 'bandit', 'species:bandit_chief': 'varek' };
let fixed = 0;
let hit = 0;
const misses = [];
for (const h of heard) {
  const sp = SPECIES[h.id] || speakerIdOf(h.id);
  if (!sp || !isFixedLine(h.text) || h.kind === 'thought') continue;
  fixed++;
  if (known.has(lineKey(sp, h.text))) hit++;
  else misses.push(`${sp}: ${h.text}`);
}
console.log(`${heard.length} lines heard; ${hit} of ${fixed} spoken lines have a clip in lines.json (${fixed ? Math.round((hit / fixed) * 100) : 0}%)`);
for (const m of [...new Set(misses)].slice(0, 40)) console.log('  miss', m);
