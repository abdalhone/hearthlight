// The villain path (round 14b, S-15; DESIGN §36.4; the author: "should I be a villain or a
// hero? Should I kill them or save them?").
//
// game.villain = new Villain(game) (villainPlugin, through src/core/plugins/society.js).
// The tempter, Isembard (src/story/tempter_data.js; LORE §9.11), waits at night outside the
// Sunken Ruins' gate once the stranger has beaten a boss or a killing of theirs is known. He
// offers the strongest magic there is for the deaths of every grown soul in Hearthvale (never
// the children: decision D1), taught BEFORE (on your word: a debt) or AFTER (when it is
// quiet). He is a person you can talk to like anyone (TOP PRIORITY A): the chat reaches him,
// he hears every word, and he answers in his own voice (Claude through his persona, or his
// own lines offline). What the game decides (a pact, a refusal) is decided before it is
// worded (seam 9).
//
//   hasPact()        a pact sealed and not broken
//   state            { met, metDay, offered, pact: 'before'|'after'|null, pactDay, gifts,
//                      kills: [ids], refused, warned: [ids], betrayed, ending, defeated, said }
//   seal(kind)       'before' | 'after' -> emits pact_sealed { gifts, pact }
//   refuse()         no (he will ask again, some night)
//   warn(byId)       the stranger tells the watch: the hero path (a broken pact is Oathbreaker)
//   livingAdults()   the grown people of the eighteen still alive and not fled
//   emptied()        game.occupation.emptied() when blood provides it, else livingAdults() = 0
//
// Contract for soul (DESIGN §37.4): when the pact is sealed, `pact_sealed { gifts: [...,
// 'unkindle'] }`; soul calls game.unkindle.learn(). The Unkindling is taught as part of
// the pact either way: "before" gives everything at once; "after" lends only the quiet hand
// now and pays the rest (`pact_paid { gifts }`) when the village is empty.
//
// Kills: he listens to villager_killed (never villager_died: decision D13) with by
// 'player', and counts a death only once it is KNOWN as a killing (an Unkindling nobody saw
// is a mystery, and counts the night it is seen, linked or proven: reputation.knownAsKilling).
// Children are never counted or required: "the village" is its adults.
//
// Endings (story branches, saves):
//   villain  the pact kept and the village empty: the last flame goes out, the ward lets go,
//            the ruins wake. A scene, the rest of his gifts, and the life CLOSES (an end
//            page like the memorial; the save rests under Past lives).
//   hero     the tempter fought and broken (refused, or the pact betrayed): he comes apart
//            into cold blue light. A scene; the ward holds; the save CONTINUES. Beating him
//            after a pact is still breaking your word: Oathbreaker.

import { NPC } from '../entities/npc.js';
import { TILE, FACTION } from '../core/constants.js';
import { VILLAGERS } from '../ai/social/bonds_data.js';
import { isAdult } from '../core/people.js';
import { TEMPTER_ID, TEMPTER_PROFILE, TEMPTER_LINES, TEMPTER_RULES, tempterLocal } from './tempter_data.js';
import { knownAsKilling, byPlayer } from '../society/reputation.js';
import { ensureCharacter } from '../art/characters_art.js';
import { playScript } from '../murder/scenes.js';
import { Shapes } from '../magic/shapes.js';
import { Essences } from '../magic/essences.js';
import { Twists } from '../magic/twists.js';
import { RUMOR_KINDS } from '../ai/social/rumors.js';

// The warning travels as news (heard by meeting, like any rumour).
if (!RUMOR_KINDS.tempter_warning) RUMOR_KINDS.tempter_warning = { text: '{stranger} says something waits by the ruins gate at night, offering magic for lives', you: 'you warned us about the ruins gate', valence: 0.35, severity: 0.6, about: 'village' };

export const PACT_GIFTS = {
  before: ['dark', 'bloodprice', 'unkindle'],
  after: ['unkindle'],
};
// Paid when the village is empty, to a pact made "after" (and what is left, to "before").
export const PAID_GIFTS = ['dark', 'bloodprice', 'all_weaves'];
// Who the stranger may warn (the watch, the Reeve, the chapel, the huntress).
export const WARN_TO = ['rowan', 'wys', 'alder', 'aveline', 'hess', 'elda'];
const CHECK_EVERY = 1; // s
const NIGHT_FROM = 20.5;
const NIGHT_TO = 5;

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[villain]', err);
    return fallback;
  }
}

