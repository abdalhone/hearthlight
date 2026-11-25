// Voices (DESIGN.md §21): only cutscenes are spoken. Keys shared by the collector and the
// runtime, the collector gathering only cutscene lines, packs that slice back out with
// their word times, the player (play, stop, muted, unknown lines, the word clock), and the
// cutscene captions following the voice word by word.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { normalizeLine, lineKey, hash53 } from '../src/audio/voice_key.js';
import { VoicePlayer, readManifest, voicesOn } from '../src/audio/voice.js';
import { planPacks, packVoices } from '../scripts/voice/pack.mjs';
import { EventBus } from '../src/core/events.js';
import { SCRIPTS, isSpoken } from '../src/story/scripts.js';
import '../src/story/scripts_missions.js';
import { BOSS_SCRIPTS } from '../src/story/scripts_bosses.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ keys

test('normalization folds typography, case, spacing and stage directions', () => {
  const same = ['Hmph. You again.', 'hmph.  you   again .', '  HMPH. You again.'];
  for (const s of same) assert.equal(normalizeLine(s), 'hmph. you again.');
  assert.equal(normalizeLine('“Well now.” Flame’s lit?'), normalizeLine("Well now. Flame's lit?"));
  assert.equal(normalizeLine('*sighs* Fine — go on…'), 'fine - go on...');
  assert.notEqual(normalizeLine('Hello.'), normalizeLine('Hello?'));
});

test('keys are stable, short and speaker-specific', () => {
  const k = lineKey('hess', 'Mm. Then we climb.');
  assert.match(k, /^hess-[0-9a-z]{6,12}$/);
  assert.equal(k, lineKey('HESS', 'mm.  then we climb.'));
  assert.notEqual(k, lineKey('lyra', 'Mm. Then we climb.'));
  // pinned: a change here orphans every rendered clip, so it must be deliberate
  assert.equal(lineKey('bram', 'Hmph. You again.'), 'bram-2emdk7gxv8j');
  assert.equal(hash53('bram\nhmph. you again.').toString(36), '2emdk7gxv8j');
  assert.equal(lineKey('', 'x'), null);
  assert.equal(lineKey('lyra', '   '), null);
});

test('collect.mjs gathers every spoken cutscene line, and only those', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/voice/collect.mjs')], { cwd: ROOT, stdio: 'pipe' });
  const doc = JSON.parse(readFileSync(path.join(ROOT, 'scripts/voice/lines.json'), 'utf8'));
  const want = new Set();
  for (const s of Object.values({ ...SCRIPTS, ...BOSS_SCRIPTS })) {
    if (!s?.steps) continue;
    for (const st of s.steps) if (isSpoken(st)) want.add(lineKey(st.narrate != null ? 'narrator' : st.say, st.narrate ?? st.text));
  }
  const got = new Set(doc.lines.map((l) => l.key));
  assert.deepEqual([...want].filter((k) => !got.has(k)), [], 'every cutscene line is collected');
  assert.deepEqual([...got].filter((k) => !want.has(k)), [], 'nothing but cutscene lines');
  for (const l of doc.lines) assert.equal(l.key, lineKey(l.speaker, l.text));
  // The cast covers every speaker.
  const cast = JSON.parse(readFileSync(path.join(ROOT, 'scripts/voice/cast.json'), 'utf8'));
  for (const sp of new Set(doc.lines.map((l) => l.speaker))) assert.ok(cast.voices[sp], `${sp} has a cast voice`);
});

test('the rendered clips cover the cutscenes, with word times for the captions', () => {
  const file = path.join(ROOT, 'assets/voice/manifest.json');
  if (!existsSync(file)) return;
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const m = readManifest(doc);
  assert.ok(m.size > 0);
  for (const [key, c] of m) {
    assert.ok(existsSync(path.join(ROOT, 'assets/voice', c.file)), `${key} has its file`);
    const raw = doc.clips[key];
    assert.equal(c.words.length, raw.text.split(/\s+/).filter(Boolean).length, `${key}: one time per word`);
    for (let i = 1; i < c.words.length; i++) assert.ok(c.words[i][1] >= c.words[i - 1][1], `${key}: words in order`);
    assert.ok(c.words[c.words.length - 1][1] <= c.dur + 0.05, `${key}: words inside the clip`);
  }
});

test('voices are only for cutscenes: no villager, Lyra or live-voice settings remain', () => {
  for (const k of ['voiceLyra', 'voiceVillagers', 'voiceNarrator', 'kokoroLive', 'browserVoice', 'voice', 'voiceName']) assert.equal(k in DEFAULT_SETTINGS, false, k);
  assert.equal(DEFAULT_SETTINGS.voices, true);
  assert.ok(voicesOn({}));
  assert.equal(voicesOn({ voices: false }), false);
  assert.equal(voicesOn({ voiceVol: 0 }), false);
  for (const f of ['src/audio/kokoro_live.js', 'src/audio/voice_chain.js', 'src/ai/brain/voice.js']) assert.equal(existsSync(path.join(ROOT, f)), false, f);
});

