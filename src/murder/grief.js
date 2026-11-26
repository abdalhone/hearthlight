// What a death does to Hearthvale (DESIGN §29): the village turns on a known killer;
// grief is real and lasting (family and friends mourn for weeks, their days and lines
// change); the body is laid out in the chapel and buried after a funeral; the Moot meets;
// the dead person's work passes to someone or stays undone; their shop passes to whoever
// keeps it now; missions they gave find another giver or the notice board; and the world
// keeps working whoever is gone (the Maren thread too, if Sister Aveline is). The Moot
// also tries the stranger, and sends them outside.

import { TILE } from '../core/constants.js';
import { VILLAGERS } from '../ai/social/bonds_data.js';
import { placeAt } from '../ai/village_life/errands_data.js';
import { HEIRS, UNDONE, STAND_INS, OFFICIANTS, MOOT_CHAIR, MOOT_HEADS, MAREN_KEEPERS, GRAVE_SPOTS, HIDE, HOUR, DAY, OUTSIDE_DAYS } from './data.js';
import { murderLine, mootLines, lyraLine, FUNERAL, MOOT } from './lines.js';
import { profileById } from '../entities/npc_data.js';
import { isMinor } from '../core/people.js';
import { stance as tradeStance } from '../world/trade.js';
import { parseDefence, checkDefence } from './defence.js';
import { jurorsOf, deliberate, tally } from './jury.js';
import * as Lyra from './lyra.js';
import { funeralScript, trialScripts, playScript } from './scenes.js';

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch (err) {
    if (typeof console !== 'undefined') console.warn('[murder:grief]', err);
    return fallback;
  }
}

const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

function alive(m, id) {
  if (m.dead[id]) return false;
  const e = m.entity(id);
  return !!e && !e.removed && !e.absent;
}

function kin(a, b) {
  const pa = profileById(a)?.family;
  const pb = profileById(b)?.family;
  const has = (f, id) => !!f && ['parent', 'child', 'spouse', 'sibling', 'ward'].some((k) => f[k]?.includes(id));
  return has(pa, b) || has(pb, a);
}

function care(m, a, b) {
  return safe(() => m.life?.care?.(a, b), 0) ?? 0;
}

// ------------------------------------------------------------------ the village turns

export function villageTurns(m, rec) {
  const day = m.day();
  const ids = new Set((rec.seen || []).map((s) => s.id));
  for (const id of VILLAGERS) {
    if (id === rec.id || !alive(m, id)) continue;
    const e = m.entity(id);
    if (!e || typeof e.adjustOpinion !== 'function') continue;
    const c = care(m, id, rec.id);
    const floor = Math.round(4 + (1 - Math.min(1, c)) * 14);
    if (e.opinionOfPlayer > floor) e.adjustOpinion(floor - e.opinionOfPlayer, `the murder of ${m.name(rec.id)}`);
    e.coldDay = day;
    if (c >= 0.6 || kin(id, rec.id) || ids.has(id)) e.wrongedDay = day;
  }
  safe(() => m.village?.addRumor?.('murder', { victim: rec.id, witnesses: [...ids].filter((x) => x !== 'lyra'), source: [...ids][0] || 'village' }));
  safe(() => m.village?.bar?.('ember_kettle', { days: 3, by: 'elda', reason: 'murder' }));
  rec.turned = true;
}

// ------------------------------------------------------------------ found

export function onFound(m, rec) {
  const life = m.life;
  const day = m.day();
  // Grief that lasts: family for a month, close friends for a fortnight, friends a few days.
  for (const id of VILLAGERS) {
    if (id === rec.id || !alive(m, id)) continue;
    const c = care(m, id, rec.id);
    const fam = kin(id, rec.id);
    const days = fam ? 30 : c >= 0.6 ? 14 : c >= 0.35 ? 4 : 0;
    if (!days || !life) continue;
    const cur = life.mourning[id];
    if (!cur || cur.until < day + days || cur.about === rec.id) life.mourning[id] = { about: rec.id, until: day + days, kind: 'grief', kin: fam || undefined };
  }
  planFuneral(m, rec);
  // A death nobody did (old age, murder.die) has no Moot: there is nothing to judge (§36.3).
  if (!rec.natural) planMoot(m, rec, 'death');
  applyHeirs(m);
}

export function everyoneKnows(m, rec) {
  const life = m.life;
  const all = VILLAGERS.filter((id) => id !== rec.id);
  const c = life?.cases?.get?.(rec.id);
  if (c) safe(() => life.knowNews(c, all));
  if (c?.deadRumor) {
    const r = safe(() => m.village?.rumors?.get?.(c.deadRumor));
    if (r) for (const id of all) if (!r.heardBy.includes(id)) r.heardBy.push(id);
  }
}

// ------------------------------------------------------------------ the chapel and the yard

function bierSpot(m) {
  const n = Object.values(m.dead).filter((r) => r.state === 'laid_out').length;
  return { x: 88 * TILE + 8 + (n % 2 ? 22 : 0) * (n % 4 < 2 ? 1 : -1), y: 45 * TILE + 12 + Math.floor(n / 2) * 0 };
}

