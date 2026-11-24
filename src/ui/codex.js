// The Book of Halcyre (DESIGN §20): the lore as an illustrated in-game book, opened from
// the menu or the title screen. Chapters: The World, Magic, Dungeons, Hearthvale, The
// People, Lyra, The Stranger, The Story So Far. Each chapter has a painted plate (one of the
// story panels), a line on why it matters, and its pages; pages the player has not
// learned yet show as blank leaves. Pages come from src/story/codex_data.js and from the
// common-knowledge entries of src/lore/story.js (whatever shape it has: anything missing
// is simply left out). Never shows a mystery's answer (LORE §9.10).

import { h, button, clear } from './dom.js';
import { makePanel } from './modal.js';
import { CHAPTERS, PAGES, QUESTIONS, PROLOGUE_UNLOCKS } from '../story/codex_data.js';
import { SCENES } from '../story/triggers.js';
import { SCRIPTS } from '../story/scripts.js';
import { PANELS } from '../story/panels.js';
import { PanelInstance, makeOverlay } from '../story/panel_view.js';
import { setStampAtlas } from '../story/cast.js';
import { STORY } from '../lore/story.js';
import { NPC_PROFILES } from '../entities/npc_data.js';
import { SAVE_KEY } from '../core/constants.js';

const plates = new Map(); // chapter id -> canvas

function list(v) {
  return Array.isArray(v) ? v : [];
}

// Only what everyone in the valley knows, and never a mystery's truth.
function isCommon(e) {
  if (!e || typeof e !== 'object' || e.secret || e.hidden) return false;
  const kb = e.knownBy;
  return kb === 'everyone' || (Array.isArray(kb) && kb.includes('everyone'));
}

function chapterOfStoryEntry(e) {
  const tags = list(e.tags);
  if (tags.includes('stranger') || tags.includes('player')) return 'stranger';
  if (tags.includes('dungeon') || tags.includes('dungeons') || tags.includes('delving')) return 'dungeons';
  if (tags.includes('magic') || tags.includes('spell')) return 'magic';
  if (tags.some((t) => ['hearthvale', 'law', 'chapel', 'customs', 'festival', 'village', 'ward', 'faith'].includes(t))) return 'hearthvale';
  return 'world';
}

// Read what an existing save has unlocked (for the book on the title screen).
function savedUnlocks() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const d = raw ? JSON.parse(raw) : null;
    return Object.keys(d?.flags?.story?.codex || {});
  } catch {
    return [];
  }
}

function savedSeen() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    const d = raw ? JSON.parse(raw) : null;
    return Object.keys(d?.flags?.story?.seen || {});
  } catch {
    return [];
  }
}