// ------------------------------------------------------------------ packs

test('packs keep scenes apart, in story order, near the target size', () => {
  const entries = [];
  for (let i = 0; i < 12; i++) entries.push({ key: `p-${i}`, script: 'prologue', size: 30000 });
  for (let i = 0; i < 3; i++) entries.push({ key: `m-${i}`, script: 'meet', size: 30000 });
  const plan = planPacks(entries, 100000);
  for (const p of plan) assert.ok(p.size <= 100000 && p.keys.every((k) => k[0] === p.script[0]));
  assert.deepEqual(plan.map((p) => p.keys.length), [3, 3, 3, 3, 3]);
  assert.deepEqual(plan.filter((p) => p.script === 'prologue').map((p) => p.n), [0, 1, 2, 3]);
});

test('a packed clip slices back out byte for byte, with its words', async () => {
  const src = mkdtempSync(path.join(tmpdir(), 'hl-vsrc-'));
  const out = path.join(src, 'out');
  const bytes = { 'hess-a': Buffer.from('AAAA'), 'lyra-b': Buffer.from('BBBBBB'), 'narrator-c': Buffer.from('CC') };
  const clips = {};
  let order = 0;
  for (const [k, b] of Object.entries(bytes)) {
    writeFileSync(path.join(src, `${k}.mp3`), b);
    clips[k] = { file: `${k}.mp3`, dur: 1.5, script: k === 'narrator-c' ? 'other' : 'prologue', order: order++, words: [['Hi.', 0.1, 0.4]] };
  }
  writeFileSync(path.join(src, 'manifest.json'), JSON.stringify({ format: 'x', clips }));
  await packVoices({ src, out, log: null });
  const m = readManifest(JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8')));
  for (const [k, b] of Object.entries(bytes)) {
    const e = m.get(k);
    assert.deepEqual(readFileSync(path.join(out, e.file)).subarray(e.off, e.off + e.len), b);
    assert.equal(e.dur, 1.5);
    assert.deepEqual(e.words, [['Hi.', 0.1, 0.4]]);
  }
  assert.equal(readdirSync(out).length, 3); // a pack per scene + manifest
});

// ------------------------------------------------------------------ the player

function fakeCtx() {
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: { connect() {} },
    started: [],
    createGain() {
      return { context: ctx, gain: { value: 1, setTargetAtTime(v) { this.value = v; } }, connect() {}, disconnect() {} };
    },
    createBufferSource() {
      const s = {
        buffer: null,
        onended: null,
        connect() {},
        start() {
          ctx.started.push(s);
        },
        stop() {
          s.stopped = true;
        },
      };
      return s;
    },
    decodeAudioData(bytes) {
      return Promise.resolve({ duration: 1.2, bytes: new Uint8Array(bytes).length });
    },
  };
  return ctx;
}

const LINE = 'Mm. Then we climb.';
function makePlayer(settings = {}) {
  const bus = new EventBus();
  const key = lineKey('hess', LINE);
  const manifest = { format: 'hearthlight-cutscene-voice/1', clips: { [key]: { file: `${key}.mp3`, dur: 1.2, words: [['Mm.', 0, 0.3], ['Then', 0.5, 0.7], ['we', 0.7, 0.8], ['climb.', 0.8, 1.1]] } } };
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(url);
    if (url.endsWith('manifest.json')) return { ok: true, json: async () => manifest };
    if (url.endsWith(`${key}.mp3`)) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    return { ok: false };
  };
  const ctx = fakeCtx();
  let t = 0;
  let ducked = 0;
  const game = { bus, settings: { ...settings }, state: 'playing', audio: { duck: (on) => (ducked += on ? 1 : 0) } };
  const vp = new VoicePlayer(game, { fetch: fetchImpl, ctx, now: () => t });
  return { vp, game, ctx, bus, fetched, key, advance: (s) => (t += s), ducked: () => ducked };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