export function layOut(m, rec) {
  const v = m.entity(rec.id);
  if (!v) return;
  const spot = bierSpot(m);
  rec.state = 'laid_out';
  rec.covered = true;
  rec.bier = spot;
  v.x = spot.x;
  v.y = spot.y;
  v.hidden = false;
  m.event('laid_out', `The watch carried ${m.name(rec.id)} to the chapel. ${cap(m.pronoun(rec.id, 'he'))} lies before the altar.`, { about: rec.id });
}

function graveSpot(m) {
  const g = m.game;
  const chapel = safe(() => g.locations?.get?.('chapel')?.bounds, null) || { x: 83, y: 41 };
  const taken = new Set(m.graves.map((x) => `${x.tx},${x.ty}`));
  for (const [dx, dy] of GRAVE_SPOTS) {
    const tx = chapel.x + dx;
    const ty = chapel.y + dy;
    if (taken.has(`${tx},${ty}`)) continue;
    let blocked = false;
    try {
      blocked = !!g.isBlockedTile?.(tx, ty, null) || !!g.map?.isWater?.(tx, ty) || !!g.map?.buildingAt?.(tx, ty);
    } catch {
      blocked = false;
    }
    if (!blocked) return { tx, ty, x: tx * TILE + 8, y: ty * TILE + 12 };
  }
  const n = m.graves.length;
  return { tx: chapel.x - 2 - n, ty: chapel.y + 3, x: (chapel.x - 2 - n) * TILE + 8, y: (chapel.y + 3) * TILE + 12 };
}

export function bury(m, rec) {
  const v = m.entity(rec.id);
  rec.state = 'buried';
  rec.buriedDay = m.day();
  if (v) v.hidden = true;
  const s = graveSpot(m);
  const gr = { about: rec.id, x: s.x, y: s.y, tx: s.tx, ty: s.ty, day: m.day() };
  m.graves.push(gr);
  m.addGrave(gr);
}

export function epitaph(m, id) {
  const rec = m.dead[id];
  const p = profileById(id);
  const role = p?.role ? `, ${String(p.role).toLowerCase()}` : '';
  const age = rec?.natural && rec.cause === 'age' ? ' Died of old age, in their sleep.' : '';
  return `${m.entity(id)?.name || m.name(id)}${role}.${age} Buried on day ${rec?.buriedDay ?? m.day()}. Hearthvale keeps your flame a while longer.`;
}

// ------------------------------------------------------------------ the funeral

function officiant(m, about) {
  for (const id of OFFICIANTS) if (id !== about && alive(m, id)) return id;
  return null;
}

function mourners(m, about) {
  const out = [];
  for (const id of VILLAGERS) {
    if (id === about || !alive(m, id)) continue;
    if (kin(id, about) || care(m, id, about) >= 0.3) out.push(id);
  }
  return out;
}

export function planFuneral(m, rec) {
  if (m.funerals.some((f) => f.about === rec.id)) return;
  const h = m.hour();
  const day = h < 10 ? m.day() : m.day() + 1;
  m.funerals.push({ about: rec.id, day, hour: 17, state: 'planned', officiant: officiant(m, rec.id) });
  m.event('funeral_planned', `${m.name(rec.id)} will be buried at the chapel at dusk${day === m.day() ? ' today' : ' tomorrow'}.`, { about: rec.id });
  if (m.game?.ui?.toast) m.toast(`The funeral of ${m.entity(rec.id)?.name || m.name(rec.id)} is at the chapel at five, ${day === m.day() ? 'today' : 'tomorrow'}.`, 'info', `funeral:${rec.id}`);
}

export function tickFunerals(m) {
  const t = m.now();
  const day = m.day();
  const h = m.hour();
  for (const f of m.funerals) {
    if (f.state !== 'planned') continue;
    const rec = m.dead[f.about];
    if (!rec) {
      f.state = 'held';
      continue;
    }
    if (day > f.day || (day === f.day && h >= f.hour)) holdFuneral(m, f, rec);
  }
  void t;
}

function nearChapel(m) {
  const P = m.game?.player;
  const b = safe(() => m.game.locations.get('chapel').bounds, null);
  if (!P || !b) return false;
  const tx = P.x / TILE;
  const ty = P.y / TILE;
  return tx >= b.x - 6 && ty >= b.y - 4 && tx < b.x + b.w + 6 && ty < b.y + b.h + 6;
}

export function holdFuneral(m, f, rec) {
  const g = m.game;
  f.state = 'held';
  if (rec.state !== 'laid_out') layOut(m, rec);
  const who = mourners(m, rec.id);
  f.attended = who.slice(0, 12);
  const off = f.officiant && alive(m, f.officiant) ? f.officiant : officiant(m, rec.id);
  f.officiant = off;
  m.event('funeral', `${m.name(rec.id)} was buried in the chapel yard. ${off ? `${m.name(off)} said the words.` : ''} ${who.length ? `${who.slice(0, 4).map((x) => m.name(x)).join(', ')}${who.length > 4 ? ' and others' : ''} were there.` : ''}`.trim(), { about: rec.id });
  m.emit('funeral', { about: rec.id, officiant: off, mourners: who });
  safe(() => g.audio?.play?.('bell', { volume: 0.6 }));
  const canWatch = !!g.story?.player && g.state === 'playing' && nearChapel(m) && !m.isWanted();
  if (canWatch) {
    const script = funeralScript(m, rec, off, who);
    // Gather the mourners in the chapel for the scene.
    standMourners(m, rec, who, off);
    return playScript(m, 'murder_funeral', script).then(() => {
      bury(m, rec);
      return true;
    });
  }
  bury(m, rec);
  return Promise.resolve(false);
}