// Everything the book shows for one chapter: [{ id, title, text, locked, kind }].
export function chapterPages(chapterId, unlocked, opts = {}) {
  const has = (id) => unlocked.has(id);
  const out = [];
  const used = new Set();
  for (const p of PAGES) {
    if (p.chapter !== chapterId) continue;
    used.add(p.id);
    out.push(has(p.id) ? { id: p.id, title: p.title, text: p.text, kind: 'page' } : { id: p.id, locked: true, kind: 'page' });
  }
  // Common knowledge from the story bible, once the player has come across it.
  const world = list(STORY?.world);
  if (chapterId !== 'people' && chapterId !== 'story' && chapterId !== 'lyra') {
    for (const e of world) {
      if (!e?.id || used.has(e.id) || !has(e.id) || !isCommon(e)) continue;
      if (chapterOfStoryEntry(e) !== chapterId) continue;
      used.add(e.id);
      out.push({ id: e.id, title: e.title || e.id, text: e.text || '', kind: 'lore' });
    }
  }
  if (chapterId === 'hearthvale') {
    for (const e of list(STORY?.places)) {
      if (!e?.id || used.has(e.id) || !has(e.id) || !isCommon(e)) continue;
      used.add(e.id);
      out.push({ id: e.id, title: e.title || e.name || e.id, text: e.text || e.description || '', kind: 'place' });
    }
  }
  if (chapterId === 'people') {
    const people = list(STORY?.people);
    const seenIds = new Set();
    const villagers = list(STORY?.village).length ? STORY.village : NPC_PROFILES.map((p) => p.id);
    const ids = [...new Set([...villagers, ...NPC_PROFILES.map((p) => p.id), ...people.map((p) => p?.id).filter(Boolean)])];
    for (const id of ids) {
      if (!id || id === 'lyra' || seenIds.has(id)) continue;
      seenIds.add(id);
      const entry = people.find((p) => p?.id === id);
      const prof = NPC_PROFILES.find((p) => p.id === id);
      const isVillager = !!prof || list(STORY?.village).includes(id);
      if (!has(id)) {
        if (isVillager) out.push({ id, locked: true, kind: 'person' });
        continue;
      }
      const title = entry?.title || entry?.name || prof?.name || id;
      const role = prof?.role ? `, ${prof.role}` : '';
      const text = entry && isCommon(entry) ? entry.text : prof?.personality || '';
      if (text) out.push({ id, title: `${title}${entry?.title ? '' : role}`, text, kind: 'person' });
    }
  }
  if (chapterId === 'lyra') {
    // Her life as she has told it: story.js entries the player has been given.
    for (const e of list(STORY?.lyraLife)) {
      if (!e?.id || used.has(e.id) || !has(e.id) || e.secret) continue;
      used.add(e.id);
      out.push({ id: e.id, title: e.title || e.id, text: e.text || '', kind: 'life' });
    }
    for (const id of ['little_lamp_words', 'far_lamps']) {
      const e = world.find((w) => w?.id === id);
      if (e && has(id) && !used.has(id)) {
        used.add(id);
        out.push({ id, title: e.title || id, text: e.text || '', kind: 'told' });
      }
    }
  }
  if (chapterId === 'story') {
    // Scenes the player has lived through, in the order they happened.
    const seen = opts.seen || [];
    for (const sc of SCENES) {
      if (!seen.includes(sc.id)) continue;
      out.push({ id: `seen_${sc.id}`, title: SCRIPTS[sc.id]?.title || sc.id, text: sceneSummary(sc.id), kind: 'scene' });
    }
    if (opts.objective) out.push({ id: 'objective', title: 'What Lyra means to do next', text: opts.objective, kind: 'objective' });
    const qs = QUESTIONS.filter((q) => has(q.id));
    if (qs.length) out.push({ id: 'questions', title: 'Open questions', text: qs.map((q) => q.text).join('\n'), kind: 'questions' });
  }
  return out;
}

const SUMMARIES = {
  meet_ambrels: 'You met Lyra’s parents outside the chandlery. Wenna read your face with her hands. Hobb had already hung a lamp by your door.',
  chapel_candles: 'In the chapel, the family flames leaned toward you, every one.',
  night_of_lamps: 'One evening Lyra told you how her magic woke: every lamp on the square, lit at once, in violet.',
  weeping_cut: 'At the quarry, Lyra told you about the Weeping Cut, and why her no is a no.',
  maren_aveline: 'Sister Aveline told you how Maren walked toward the ruins at midsummer.',
  maren_gate: 'At the ruins gate Lyra told you why she will not go in again without the key.',
  maren_journal: 'You found Maren’s journal. Its last line hoped that whoever came out would be kind.',
};

function sceneSummary(id) {
  return SUMMARIES[id] || '';
}

// A chapter's plate: its story panel painted small, once.
function plate(chapter, game, w, hgt) {
  const key = `${chapter.id}:${w}x${hgt}`;
  if (plates.has(key)) return plates.get(key);
  const def = PANELS[chapter.panel];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  if (def) {
    try {
      if (game?.atlas) setStampAtlas(game.atlas);
      const s = Math.max(2, Math.round(hgt / 96));
      const inst = new PanelInstance(def, Math.ceil(w / s), Math.ceil(hgt / s), { pan: 'none' });
      inst.t = 7;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#05040c';
      ctx.fillRect(0, 0, w, hgt);
      inst.draw(ctx, s, w, hgt, 1);
      ctx.drawImage(makeOverlay(w, hgt, s, 0.6), 0, 0);
    } catch (err) {
      console.warn('[codex] plate failed', chapter.id, err);
    }
  }
  plates.set(key, c);
  return c;
}