function fresh() {
  return { met: false, metDay: null, offered: false, pact: null, pactDay: null, gifts: [], paid: false, kills: [], pending: [], refused: false, refusedDay: null, warned: [], betrayed: false, ending: null, endingDay: null, defeated: false, fighting: false, said: [], verdicts: 0, hinted: false };
}

// The tempter in the world: an NPC with his own dialogue, standing still by the gate.
export class Tempter extends NPC {
  constructor(game, villain, x, y) {
    super(game, TEMPTER_PROFILE, { x, y });
    this.villain = villain;
    this.visitor = true;
    this.essential = true; // beaten down, never killed by a blow: he comes apart instead
    this.downable = true;
    // He waits (a duty: the routine never runs). A fight goes first (npc.think).
    this.duty = { step: (npc) => villain.stand(npc) };
  }

  getDialogue(player) {
    return this.villain.dialogue(player);
  }

  chooseOption(id, player) {
    return this.villain.choose(String(id || ''), player);
  }

  withLifeOptions(d) {
    return d;
  }

  // His cold blue lamp (the lighting collects it like any carried light).
  getLight() {
    const L = (this._light ||= { x: 0, y: 0, r: 46, color: '#8fd8ff', intensity: 0.55, flicker: 0.12 });
    L.x = this.x;
    L.y = this.y - 12;
    return L;
  }

  serialize() {
    return null; // he is not saved as a villager: the villain's state brings him back
  }
}

export class Villain {
  constructor(game) {
    this.game = game;
    this.state = fresh();
    this.tempter = null;
    this.checkT = 0;
    this._wrapped = false;
  }

  get murder() {
    return this.game?.murder || null;
  }

  day() {
    return Math.max(1, Math.floor(this.game?.clock?.day ?? 1));
  }

  hour() {
    return this.game?.clock?.hour ?? 12;
  }

  isNight() {
    const h = this.hour();
    return h >= NIGHT_FROM || h < NIGHT_TO;
  }

  hasPact() {
    const s = this.state;
    return !!s.pact && !s.betrayed && s.ending !== 'hero' && !s.defeated;
  }

  // ------------------------------------------------------------------ the village

  livingAdults() {
    const g = this.game;
    const m = this.murder;
    return VILLAGERS.filter((id) => {
      if (m?.dead?.[id]) return false;
      const e = g?.entities?.get?.(id);
      if (!e || e.removed || e.dead) return false;
      const cause = e.absent?.cause;
      if (cause && /fled|taken|left|gone|killed|died|age/.test(String(cause))) return false;
      if (!isAdult(g, e)) return false;
      // Only those a blow can take count (children never, and no one the game spares).
      return typeof m?.canKill === 'function' ? !!safe(() => m.canKill(e), true) : true;
    });
  }

  emptied() {
    const o = this.game?.occupation;
    if (typeof o?.emptied === 'function') {
      const v = safe(() => o.emptied(), null);
      if (typeof v === 'boolean') return v;
    }
    return this.livingAdults().length === 0;
  }

  // ------------------------------------------------------------------ kills

  onKilled(p) {
    if (!p || p.by !== 'player') return;
    const id = p.id || p.entity?.id;
    if (!id || id === TEMPTER_ID || !VILLAGERS.includes(id)) return;
    const s = this.state;
    if (s.kills.includes(id) || s.pending.includes(id)) return;
    s.pending.push(id);
    this.settleKills();
  }

  // A killing counts once it is known as a killing (the Unkindling unseen does not, yet).
  settleKills() {
    const s = this.state;
    const m = this.murder;
    if (!s.pending.length || !m) return;
    const still = [];
    for (const id of s.pending) {
      const rec = m.dead?.[id];
      if (!rec || !byPlayer(rec)) continue;
      if (knownAsKilling(m, rec)) {
        if (!s.kills.includes(id)) s.kills.push(id);
      } else still.push(id);
    }
    s.pending = still;
  }

  progress() {
    const left = this.livingAdults().length;
    const done = this.state.kills.length;
    return { left, done, total: left + done };
  }