// The mourners in the pews and the officiant at the altar, for the scene.
function standMourners(m, rec, who, off) {
  const bier = rec.bier || { x: 88 * TILE + 8, y: 45 * TILE + 12 };
  const spots = [
    [-34, 26],
    [34, 26],
    [-34, 58],
    [34, 58],
    [-18, 40],
    [18, 40],
    [-34, 90],
    [34, 90],
  ];
  const place = (e, x, y) => {
    if (!e) return;
    e.x = x;
    e.y = y;
    safe(() => e.walker?.stop?.());
    safe(() => e.leaveBed?.());
    safe(() => e.leaveSeat?.());
    if (e.r) e.r.key = null;
    safe(() => e.faceToward?.(bier.x, bier.y));
    if (e.state === 'sleep') safe(() => e.setState?.('idle'));
  };
  const o = m.entity(off);
  if (o) place(o, bier.x, bier.y - 22);
  who
    .filter((id) => id !== off)
    .slice(0, spots.length)
    .forEach((id, i) => place(m.entity(id), bier.x + spots[i][0], bier.y + spots[i][1]));
  const P = m.game.player;
  if (P) {
    P.x = bier.x;
    P.y = bier.y + 74;
    P.faceDir?.('up');
  }
  const L = m.game.companion;
  if (L && !L.downed && !['left', 'gone'].includes(L.mind?.companionship)) {
    L.x = bier.x + 16;
    L.y = bier.y + 74;
    L.faceToward?.(bier.x, bier.y);
  }
}

// ------------------------------------------------------------------ the Moot

export function planMoot(m, rec, kind = 'death') {
  if (m.moots.some((x) => x.about === rec.id && x.kind === kind && x.state === 'planned')) return;
  const day = m.hour() < 18 ? m.day() : m.day() + 1;
  m.moots.push({ about: rec.id, day, hour: 19.25, state: 'planned', kind });
}

export function chairOf(m, about) {
  for (const id of MOOT_CHAIR) if (id !== about && alive(m, id)) return id;
  return null;
}

export function tickMoots(m) {
  const day = m.day();
  const h = m.hour();
  for (const x of m.moots) {
    if (x.state !== 'planned') continue;
    if (day > x.day || (day === x.day && h >= x.hour)) holdMoot(m, x);
  }
}

function holdMoot(m, x) {
  x.state = 'held';
  const rec = m.dead[x.about];
  const c = m.cases[x.about];
  const chair = chairOf(m, x.about);
  const heads = MOOT_HEADS.filter((id) => alive(m, id));
  const bits = [`The Moot met in the Ember Kettle over ${m.name(x.about)}'s death${chair ? `, ${m.name(chair)} in the chair` : ''}.`];
  const heir = HEIRS[x.about];
  if (heir && alive(m, heir.by)) bits.push(`${m.name(heir.by)} will keep ${heir.work}.`);
  else if (UNDONE[x.about]) bits.push(UNDONE[x.about]);
  bits.push('The night watch is doubled, and every door is barred after the dusk bell.');
  if (c) m.weigh(x.about);
  // Wanted, and still at large: judged where they stand.
  if (m.isWanted() && m.wanted?.about === x.about && m.game?.player?.crime?.kind === 'murder') {
    bits.push(`The stranger did not come. The Moot judged them anyway: outside.`);
    applyVerdict(m, x.about, { guilty: true, absent: true, plea: null });
  } else if (c && c.suspicion >= 0.6 && !c.verdict && c.state !== 'arrest') {
    bits.push('The Moot asked the watch to bring the stranger before it.');
    c.askAt = Math.min(c.askAt ?? Infinity, m.now());
    c.state = 'open';
  }
  m.event('moot', bits.join(' '), { about: x.about });
  m.emit('moot_met', { about: x.about, chair, heads });
  safe(() => m.village?.addRumor?.('moot_sat', { victim: x.about, witnesses: heads, source: chair || 'village' }));
  void rec;
}