export class Codex {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.panel = null;
    this.chapter = 'world';
  }

  // What the player has learned: the save's (or this game's) unlocked pages.
  unlocked() {
    const g = this.game;
    const set = new Set();
    const story = g.story;
    if (story && g.map) {
      for (const id of story.unlocked()) set.add(id);
    } else {
      for (const id of savedUnlocks()) set.add(id);
      // The prologue's pages are the book's first chapter, open to anyone who opens it.
      for (const id of PROLOGUE_UNLOCKS) set.add(id);
    }
    return set;
  }

  seen() {
    const g = this.game;
    if (g.story && g.map) return Object.keys(g.story.data.seen || {});
    return savedSeen();
  }

  objective() {
    const g = this.game;
    try {
      const qp = g.plugins?.get?.('quest');
      return qp?.objective?.(g.plugins.ctx) || '';
    } catch {
      return '';
    }
  }

  open(chapter = this.chapter) {
    if (this.panel && this.ui.stack.includes(this.panel)) {
      this.show(chapter);
      return;
    }
    const panel = makePanel({ id: 'codex', title: 'The Book of Halcyre', subtitle: 'What you have learned of the world', iconName: 'book', cls: 'panel-wide codex-panel' });
    panel.pauses = true;
    this.panel = panel;
    this.nav = h('nav', { class: 'codex-chapters', 'aria-label': 'Chapters' });
    this.page = h('article', { class: 'codex-page' });
    panel.body.append(h('div', { class: 'codex-book' }, this.nav, this.page));
    panel.onClose = () => {
      this.panel = null;
    };
    this.ui.openModal(panel);
    this.show(chapter);
  }

  show(chapterId) {
    const unlocked = this.unlocked();
    const seen = this.seen();
    const objective = this.objective();
    this.chapter = CHAPTERS.some((c) => c.id === chapterId) ? chapterId : 'world';
    clear(this.nav);
    for (const ch of CHAPTERS) {
      const pages = chapterPages(ch.id, unlocked, { seen, objective });
      const known = pages.filter((p) => !p.locked).length;
      const b = button('', { cls: `codex-tab${ch.id === this.chapter ? ' codex-tab-on' : ''}`, onClick: () => this.show(ch.id) });
      b.append(h('span', { class: 'codex-tab-title', text: ch.title }), h('span', { class: 'codex-tab-count', text: String(known) }));
      b.setAttribute('aria-current', ch.id === this.chapter ? 'page' : 'false');
      this.nav.append(b);
    }
    const ch = CHAPTERS.find((c) => c.id === this.chapter);
    clear(this.page);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.max(240, Math.min(620, (this.page.clientWidth || this.panel?.body?.clientWidth || 560) - 8));
    const cssH = Math.round(cssW * 0.38);
    const art = plate(ch, this.game, Math.round(cssW * dpr), Math.round(cssH * dpr));
    art.className = 'codex-plate-art';
    const fig = h('figure', { class: 'codex-plate' }, art);
    this.page.append(fig, h('h3', { class: 'codex-chapter-title', text: ch.title }), h('p', { class: 'codex-intro', text: ch.intro }));
    const pages = chapterPages(ch.id, unlocked, { seen, objective });
    const known = pages.filter((p) => !p.locked);
    const locked = pages.filter((p) => p.locked);
    if (!known.length) this.page.append(h('p', { class: 'codex-empty', text: 'Nothing written here yet. Live a little in Hearthvale, and the pages will fill.' }));
    for (const p of known) {
      const sec = h('section', { class: `codex-entry codex-${p.kind}` }, h('h4', { text: p.title }));
      for (const para of String(p.text || '').split(/\n+/)) if (para.trim()) sec.append(h('p', { text: para.trim() }));
      this.page.append(sec);
    }
    if (locked.length) {
      const n = locked.length;
      this.page.append(h('p', { class: 'codex-locked', text: n === 1 ? 'One page you have not found yet.' : `${n} pages you have not found yet.` }));
    }
    this.page.scrollTop = 0;
    if (this.panel?.body) this.panel.body.scrollTop = 0;
  }
}

export function openCodex(ui, chapter) {
  if (!ui) return null;
  if (!ui.codex) ui.codex = new Codex(ui);
  ui.codex.open(chapter);
  return ui.codex;
}