test('a cutscene line plays its clip, says when it starts with its word times, and ends', async () => {
  const { vp, ctx, fetched, key, ducked } = makePlayer();
  let started = null;
  const p = vp.play({ speaker: 'hess', text: 'Mm.  Then we climb.', onStart: (s) => (started = s) });
  await tick();
  assert.equal(ctx.started.length, 1);
  assert.ok(fetched.includes(`voice/${key}.mp3`));
  assert.equal(started.duration, 1.2);
  assert.deepEqual(started.words.map((w) => w[0]), ['Mm.', 'Then', 'we', 'climb.']);
  assert.ok(vp.speaking() && ducked() === 1, 'the music dips under the voice');
  ctx.currentTime = 0.6;
  assert.ok(Math.abs(vp.elapsed() - 0.6) < 1e-9, 'the words follow the audio clock');
  assert.deepEqual(vp.clip('hess', LINE).words.length, 4);
  ctx.started[0].onended();
  assert.deepEqual(await p, { ok: true, reason: 'done' });
  assert.equal(vp.busy(), false);
  assert.equal(vp.elapsed(), -1);
});

test('no clip, muted, stopped, or moved on: nothing plays and nothing breaks', async () => {
  const { vp, ctx, fetched } = makePlayer();
  assert.deepEqual(await vp.play({ speaker: 'hess', text: 'A line nobody recorded.' }), { ok: false, reason: 'no_clip' });
  assert.ok(fetched.every((u) => !u.endsWith('.mp3')));
  assert.deepEqual(await vp.play({ speaker: 'hess', text: LINE, wanted: () => false }), { ok: false, reason: 'unwanted' });
  const p = vp.play({ speaker: 'hess', text: LINE });
  await tick();
  vp.stop();
  assert.deepEqual(await p, { ok: false, reason: 'stopped' });
  assert.ok(ctx.started[0].stopped);
  for (const settings of [{ voices: false }, { voiceVol: 0 }]) {
    const m = makePlayer(settings);
    assert.deepEqual(await m.vp.play({ speaker: 'hess', text: LINE }), { ok: false, reason: 'muted' });
    assert.equal(m.ctx.started.length, 0);
  }
  // Lyra under another name says other words: no clip, the caption types itself.
  assert.equal(vp.clip('lyra', 'Starling. It isn’t her.'), null);
});

test('turning voices off stops the line that is playing', async () => {
  const { vp, game, bus, ctx } = makePlayer();
  const p = vp.play({ speaker: 'hess', text: LINE });
  await tick();
  game.settings.voices = false;
  bus.emit('settings_changed', { key: 'voices', value: false });
  assert.deepEqual(await p, { ok: false, reason: 'stopped' });
  assert.ok(ctx.started[0].stopped);
});

test('a clip the browser may not play yet (an iPhone before a tap) is skipped, not held', async () => {
  const { vp, ctx } = makePlayer();
  ctx.state = 'suspended';
  ctx.resume = () => Promise.resolve();
  assert.deepEqual(await vp.play({ speaker: 'hess', text: LINE }), { ok: false, reason: 'suspended' });
  assert.equal(ctx.started.length, 0);
});

test('an older voice manifest (the deleted Kokoro bank used the same keys) is never read', () => {
  const old = { format: 'hearthlight-voice/1', packs: ['lyra-0.mp3'], clips: { 'lyra-abc': [0, 0, 100, 1.2, 'lyra'] } };
  assert.equal(readManifest(old).size, 0);
  assert.equal(readManifest({ packs: ['a.mp3'], clips: { k: [0, 0, 10, 1, []] } }).size, 0, 'no format: not ours');
  const ours = { format: 'hearthlight-cutscene-voice/1', packs: ['prologue-0-abcd1234.mp3'], clips: { k: [0, 0, 10, 1, [['Hi', 0, 0.2]]] } };
  assert.equal(readManifest(ours).size, 1);
});

test('settings saved before voices were cutscene-only turn the cutscene voices back on once', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const { loadSettings, saveSettings, migrateSettings } = await import('../src/core/settings.js');
  const { SETTINGS_KEY } = await import('../src/core/constants.js');
  store.set(SETTINGS_KEY, JSON.stringify({ voices: false, voiceVol: 0, voiceVillagers: true, voiceLyra: false, kokoroLive: false, voice: false, musicVol: 0.3 }));
  const s = loadSettings();
  assert.equal(s.voices, true);
  assert.equal(s.voiceVol, 0.85);
  assert.equal(s.musicVol, 0.3, 'other choices are kept');
  for (const k of ['voiceVillagers', 'voiceLyra', 'kokoroLive', 'voice']) assert.ok(!(k in s), `${k} is gone`);
  const saved = JSON.parse(store.get(SETTINGS_KEY));
  assert.ok(!('voiceVillagers' in saved), 'the migration is saved');
  // A choice made after the migration stays.
  saveSettings({ ...s, voices: false });
  assert.equal(loadSettings().voices, false);
  // A kept volume survives the migration.
  assert.equal(migrateSettings({ voiceVol: 0.4, voiceLyra: true }).voiceVol, 0.4);
  delete globalThis.localStorage;
});