// The stranger before the Moot (round 14b, S-11; DESIGN §36.5). The watch's account, then
// the stranger's own defence, in their words (MurderView.defence: a field and three chips;
// closing it is a silent plea), then the Moot weighs it: one Claude call per juror, each with
// only their own brief, in one 25 s budget, the rest by their own rules (jury.js); lies are
// caught only by those who know (defence.js checkClaim). The majority decides, the chair
// breaks a tie; mercy lightens the sentence. Saved while the Moot weighs it (c.trial, and
// trialPending): a reload re-runs it without asking for the defence again and without asking
// Claude again (the votes already in are kept; the rest weigh it themselves).
// opts.plea alone skips it all (tests, the absent): the old arithmetic. opts.defence: the
// words, without the scenes (tests, a headless game).
export function trial(m, about, opts = {}) {
  const c = m.cases[about] || m.openCase(about);
  if (!c || c.verdict) return Promise.resolve(c?.verdict || null);
  m.weigh(about);
  const chair = chairOf(m, about);
  const g = m.game;
  if (opts.plea && opts.defence == null) return Promise.resolve(applyVerdict(m, about, judge(m, about, opts.plea)));
  const resume = c.trial?.state === 'deliberating' && typeof c.trial.defence === 'string';
  const headless = !g.story?.player || !m.view?.defence;
  if (headless && opts.defence == null && !resume) return Promise.resolve(applyVerdict(m, about, judge(m, about, 'deny')));
  if (headless) {
    const words = resume ? c.trial.defence : String(opts.defence ?? '');
    return weighDefence(m, about, words, { quick: resume ? c.trial.quick : opts.quick, resume, provider: opts.provider }).then((v) => applyVerdict(m, about, v));
  }
  const { open, verdictFor } = trialScripts(m, about, chair);
  standTrial(m, about, chair);
  const asked = resume ? Promise.resolve({ text: c.trial.defence, quick: c.trial.quick || null }) : playScript(m, 'murder_trial', open).then(() => m.view.defence({ about, chair }));
  return asked.then((d) => {
    const words = typeof d === 'string' ? d : String(d?.text ?? '');
    const watch = safe(() => m.view.weighing?.({ about, chair, jurors: jurorsOf(m, about) }), null);
    return weighDefence(m, about, words, { quick: d?.quick || null, resume, onVote: (vote) => safe(() => watch?.vote?.(vote)) }).then((v) =>
      Promise.resolve(safe(() => watch?.done?.(v)))
        .then(() => playScript(m, 'murder_verdict', verdictFor(v)))
        .then(() => applyVerdict(m, about, v)),
    );
  });
}

// The defence weighed: claims parsed and checked, the jury asked, caught lies known, a verdict.
export async function weighDefence(m, about, words, { quick = null, resume = false, onVote = null, provider = undefined } = {}) {
  const c = m.cases[about] || m.openCase(about);
  const rec = m.dead[about];
  const text = String(words || '').slice(0, 600);
  const claims = parseDefence(text, m, about);
  if (quick === 'confess' && !claims.some((x) => x.kind === 'confess')) claims.push({ id: `confess${claims.length + 1}`, kind: 'confess', text: 'I did it.' });
  // What the watch said aloud to the room (the strongest four, as the scene reads them).
  const spokenBy = (c?.evidence || [])
    .filter((x) => x.text)
    .sort((a, b) => b.w - a.w)
    .slice(0, 4)
    .map((x) => x.by)
    .filter(Boolean);
  const checked = checkDefence(m, rec, claims, { room: jurorsOf(m, about), spokenBy });
  const t = Math.round(m.now());
  const prior = resume && Array.isArray(c.trial?.votes) ? c.trial.votes.filter(Boolean) : [];
  c.trial = { defence: text, quick: quick || null, claims: checked, votes: [...prior], t: resume ? c.trial?.t ?? t : t, day: m.day(), state: 'deliberating', sentence: null };
  m.trialPending = { about, t, deliberating: true };
  // Nobody is asked twice: after a reload the votes in are kept and the rest weigh it alone.
  const prov = resume ? null : provider !== undefined ? provider : safe(() => m.village?.provider?.(), null);
  const votes = await deliberate(m, about, {
    defence: text,
    checked,
    provider: prov,
    have: prior,
    onVote: (vote) => {
      if (!c.trial.votes.some((x) => x.id === vote.id)) c.trial.votes.push(vote);
      onVote?.(vote);
    },
  });
  // Lies caught (only by those who knew): the watch hears it, and so does the village.
  for (const cl of checked) {
    const by = votes.filter((v) => v.caught?.includes(cl.id)).map((v) => v.id);
    if (!by.length) continue;
    cl.caught = true;
    cl.caughtBy = by;
    rec?.answers?.push({ kind: 'lie_caught', w: 0.5, t, by: by[0], text: `${m.name(by[0])} knew ${m.playerName()} lied to the Moot (${cl.kind.replace('_', ' ')}).` });
    safe(() => m.village?.addRumor?.('lied_about', { victim: about, witnesses: by, saw: by, source: by[0] }));
  }
  const confess = checked.some((x) => x.kind === 'confess');
  if (confess) rec?.answers?.push({ kind: 'confession', w: 1, t, text: `${m.playerName()} confessed before the Moot.` });
  m.weigh(about);
  const chair = chairOf(m, about);
  const tl = tally(votes, chair);
  c.trial.votes = votes;
  c.trial.state = 'decided';
  c.trial.sentence = tl.outcome;
  m.trialPending = null;
  const plea = confess ? 'confess' : text ? 'defence' : 'silent';
  return { guilty: tl.found, mercy: tl.outcome === 'mercy', plea, suspicion: c.suspicion ?? 0, votes, claims: checked, tally: tl };
}