  // ------------------------------------------------------------------ the pact

  seal(kind = 'after') {
    const s = this.state;
    const pact = kind === 'before' ? 'before' : 'after';
    if (s.pact || s.ending || s.defeated) return false;
    s.met = true;
    s.metDay ??= this.day();
    s.offered = true;
    s.pact = pact;
    s.pactDay = this.day();
    s.refused = false;
    const gifts = [...PACT_GIFTS[pact]];
    s.gifts = gifts;
    this.grant(gifts.filter((x) => x !== 'unkindle'));
    if (pact === 'before') s.paid = true;
    safe(() => this.game.bus?.emit?.('pact_sealed', { gifts: [...gifts], pact, by: TEMPTER_ID, day: s.pactDay }));
    safe(() => this.game.ui?.toast?.(pact === 'before' ? 'The pact is sealed. Cold runs up your arm and stays: shadow, a price in blood, and the quiet hand. You owe him the village.' : 'The pact is sealed. He lends you the quiet hand now; the rest when the village is quiet.', 'warn', { key: 'pact', title: 'The pact' }));
    this.mark('pact', `The stranger made a pact with the pilgrim at the ruins gate (${pact}).`);
    return true;
  }

  // Magic he gives: essences and prices through magic.unlock; 'all_weaves' is everything.
  grant(list) {
    const mg = this.game?.magic;
    if (!mg?.unlock) return;
    for (const g of list) {
      if (g === 'dark') safe(() => mg.unlock('essences', 'dark', 'pact'));
      else if (g === 'bloodprice') safe(() => mg.unlock('prices', 'bloodprice', 'pact'));
      else if (g === 'all_weaves') {
        for (const [kind, reg] of [['shapes', Shapes], ['essences', Essences], ['twists', Twists]]) for (const id of safe(() => reg.ids(), []) || []) safe(() => mg.unlock(kind, id, 'pact'));
      }
    }
  }

  refuse() {
    const s = this.state;
    if (s.pact) return false;
    s.met = true;
    s.offered = true;
    s.refused = true;
    s.refusedDay = this.day();
    this.mark('refused', 'The stranger refused the pilgrim at the ruins gate.');
    return true;
  }

  // The stranger tells someone what waits at the gate: the hero path.
  warn(byId) {
    const s = this.state;
    if (!byId || s.warned.includes(byId) || s.ending) return false;
    s.warned.push(byId);
    const rep = this.game?.reputation;
    if (s.pact && !s.betrayed) {
      s.betrayed = true;
      safe(() => rep?.oath?.('tempter', { kept: false, knownBy: [byId], note: 'betrayed the pact' }));
      safe(() => this.game.bus?.emit?.('pact_broken', { by: 'player', why: 'warned', to: byId }));
    }
    safe(() => this.game.village?.addRumor?.('tempter_warning', { witnesses: [byId], source: byId }));
    this.mark('warned', `The stranger warned ${this.name(byId)} about the pilgrim at the ruins gate.`);
    return true;
  }

  name(id) {
    return safe(() => this.game.entities.get(id)?.profile?.name?.split(' ')[0], null) || id;
  }

  mark(kind, text) {
    safe(() => this.game.villageLife?.events?.push?.({ kind: `villain_${kind}`, text, t: this.game.clock?.t ?? 0, day: this.day() }));
    safe(() => this.game.bus?.emit?.('villain', { kind, text }));
  }

  // ------------------------------------------------------------------ the tempter

  // Has the stranger shown him anything yet? A boss beaten, or a killing known.
  noticed() {
    const s = this.state;
    if (s.met) return true;
    const bosses = this.game?.flags?.bosses;
    if (bosses && Object.values(bosses).some((b) => b?.defeated)) return true;
    return Object.values(this.murder?.dead || {}).some((r) => byPlayer(r) && knownAsKilling(this.murder, r));
  }

  wanted() {
    const s = this.state;
    if (s.ending || s.defeated) return false;
    if (s.fighting) return true;
    return this.noticed() && this.isNight();
  }