export function judge(m, about, plea) {
  const c = m.cases[about];
  const rec = m.dead[about];
  if (plea === 'confess') {
    rec?.answers?.push({ kind: 'confession', w: 1, t: Math.round(m.now()), text: `${m.playerName()} confessed before the Moot.` });
    m.weigh(about);
  }
  const clearWitness = (rec?.seen || []).some((s) => s.id !== 'lyra' && s.clarity === 'clear') || (rec?.clues || []).some((x) => x.kind === 'carry' && x.clarity === 'clear');
  const s = c?.suspicion ?? 0;
  const guilty = plea === 'confess' || clearWitness || s >= (plea === 'silent' ? 0.7 : 0.75);
  return { guilty, plea, suspicion: s };
}

function standTrial(m, about, chair) {
  const g = m.game;
  const kettle = safe(() => g.locations.get('ember_kettle').center, null) || { x: 70 * TILE, y: 46 * TILE };
  const P = g.player;
  if (P) {
    P.x = kettle.x;
    P.y = kettle.y + 18;
    P.faceDir?.('up');
    P.setState?.('idle');
  }
  const lead = m.cases[about]?.lead;
  const put = (id, dx, dy) => {
    const e = m.entity(id);
    if (!e || !alive(m, id)) return;
    e.x = kettle.x + dx;
    e.y = kettle.y + dy;
    safe(() => e.walker?.stop?.());
    if (e.r) e.r.key = null;
    safe(() => e.faceToward?.(P?.x ?? kettle.x, P?.y ?? kettle.y));
  };
  put(chair, 0, -18);
  put(lead, 26, 4);
  let i = 0;
  for (const id of MOOT_HEADS) {
    if (id === chair || id === lead || !alive(m, id) || i >= 6) continue;
    put(id, -48 + (i % 3) * 16 - (i >= 3 ? 0 : 0), -30 + Math.floor(i / 3) * 30 + (i % 2 ? 6 : 0));
    i++;
  }
}

export function applyVerdict(m, about, v) {
  const g = m.game;
  const c = m.cases[about] || m.openCase(about);
  const P = g.player;
  if (c) {
    c.verdict = v.guilty ? 'guilty' : 'not_proven';
    c.state = 'closed';
    if (c.trial) c.trial.sentence = v.guilty ? (v.mercy ? 'mercy' : 'guilty') : 'not_proven';
  }
  const day = m.day();
  const votes = v.tally ? ` (${v.tally.guilty} guilty, ${v.tally.mercy} mercy, ${v.tally.notProven} not proven)` : '';
  if (v.guilty && v.mercy) {
    // Mercy (round 14b): guilty, and spared the whole of it: one day outside, a quarter of the
    // coin to the family, and the kept flame left burning.
    m.outside = { until: Math.round(m.now() + DAY), day, about, mercy: true };
    m.setWanted(about, 'outside', DAY);
    const coin = P?.inventory?.count?.('coin') ?? 0;
    const fine = Math.floor(coin / 4);
    if (fine > 0) safe(() => P.inventory.remove('coin', fine));
    if (!v.absent) walkOut(m);
    for (const id of VILLAGERS) {
      const e = m.entity(id);
      if (!e || !alive(m, id) || typeof e.adjustOpinion !== 'function') continue;
      if (e.opinionOfPlayer > 20) e.adjustOpinion(20 - e.opinionOfPlayer, 'convicted by the Moot, with mercy');
    }
    safe(() => m.village?.addRumor?.('convicted', { victim: about, witnesses: MOOT_HEADS.filter((id) => alive(m, id)), source: chairOf(m, about) || 'village' }));
    m.event('verdict', `The Moot found ${m.playerName()} guilty of ${m.name(about)}'s death${votes}, and asked mercy: one day outside.`, { about });
    m.toast(`Guilty, with mercy. One day outside${fine ? `, and ${fine} coins go to ${m.name(about)}'s people` : ''}. Your flame still burns.`, 'warn', 'verdict');
  } else if (v.guilty) {
    // The flame is put out, and Aveline (or whoever keeps the altar) will not relight it soon.
    g.flags = g.flags || {};
    if (g.flags.keptFlame) {
      g.flags.keptFlame = null;
      safe(() => g.bus?.emit?.('kept_flame', { lit: false, put_out: true }));
    }
    g.flags.flameBarredUntil = day + 10;
    m.outside = { until: Math.round(m.now() + OUTSIDE_DAYS * DAY), day, about };
    m.setWanted(about, 'outside', OUTSIDE_DAYS * DAY);
    // Blood-price: half the stranger's coin to the dead's people.
    const coin = P?.inventory?.count?.('coin') ?? 0;
    const fine = Math.floor(coin / 2);
    if (fine > 0) safe(() => P.inventory.remove('coin', fine));
    if (!v.absent) walkOut(m);
    for (const id of VILLAGERS) {
      const e = m.entity(id);
      if (!e || !alive(m, id) || typeof e.adjustOpinion !== 'function') continue;
      if (e.opinionOfPlayer > 8) e.adjustOpinion(8 - e.opinionOfPlayer, 'convicted by the Moot');
    }
    safe(() => m.village?.addRumor?.('convicted', { victim: about, witnesses: MOOT_HEADS.filter((id) => alive(m, id)), source: chairOf(m, about) || 'village' }));
    m.event('verdict', `The Moot found ${m.playerName()} guilty of ${m.name(about)}'s death${v.absent ? ', in their absence' : votes}, and put them outside for ${OUTSIDE_DAYS} days.`, { about });
    m.toast(v.absent ? `The Moot sat without you and found you guilty of ${m.name(about)}'s death. Outside: the bell-reach is closed to you for ${OUTSIDE_DAYS} days, and your flame is out.` : `Guilty. Outside for ${OUTSIDE_DAYS} days. Your flame is out${fine ? `, and ${fine} coins go to ${m.name(about)}'s people` : ''}.`, 'warn', 'verdict');
  } else {
    if (P?.crime && (P.crime.kind === 'murder' || P.crime.kind === 'outside')) P.crime = null;
    m.wanted = null;
    safe(() => m.village?.addRumor?.('not_proven', { victim: about, witnesses: MOOT_HEADS.filter((id) => alive(m, id)), source: chairOf(m, about) || 'village' }));
    m.event('verdict', `The Moot could not find it proven that ${m.playerName()} killed ${m.name(about)}${votes}. Nobody believes they are innocent.`, { about });
    m.toast(`Not proven. You are free, and everyone will be watching you.`, 'info', 'verdict');
  }
  Lyra.onVerdict(m, about, v);
  m.emit('moot_verdict', { about, guilty: !!v.guilty, mercy: !!v.mercy, plea: v.plea || null, absent: !!v.absent, votes: (v.votes || []).map((x) => ({ id: x.id, vote: x.vote })) });
  return c?.verdict || null;
}

// Outside: the watch walks the stranger to the King's Road, past the bell-reach.
export function walkOut(m) {
  const g = m.game;
  const P = g.player;
  if (!P) return;
  const free = (tx, ty) => {
    try {
      return !g.isBlockedTile?.(tx, ty, P) && !g.map?.isWater?.(tx, ty);
    } catch {
      return true;
    }
  };
  for (const [tx, ty] of [[150, 84], [146, 84], [154, 83], [140, 84], [10, 84]]) {
    if (!free(tx, ty)) continue;
    P.x = tx * TILE + 8;
    P.y = ty * TILE + 8;
    break;
  }
  safe(() => g.camera?.snap?.());
}

export function tickOutside(m) {
  const o = m.outside;
  if (!o) return;
  if (m.now() >= o.until) {
    m.outside = null;
    const P = m.game?.player;
    if (P?.crime?.kind === 'outside') P.crime = null;
    m.wanted = null;
    m.toast("Your days outside are over. You may walk in under the bell again. Hearthvale will not forget.", 'info', 'outside');
    m.event('outside_over', `${m.playerName()}'s days outside are over.`, {});
  }
}

// ------------------------------------------------------------------ bodies found by chance

export function lakeGivesBack(m, rec) {
  const g = m.game;
  const v = m.entity(rec.id);
  if (!v) return;
  // Washed up on the nearest shore to the dock.
  const dock = safe(() => g.objects?.get?.('fishing_spot'), null);
  let spot = null;
  const from = dock || rec.hidden || v;
  for (let r = 1; r <= 8 && !spot; r++) {
    for (let dy = -r; dy <= r && !spot; dy++) {
      for (let dx = -r; dx <= r && !spot; dx++) {
        const tx = Math.floor(from.x / TILE) + dx;
        const ty = Math.floor(from.y / TILE) + dy;
        let ok = false;
        try {
          ok = !g.map?.isWater?.(tx, ty) && !g.isBlockedTile?.(tx, ty, null) && (g.map?.isWater?.(tx + 1, ty) || g.map?.isWater?.(tx - 1, ty) || g.map?.isWater?.(tx, ty + 1) || g.map?.isWater?.(tx, ty - 1));
        } catch {
          ok = false;
        }
        if (ok) spot = { x: tx * TILE + 8, y: ty * TILE + 10 };
      }
    }
  }
  rec.hidden = null;
  if (spot) {
    v.x = spot.x;
    v.y = spot.y;
    rec.x = spot.x;
    rec.y = spot.y;
  }
  v.hidden = false;
  rec.washedUp = Math.round(m.now());
  m.event('lake', `Mirror Lake gave back a body on the shore.`, { about: rec.id, hidden: true });
}

// Corran walks his shore every morning; anyone at the dock sees what the lake gave back.
export function shoreFinder(m, rec) {
  const v = m.entity(rec.id);
  if (!v || rec.foundAt != null) return;
  const finder = ['corran', 'hess', 'tansy', 'pip', 'hobb'].find((id) => alive(m, id) && m.entity(id)?.state !== 'sleep') || ['corran', 'hess', 'tansy', 'pip', 'hobb'].find((id) => alive(m, id));
  if (!finder) return;
  const e = m.entity(finder);
  if (e && !m.visible(e, 40) && !m.visible(v, 40)) {
    e.x = v.x + 18;
    e.y = v.y + 6;
    safe(() => e.walker?.stop?.());
    safe(() => e.wake?.());
    if (e.r) e.r.key = null;
  }
  rec.washedUp = null;
  m.found(rec.id, finder, 'mirror_lake', { lake: true });
}

export function foundByChance(m, rec, how) {
  const v = m.entity(rec.id);
  if (!v) return;
  const finder = ['hess', 'tansy', 'rowan', 'wys', 'tobias', 'corran'].find((id) => alive(m, id));
  rec.hidden = null;
  v.hidden = false;
  if (finder) m.found(rec.id, finder, m.placeOf(v) || rec.place);
  void how;
}

// A search that reaches the deep woods may stumble on what is hidden there.
export function searchesFind(m) {
  const life = m.life;
  if (!life) return;
  for (const rec of Object.values(m.dead)) {
    if (rec.foundAt != null || rec.hidden?.kind !== 'woods') continue;
    const c = life.cases?.get?.(rec.id);
    const searched = c?.searched?.whisperwood;
    if (!searched || rec.rolled?.[`${searched.by}:${Math.round(searched.t)}`]) continue;
    rec.rolled = rec.rolled || {};
    rec.rolled[`${searched.by}:${Math.round(searched.t)}`] = true;
    const tracker = ['hess', 'tansy', 'rowan', 'wys'].includes(searched.by);
    const p = HIDE.woods.findChance[tracker ? 'tracker' : 'other'];
    if (m.rng()() < p) {
      const v = m.entity(rec.id);
      rec.hidden = null;
      if (v) v.hidden = false;
      m.found(rec.id, searched.by, 'whisperwood');
    }
  }
}

export function onNewDay(m) {
  // Hess walks the hem and further: now and then she finds what the woods keep.
  for (const rec of Object.values(m.dead)) {
    if (rec.foundAt != null) continue;
    if (rec.hidden?.kind === 'woods' && alive(m, 'hess') && m.rng()() < HIDE.woods.hunterDaily) foundByChance(m, rec, 'hunter');
    // Left in the open far out (the meadow, the quarry, the road): somebody comes by within days.
    else if (!rec.hidden && rec.state === 'lying' && m.day() - rec.day >= 1 && m.rng()() < 0.45) foundByChance(m, rec, 'passing');
  }
}

// ------------------------------------------------------------------ heirs, shops, stand-ins

// The dead person's shop passes to their heir: a per-person copy of the heir's profile
// with the shop on it (never the shared data).
export function applyHeirs(m) {
  for (const [dead, h] of Object.entries(HEIRS)) {
    if (!h.shop || !m.knownDead(dead) || !alive(m, h.by)) continue;
    const heir = m.entity(h.by);
    const src = profileById(dead);
    if (!heir || !src?.shop || heir.profile?._inherited === dead) continue;
    if (heir.profile?.shop) continue; // they keep their own shop
    heir.profile = { ...heir.profile, shop: src.shop, _inherited: dead };
  }
}

// Who gives this giver's missions now: them, a stand-in, or the notice board.
export function standIn(m, giver) {
  if (!giver || giver === 'lyra' || giver === 'board' || !m.knownDead(giver)) return giver;
  for (const id of STAND_INS[giver] || []) if (alive(m, id)) return id;
  return 'board';
}

// ------------------------------------------------------------------ their days

const MOURN_HOME_DAYS = 3;

export function entryFor(m, npc, e, hour) {
  const id = npc?.id;
  if (!id || m.dead[id]) return null;
  const day = m.day();
  // The funeral.
  for (const f of m.funerals) {
    if (f.state !== 'planned' || f.day !== day || hour < f.hour - 0.6 || hour >= f.hour + 0.9) continue;
    if (id === f.officiant || kin(id, f.about) || care(m, id, f.about) >= 0.3 || id === 'rowan' || id === 'wys') return { activity: 'pray', at: 'chapel', vl: `funeral-${f.about}`, doing: `at ${m.name(f.about)}'s funeral` };
  }
  // The Moot.
  for (const x of m.moots) {
    if (x.state !== 'planned' || x.day !== day || hour < x.hour - 0.4 || hour >= x.hour + 1.2) continue;
    if (MOOT_HEADS.includes(id)) return { activity: 'socialize', at: 'ember_kettle', vl: `moot-${x.about}`, doing: 'at the Moot' };
  }
  // The watch looking for the stranger, to ask.
  for (const c of Object.values(m.cases)) {
    if (!c.seeking || c.lead !== id || m.session || c.state !== 'open' || m.isWanted()) continue;
    const P = m.game.player;
    if (!P || hour < 6 || hour >= 22) continue;
    const key = Math.round(P.x / 48) * 1000 + Math.round(P.y / 48);
    return { activity: 'errand', at: m.placeOf(P) || 'town_square', spot: { x: P.x + 18, y: P.y + 4 }, vl: `seek-${key}`, doing: `looking for ${m.playerName()}, about ${m.name(c.about)}` };
  }
  const mo = m.life?.mourning?.[id];
  // Family stay home of a morning, the first days.
  if (mo?.kin && m.dead[mo.about] && hour >= 7.5 && hour < 11 && e?.activity !== 'sleep') {
    const rec = m.dead[mo.about];
    const since = rec.foundAt != null ? Math.floor(rec.foundAt / DAY) + 1 : day;
    if (day - since < MOURN_HOME_DAYS && npc.profile?.home) return { activity: 'rest', at: npc.profile.home, vl: `mourn-${mo.about}`, doing: `mourning ${m.name(mo.about)}` };
  }
  // Minding a dead person's work: say so as it is now.
  if (e?.vl && /^cover-/.test(e.vl)) {
    const about = e.vl.slice(6);
    if (m.knownDead(about)) {
      const h = HEIRS[about];
      return { ...e, doing: h ? `keeping ${h.work} now ${m.name(about)} is gone` : e.doing };
    }
  }
  return null;
}

// ------------------------------------------------------------------ their words

export function toneFor(m, npc) {
  const P = m.game?.player;
  if (!P) return null;
  // A known killer: those who saw it, the family and the frightened back away; the rest are cold.
  for (const rec of Object.values(m.dead)) {
    if (!rec.turned && !m.cases[rec.id]?.verdict) continue;
    const guilty = rec.known === 'witnessed' || m.cases[rec.id]?.verdict === 'guilty';
    if (!guilty) continue;
    if (kin(npc.id, rec.id) || (rec.seen || []).some((s) => s.id === npc.id) || isMinor(m.game, npc) || npc.id === 'wenna' || npc.id === 'petra') return 'afraid';
    return 'wronged';
  }
  return null;
}

// Round 14b (S-19): one graded rule for every shop, src/world/trade.js stance(): kin of
// someone they know the stranger killed refuse; others charge a blood price; after the
// Butcher all refuse but a fence; a case they believe of about one of theirs. Deaths
// nobody did never count.
export function refusesTrade(m, npc) {
  return !!tradeStance(m.game, npc).refuse;
}

// A grieving villager's first words are about their grief.
export function decorateDialogue(m, npc, d) {
  if (!d || !Array.isArray(d.lines) || !d.lines.length) return d;
  // To the one who did it, they do not open their grief.
  if (toneFor(m, npc)) return d;
  const mo = m.life?.mourning?.[npc.id];
  if (!mo || !m.knownDead(mo.about)) return d;
  const rec = m.dead[mo.about];
  const when = rec?.state === 'buried' ? (m.day() - (rec.buriedDay ?? m.day()) <= 0 ? 'today' : m.day() - (rec.buriedDay ?? 0) === 1 ? 'yesterday' : 'last week') : 'soon';
  const key = rec?.state === 'buried' ? 'mournGreet' : null;
  const line = key ? murderLine(npc.id, key, { about: mo.about, when, P: m.playerName() }, m.rng()) : safe(() => m.life.line(npc.id, 'grief', { about: mo.about }));
  if (!line) return d;
  return { ...d, lines: [line, ...d.lines.slice(1)] };
}

export function dialogOptions(m, npc) {
  const out = [];
  if (!npc?.id) return out;
  // Turning yourself in to the watch.
  if ((npc.id === 'rowan' || npc.id === 'wys' || (!alive(m, 'rowan') && !alive(m, 'wys') && npc.id === 'alder')) && m.isWanted() && m.game?.player?.crime?.kind === 'murder') out.push({ id: 'murder:surrender', label: 'Give yourself up' });
  for (const c of Object.values(m.cases)) {
    if (c.lead === npc.id && c.state === 'open' && c.suspicion >= 0.15 && !m.session && !m.isWanted()) out.push({ id: `murder:ask:${c.about}`, label: `About ${m.name(c.about)}…` });
  }
  return out;
}

export function dialogOption(m, npc, key) {
  const [, action, about] = String(key).split(':');
  if (action === 'surrender') {
    m.surrender(m.wanted?.about, npc.id);
    return { lines: [npc.id === 'wys' ? 'You— all right. All right. Hands where I can see them.' : 'Hands where I can see them. The Moot will hear you.'], close: true };
  }
  if (action === 'ask' && about) {
    m.cases[about].seeking = false;
    m.beginQuestioningUI(about);
    return { lines: [], close: true };
  }
  return null;
}

// ------------------------------------------------------------------ the Maren thread without Aveline

export function onTopic(m, p) {
  if (!p?.npc || !/maren/i.test(String(p.topic || ''))) return;
  if (!m.knownDead('aveline') || !MAREN_KEEPERS.includes(p.npc.id)) return;
  const quest = safe(() => m.game.plugins?.get?.('quest'));
  const ctx = safe(() => m.game.plugins?.ctx);
  if (!quest || !ctx) return;
  const st = safe(() => quest.stageOf(m.game)?.index, 0) ?? 0;
  if (st > 1) return;
  safe(() => quest.advance(ctx, 2, 'aveline_gone'));
  m.event('maren', `${m.name(p.npc.id)} told what Sister Aveline used to tell: Maren walked toward the Sunken Ruins at midsummer.`, { who: p.npc.id, about: 'maren' });
}

function cap(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

export { MOOT, FUNERAL, lyraLine, mootLines, placeAt };