  gatePoint() {
    const g = this.game;
    const gate = safe(() => g.objects?.get?.('ruins_gate'), null);
    const tx = Number.isFinite(gate?.tx) ? gate.tx : Number.isFinite(gate?.x) ? Math.floor(gate.x / TILE) : null;
    const ty = Number.isFinite(gate?.ty) ? gate.ty : Number.isFinite(gate?.y) ? Math.floor(gate.y / TILE) : null;
    const base = tx != null && ty != null ? { tx, ty: ty - 3 } : (() => {
      const loc = safe(() => g.locations?.get?.('sunken_ruins'), null);
      const b = loc?.bounds;
      return b ? { tx: b.x + 20, ty: b.y - 3 } : { tx: 24, ty: 96 };
    })();
    for (let r = 0; r < 5; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const x = base.tx + dx;
          const y = base.ty + dy;
          const blocked = safe(() => g.isBlockedTile?.(x, y, null), false) || safe(() => g.map?.isWater?.(x, y), false);
          if (!blocked) return { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2 };
        }
      }
    }
    return { x: base.tx * TILE + TILE / 2, y: base.ty * TILE + TILE / 2 };
  }

  spawn() {
    const g = this.game;
    if (this.tempter && !this.tempter.removed) return this.tempter;
    if (!g?.entities?.add) return null;
    const at = this.gatePoint();
    if (g.atlas && typeof document !== 'undefined') safe(() => ensureCharacter(g.atlas, TEMPTER_PROFILE.spriteKey, TEMPTER_PROFILE.appearance));
    const t = safe(() => new Tempter(g, this, at.x, at.y), null);
    if (!t) return null;
    this.tempter = g.entities.add(t);
    if (!this.state.hinted) {
      this.state.hinted = true;
      safe(() => g.ui?.toast?.('A cold blue lamp burns outside the ruins gate tonight. Someone is waiting there.', 'info', { key: 'tempter_hint', title: 'The ruins gate' }));
    }
    return this.tempter;
  }

  vanish() {
    const t = this.tempter;
    this.tempter = null;
    if (!t || t.removed) return;
    safe(() => this.game.particles?.emit?.('sparkle', t.x, t.y - 10, { count: 14, color: '#8fd8ff', speed: 20, life: 1 }));
    safe(() => this.game.entities.remove(t));
  }

  // His duty each frame: stand, face the stranger when near. Returns true (the routine waits).
  stand(npc) {
    const P = this.game?.player;
    npc.moveIntent.x = 0;
    npc.moveIntent.y = 0;
    if (P && Math.hypot(P.x - npc.x, P.y - npc.y) < 120) safe(() => npc.faceToward(P.x, P.y));
    return true;
  }

  update(dt) {
    const g = this.game;
    if (!g || (g.state && g.state !== 'playing')) return;
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = CHECK_EVERY;
    this.wrapTalk();
    this.settleKills();
    const s = this.state;
    if (this.wanted()) this.spawn();
    else if (this.tempter && !s.fighting && !safe(() => g.ui?.isModalOpen?.(), false)) this.vanish();
    const t = this.tempter;
    if (t && s.fighting && (t.downed || t.hp <= 0)) this.defeat();
    if (this.hasPact() && !s.ending && this.emptied()) this.villainEnding();
  }

  // ------------------------------------------------------------------ talking

  // The chat reaches him like anyone (TOP PRIORITY A): his words through his own mind. A
  // wrapper on the village's playerSays for him alone; everyone else goes on as before.
  wrapTalk() {
    const v = this.game?.village;
    if (this._wrapped || !v || typeof v.playerSays !== 'function') return;
    const orig = v.playerSays.bind(v);
    const self = this;
    v.playerSays = function (npc, text, opts) {
      const e = typeof npc === 'string' ? this.entity?.(npc) : npc;
      if (e?.id === TEMPTER_ID) return self.playerSays(e, text, opts);
      return orig(npc, text, opts);
    };
    this._wrapped = true;
  }

  // Heard first, kept, then decided, then worded.
  async playerSays(e, text) {
    const said = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    const s = this.state;
    if (!said) return { lines: ['Hm?'], mood: 'amused', source: 'local' };
    s.said.push({ t: Math.round(this.game?.clock?.t ?? 0), day: this.day(), text: said });
    if (s.said.length > 30) s.said.splice(0, s.said.length - 30);
    s.met = true;
    s.metDay ??= this.day();
    safe(() => this.game.village?.heard?.(e, said, {}));
    // What the game decides before anyone words it: a pact, a refusal.
    const decided = this.decide(said);
    const local = this.localLines(said, decided);
    let lines = local;
    const v = this.game?.village;
    const provider = safe(() => v?.provider?.(), null);
    if (provider && typeof v?.askClaude === 'function') {
      const r = await v.askClaude(provider, TEMPTER_RULES, this.task(said, decided), TEMPTER_SCHEMA, 'tempter');
      const say = typeof r?.say === 'string' ? r.say.trim().slice(0, 400) : '';
      if (r?.silent === true) return { lines: [], silent: true, narration: 'Isembard hears you. He only smiles, and says nothing.', mood: 'amused', source: 'claude' };
      if (say) lines = [say];
    }
    return { lines, mood: 'amused', source: provider ? 'claude' : 'local', decided: decided || null };
  }

  decide(said) {
    const t = said.toLowerCase();
    const s = this.state;
    if (s.ending || s.defeated) return null;
    if (!s.pact) {
      if (/\b(teach me (now|first)|now,? then|before\b.*\b(deal|accept|yes)|i accept.*\bbefore|deal.*\bbefore)\b/.test(t)) return this.seal('before') ? 'before' : null;
      if (/\b(teach me after|after,? then|after\b.*\b(deal|accept|yes)|i accept|deal|i'?ll do it|i will do it)\b/.test(t) && !/\b(no|never|not)\b/.test(t)) return this.seal('after') ? 'after' : null;
      if (/\b(no|never|i refuse|go away|leave me|not doing that)\b/.test(t) && s.offered) return this.refuse() ? 'refused' : null;
      if (!s.offered) s.offered = true;
    }
    return null;
  }

  localLines(said, decided) {
    const s = this.state;
    if (decided === 'before') return [...TEMPTER_LINES.sealedBefore];
    if (decided === 'after') return [...TEMPTER_LINES.sealedAfter];
    if (decided === 'refused') return [TEMPTER_LINES.refused[s.said.length % TEMPTER_LINES.refused.length]];
    return [tempterLocal(said, s)];
  }

  // His brief for Claude: only what he knows (the pact, the count he keeps, what was said).
  task(said, decided) {
    const s = this.state;
    const P = this.game?.settings?.playerName || 'the stranger';
    const pr = this.progress();
    const bits = [
      `You are Isembard. ${P} (the player) speaks to you by the ruins gate at night.`,
      s.pact ? `The pact is sealed (${s.pact}). ${pr.done} of the village's ${pr.total} grown souls are dead by their hand; ${pr.left} still keep a flame.` : s.refused ? 'They refused your offer; you are patient.' : 'You have offered them your magic for the deaths of every grown soul in Hearthvale, taught before (a debt) or after.',
      decided === 'before' || decided === 'after' ? `The game has decided: the pact is sealed just now (${decided}). Say so your way.` : decided === 'refused' ? 'The game has decided: they refuse, for now. Say so your way.' : '',
      `Earlier tonight they said: ${s.said.slice(-4, -1).map((x) => `"${x.text}"`).join(' ') || 'nothing yet'}.`,
      `They say now: "${said}"`,
      'Answer as JSON: {"say": string, "silent": boolean|null}.',
    ];
    return bits.filter(Boolean).join('\n');
  }

  brief(said) {
    return this.task(said, null);
  }

  // ------------------------------------------------------------------ his dialogue (E)

  dialogue() {
    const s = this.state;
    const lines = [];
    if (!s.met) {
      s.met = true;
      s.metDay = this.day();
      s.offered = true;
      lines.push(...TEMPTER_LINES.first, ...TEMPTER_LINES.offer);
      this.mark('met', 'The stranger met the pilgrim at the ruins gate.');
    } else if (s.pact) {
      const pr = this.progress();
      lines.push(TEMPTER_LINES.count[this.day() % TEMPTER_LINES.count.length].replace('{left}', pr.left).replace('{done}', pr.done).replace('{total}', pr.total));
    } else if (s.warned.length) lines.push(...TEMPTER_LINES.warned);
    else lines.push(TEMPTER_LINES.idle[this.day() % TEMPTER_LINES.idle.length]);
    return { lines, options: this.options() };
  }

  options() {
    const s = this.state;
    const o = [];
    if (!s.pact && !s.ending) {
      o.push({ id: 'why', label: 'Why me?' }, { id: 'what', label: 'What would you teach?' }, { id: 'price', label: 'What is the price?' });
      o.push({ id: 'before', label: 'Teach me now. (a debt)' }, { id: 'after', label: 'Teach me after.' });
      if (!s.refused) o.push({ id: 'refuse', label: 'No.' });
    }
    if (s.pact) o.push({ id: 'count', label: 'How many are left?' });
    o.push({ id: 'bye', label: 'Leave' });
    return o;
  }

  choose(id) {
    const s = this.state;
    const opts = () => this.options();
    const L = TEMPTER_LINES;
    switch (id) {
      case 'bye':
        return { lines: [L.farewells?.[0] || 'Until the next dark, my friend.'], close: true };
      case 'why':
        return { lines: [...L.why], options: opts() };
      case 'what':
        return { lines: [...L.what], options: opts() };
      case 'price':
        return { lines: [...L.offer], options: opts() };
      case 'before':
        return this.seal('before') ? { lines: [...L.sealedBefore], options: opts() } : { lines: ['It is already done, my friend.'], options: opts() };
      case 'after':
        return this.seal('after') ? { lines: [...L.sealedAfter], options: opts() } : { lines: ['It is already done, my friend.'], options: opts() };
      case 'refuse':
        this.refuse();
        return { lines: [L.refused[0]], options: opts() };
      case 'count': {
        const pr = this.progress();
        return { lines: [L.count[1].replace('{left}', pr.left).replace('{done}', pr.done).replace('{total}', pr.total)], options: opts() };
      }
      case '__back':
      case 'back':
        return { lines: ['Ask.'], options: opts() };
      default:
        return { lines: ['Hm.'], options: opts() };
    }
    void s;
  }

  // Villagers who can be warned: one dialog option (through the murder's dialog hook, which
  // every villager's dialogue already merges), 'murder:villain:warn'.
  dialogOptions(npc) {
    const s = this.state;
    if (!npc?.id || !WARN_TO.includes(npc.id) || !s.met || s.ending || s.warned.includes(npc.id)) return [];
    if (this.game?.murder?.dead?.[npc.id]) return [];
    return [{ id: 'murder:villain:warn', label: 'The man at the ruins gate…' }];
  }

  dialogOption(npc, key) {
    if (key !== 'murder:villain:warn') return null;
    const s = this.state;
    const pact = !!s.pact;
    this.warn(npc.id);
    const who = npc.id;
    const lines = who === 'rowan' || who === 'wys' ? ['A man at the ruins gate, at night, offering you magic for our lives.', pact ? 'And you shook his hand first. ...You came to me anyway. I will remember both.' : 'Then he answers to the watch. Show me where. We go at dark.'] : who === 'aveline' ? ['Cold blue light, and a courteous voice. Oh, child. That is not a man.', 'Do not bargain with it. Do not let it touch you. Tell Rowan.'] : ['At the ruins? At NIGHT? ...Thank you for telling me. Tell Rowan too.'];
    return { lines, options: [] };
  }

  // ------------------------------------------------------------------ the fight (hero path)

  // Struck, or met after the stranger warned the village: he fights, as undead light does.
  onHurt(p) {
    const t = this.tempter;
    if (!t || (p?.target !== t && p?.entity !== t)) return;
    if (p.source && p.source !== this.game?.player) return;
    this.fight();
  }

  fight() {
    const t = this.tempter;
    const s = this.state;
    if (!t || s.fighting || s.ending) return false;
    s.fighting = true;
    t.faction = FACTION.UNDEAD;
    t.duty = null;
    safe(() => t.startFight(this.game.player, { anchor: { x: t.x, y: t.y }, leash: 220 }));
    return true;
  }

  defeat() {
    const s = this.state;
    const t = this.tempter;
    if (s.defeated) return;
    s.defeated = true;
    s.fighting = false;
    if (s.pact && !s.betrayed) {
      s.betrayed = true;
      safe(() => this.game.reputation?.oath?.('tempter', { kept: false, knownBy: s.warned, note: 'struck down the one they swore to' }));
    }
    if (t) safe(() => this.game.bubbles?.say?.(t, TEMPTER_LINES.dissolve[0]));
    this.vanish();
    this.heroEnding();
  }

  // ------------------------------------------------------------------ endings

  heroEnding() {
    const g = this.game;
    const s = this.state;
    if (s.ending) return null;
    s.ending = 'hero';
    s.endingDay = this.day();
    safe(() => g.reputation?.heroTitle?.('wardkeeper'));
    safe(() => g.magic?.unlock?.('essences', 'light', 'tempter'));
    const warner = s.warned.find((id) => !g.murder?.dead?.[id]);
    const steps = [
      { narrate: 'The pilgrim comes apart like frost on a window, into cold blue light, and the light goes down into the ground.' },
      { narrate: 'Over in Hearthvale, every family flame on the chapel altar stands up straight at once.' },
    ];
    if (warner) steps.push({ say: warner, text: warner === 'rowan' ? 'Whatever that was, it is gone. And you told us. Hearthvale will remember that.' : 'It is gone. You told us, and it is gone.' });
    steps.push({ narrate: 'The ward holds. The story goes on.' });
    this.mark('hero', 'The thing at the ruins gate is gone. The ward holds.');
    safe(() => g.bus?.emit?.('villain_ending', { ending: 'hero', day: s.endingDay }));
    const done = () => {
      safe(() => g.ui?.toast?.('The ward holds. Hearthvale will remember who kept it.', 'good', { key: 'ending', title: 'The ward holds' }));
      safe(() => g.save && (g.save.pending = g.save.pending || 'ending'));
    };
    return Promise.resolve(playScript(g.murder || { game: g }, 'villain_hero', { title: 'The ward holds', steps })).then(done, done);
  }

  villainEnding() {
    const g = this.game;
    const s = this.state;
    if (s.ending) return null;
    s.ending = 'villain';
    s.endingDay = this.day();
    if (!s.paid) {
      s.paid = true;
      this.grant(PAID_GIFTS);
      safe(() => g.bus?.emit?.('pact_paid', { gifts: [...PAID_GIFTS], pact: s.pact }));
    } else this.grant(['all_weaves']);
    const steps = [
      { narrate: 'On the chapel altar the last family flame gutters, and goes out.' },
      { narrate: 'Under the well the Wellstone lets go of the ward, the way a held breath lets go.' },
      { narrate: 'In the south-west marsh the ruins breathe in. Blue light comes up the lane, door by open door.' },
      { narrate: 'Isembard is waiting for you on the square. "Your wages," he says. "Everything the Song ever knew. It is borrowed, of course. Everything is."' },
    ];
    this.mark('villain', 'The village is empty. The ward is out, and the ruins are awake.');
    safe(() => g.bus?.emit?.('villain_ending', { ending: 'villain', day: s.endingDay }));
    const close = async () => {
      const m = this.memorial();
      let closed = false;
      try {
        if (typeof g.save?.closeLife === 'function') closed = await g.save.closeLife(m);
      } catch (err) {
        console.warn('[villain] could not close the save', err);
      }
      safe(() => g.bus?.emit?.('life_closed', { memorial: m, ending: 'villain', closed }));
      return m;
    };
    return Promise.resolve(playScript(g.murder || { game: g }, 'villain_end', { title: 'The lamps go out', steps })).then(close, close);
  }

  // The end page (the memorial's shape: src/ui/memorial.js).
  memorial() {
    const g = this.game;
    const day = this.day();
    const name = g?.settings?.playerName && g.settings.playerName !== 'Traveler' ? g.settings.playerName : 'the stranger from the mountain';
    const lyra = g?.lyra || g?.companion;
    const lyraAlive = !!lyra && !lyra.dead && !g?.murder?.dead?.[lyra.id];
    const kids = ['pip', 'tansy'].filter((id) => !g?.murder?.dead?.[id]).map((id) => this.name(id));
    return {
      id: `life_${Date.now().toString(36)}_villain`,
      name,
      companion: 'Lyra',
      day,
      when: safe(() => g.clock.fullString(), '') || `Day ${day}`,
      diedAt: Date.now(),
      place: 'Hearthvale',
      where: 'in Hearthvale',
      cause: 'They kept the bargain made at the ruins gate. Hearthvale\'s flames are out, the ward is gone, and the ruins are awake.',
      level: g?.player?.level ?? 1,
      saved: 0,
      lyra: {
        text: lyraAlive
          ? 'I was not there when the last lamp went out. I am glad I was not.\n\nThey say the stranger stood on the square in the blue light and did not look back. I lit every lamp on that square once, the night my father fell. Nobody will light them now.'
          : 'Nobody is left to write this page. The chandlery is dark. The lamps on Lamplight Lane are cold, and nobody will climb the ladder tonight.',
      },
      village: kids.length ? [{ name: 'On the road', text: `${kids.join(' and ')} ${kids.length > 1 ? 'were' : 'was'} taken down the road to Brightwater by the carters. ${kids.length > 1 ? 'They do' : 'They do'} not look back either.` }] : [],
      ending: 'villain',
    };
  }

  // ------------------------------------------------------------------ saving

  onEvent(type, p) {
    switch (type) {
      case 'villager_killed':
        return this.onKilled(p);
      case 'killing_known':
      case 'murder_witnessed':
      case 'body_found':
        return this.settleKills();
      case 'moot_verdict':
        if (p?.guilty) this.state.verdicts++;
        return this.settleKills();
      case 'damage':
        return this.onHurt(p);
      default:
        return undefined;
    }
  }

  serialize() {
    const s = this.state;
    return { v: 1, ...s, kills: [...s.kills], pending: [...s.pending], warned: [...s.warned], gifts: [...s.gifts], said: s.said.slice(-20), fighting: false };
  }

  deserialize(d) {
    if (!d || typeof d !== 'object') return;
    const s = fresh();
    for (const k of Object.keys(s)) if (d[k] !== undefined) s[k] = d[k];
    for (const k of ['kills', 'pending', 'warned', 'gifts', 'said']) if (!Array.isArray(s[k])) s[k] = [];
    if (!['before', 'after', null].includes(s.pact)) s.pact = null;
    if (!['villain', 'hero', null].includes(s.ending)) s.ending = null;
    s.fighting = false;
    this.state = s;
    this.vanish();
  }
}

const TEMPTER_SCHEMA = {
  type: 'object',
  properties: {
    say: { type: 'string', description: 'what Isembard says aloud, 1-3 sentences; "" only when silent' },
    silent: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
  },
  required: ['say', 'silent'],
  additionalProperties: false,
};

export const villainPlugin = {
  id: 'villain',
  name: 'The tempter',
  description: 'The villain path: the pilgrim at the ruins gate, the pact, the endings (DESIGN §36.4).',
  install(ctx) {
    const g = ctx.game;
    if (!g) return;
    if (!(g.villain instanceof Villain)) g.villain = new Villain(g);
    if (this._pending !== undefined) {
      g.villain.deserialize(this._pending);
      this._pending = undefined;
    }
  },
  update(dt, ctx) {
    ctx.game?.villain?.update?.(dt);
  },
  onEvent(type, p, ctx) {
    safe(() => ctx.game?.villain?.onEvent?.(type, p));
  },
  serialize(ctx) {
    return ctx.game?.villain?.serialize?.() ?? null;
  },
  deserialize(d, ctx) {
    if (ctx.game?.villain) ctx.game.villain.deserialize(d);
    else this._pending = d;
  },
};

// The murder's dialog hook carries his one option to the watch (an installer, after murder
// exists): the merged options of every villager's dialogue (npc.withLifeOptions).
export function installVillainHooks(game) {
  const m = game?.murder;
  const v = game?.villain;
  if (!m || !v || m._villainHooked) return;
  m._villainHooked = true;
  const opts = typeof m.dialogOptions === 'function' ? m.dialogOptions.bind(m) : () => [];
  const opt = typeof m.dialogOption === 'function' ? m.dialogOption.bind(m) : () => null;
  m.dialogOptions = (npc) => [...(safe(() => game.villain.dialogOptions(npc), []) || []), ...(opts(npc) || [])];
  m.dialogOption = (npc, key) => (String(key).startsWith('murder:villain:') ? game.villain.dialogOption(npc, key) : opt(npc, key));
  v.wrapTalk();
}
