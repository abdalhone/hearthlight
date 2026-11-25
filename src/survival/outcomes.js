import {
  TENDED_HOURS,
  TENDED_HP,
  MIRA_BILL,
  ARREST_FINE,
  HOME_WAKE_HP,
  FLAME_WAKE_HP,
  PATIENT_SECONDS,
  OUT_FOR_A_DAY,
} from './constants.js';
import { MIRA_WAKE, LYRA_BEDSIDE, SAVED_BY_PLAYER, lyraTone, pickLine } from './lines.js';
import { spendKeptFlame } from './kept_flame.js';
import { composeMemorial } from './epitaph.js';
import { addPastLife } from './past_lives.js';
import { speak, isLyra, isVillager } from './rescue.js';

// How a fall ends (DESIGN §27): tended in the sickroom hours later, back at the chapel at
// dawn through the kept flame, at home (the softer setting), or the end of the story.
// State changes happen here; the screens (src/ui/death_view.js) follow the events.

function safe(fn, fallback = null) {
  try {
    const v = fn();
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

function coins(n) {
  return `${n} ${n === 1 ? 'coin' : 'coins'}`;
}

// What death took (§27, round 14): the words for the ember-ring the coins now lie in, and
// for an older one that has gone out.
export function ringWords(ring) {
  if (!ring) return '';
  let text = '';
  if (ring.lost > 0) text += ` The embers where you fell before have gone out: those ${coins(ring.lost)} are gone for good.`;
  if (ring.coins > 0) text += ` Everything you carried, ${coins(ring.coins)}, lies where you fell${ring.where ? `, ${ring.where}` : ''}, in a ring of embers. Walk back and take it; die before you reach it and it is gone.`;
  return text;
}

function standUp(sv, actor, spot, hpFrac) {
  actor.downed = false;
  actor.dead = false;
  actor.hp = Math.max(1, Math.round(actor.maxHp * hpFrac));
  actor.x = spot.x;
  actor.y = spot.y;
  actor.z = 0;
  if (actor.knock) {
    actor.knock.x = 0;
    actor.knock.y = 0;
  }
  if (actor.vel) {
    actor.vel.x = 0;
    actor.vel.y = 0;
  }
  if (actor.moveIntent) {
    actor.moveIntent.x = 0;
    actor.moveIntent.y = 0;
  }
  actor.lockTime = 0;
  actor.setState?.('idle');
  actor.invuln = Math.max(actor.invuln || 0, 2);
  safe(() => sv.game.combat?.downedAt?.delete?.(actor));
  if (actor === sv.game.player) {
    actor._lastX = actor.x;
    actor._lastY = actor.y;
  }
}

// Beside a bed, on the side that is open.
export function bedSide(sv, bed, who) {
  const s = bed?.sleepSpot || { x: (bed?.x ?? 0) + 16, y: (bed?.y ?? 0) - 6 };
  return sv.freeSpotNear(s.x, s.y + 4, who) || { x: s.x, y: s.y + 4 };
}

async function fade(sv, dir, seconds) {
  const ui = sv.game.ui;
  try {
    const p = dir === 'out' ? ui?.fadeOut?.(seconds) : ui?.fadeIn?.(seconds);
    if (p && typeof p.then === 'function') await p;
  } catch {
    /* the UI is optional */
  }
}

function toast(sv, text, kind = 'info', opts) {
  try {
    sv.game.ui?.toast?.(text, kind, opts);
  } catch {
    /* the UI is optional */
  }
}

function requestSave(sv, reason = 'auto') {
  const s = sv.game.save;
  if (!s) return;
  try {
    if (typeof s.save === 'function') s.save(reason).catch?.(() => {});
  } catch {
    /* saving is best effort */
  }
}

// ---------------------------------------------------------------- the sickroom

// Carried in alive: they lie in the cot, the screen goes dark, and they wake there hours
// later, tended, with Mira's bill and a weakness for a day.
export function tendPlayer(sv, carrier, bed, { arrested = false } = {}) {
  const g = sv.game;
  const P = g.player;
  const rec = sv.falls.get(P);
  const lyraCame = !!rec?.lyraCame || (carrier && isLyra(sv, carrier));
  sv.resolveFall(P, 'tended', { keepCarry: false });
  P.downed = false;
  P.hp = Math.max(1, Math.round(P.maxHp * 0.12));
  P.x = bed.lie?.x ?? bed.x;
  P.y = bed.lie?.y ?? bed.y - 6;
  P.setState?.('sleep');
  safe(() => g.combat?.downedAt?.delete?.(P));
  const prevState = g.state;
  if (g.state === 'playing') g.state = 'sleeping';
  g.bus?.emit?.('player_tended', { by: carrier || null, bed, arrested, hours: TENDED_HOURS });
  const seq = async () => {
    await fade(sv, 'out', 1.6);
    const sph = g.clock?.secondsPerHour || 37.5;
    if (g.clock) {
      if (typeof g.clock.skipTo === 'function') g.clock.skipTo(((g.clock.hour ?? 0) + TENDED_HOURS) % 24);
      else g.clock.t += TENDED_HOURS * sph;
    }
    let fine = 0;
    let lyingIn = bed;
    if (arrested) {
      safe(() => {
        if (!g.combat?.clearCrime?.(P, 'arrested')) P.crime = null;
      });
      fine = Math.floor((P.inventory?.count?.('coin') ?? 0) * ARREST_FINE);
      if (fine > 0) P.inventory.remove('coin', fine);
      lyingIn = sv.freeBed(['sickbed_1', 'sickbed_2', 'infirmary_cot']) || bed;
    }
    const bill = sv.bill(MIRA_BILL, 'tending', { quiet: true });
    standUp(sv, P, bedSide(sv, lyingIn, P), TENDED_HP);
    P.faceDir?.('down');
    sv.addCondition('mending');
    const mira = g.entities?.get?.('mira');
    if (mira && !mira.downed && !sv.patients.has(mira) && !sv.jobs.has(mira) && mira.mode !== 'fight') {
      const s = sv.freeSpotNear(P.x + 14, P.y + 6, mira);
      if (s) {
        mira.x = s.x;
        mira.y = s.y;
        mira.walker?.stop?.();
        mira.faceToward?.(P.x, P.y);
        if (mira.r) mira.r.key = null;
        mira.talkingUntil = (g.clock?.t ?? 0) + 6;
      }
    }
    const lyra = g.companion;
    let lyraLine = '';
    if (lyraCame && lyra && !lyra.downed && !sv.patients.has(lyra) && lyraTone(lyra) !== 'cold') {
      const s = sv.freeSpotNear(P.x - 14, P.y + 4, lyra);
      if (s) {
        lyra.x = s.x;
        lyra.y = s.y;
        lyra.behavior?.steering?.reset?.();
        lyra.faceToward?.(P.x, P.y);
      }
      lyraLine = pickLine(LYRA_BEDSIDE[lyraTone(lyra)] || [], g.rng);
    }
    safe(() => g.camera?.snap?.());
    if (g.state === 'sleeping') g.state = prevState === 'sleeping' ? 'playing' : prevState || 'playing';
    requestSave(sv, 'auto');
    await fade(sv, 'in', 1.4);
    const who = carrier ? (carrier === g.companion ? `${carrier.name || 'Lyra'} carried you here` : `${carrier.name || 'Someone'} carried you here`) : 'Someone carried you here';
    let text = arrested
      ? `${carrier?.name || 'The watch'} carried you to the guardhouse cell and sent for Mira. When the bleeding would not stop, they moved you to her sickroom. You wake hours later, stitched and aching.`
      : `You wake in a cot at Fennick's Herbs, hours later. ${who}; Mira sat up with you.`;
    if (fine > 0) text += ` The watch kept ${coins(fine)} as a fine.`;
    text += ' Mending: weaker for a day.';
    if (bill.paid > 0 || bill.owed > 0) text += ` Mira's bill: ${coins(MIRA_BILL)}${bill.owed > 0 ? ` (${bill.owed} still owed)` : ''}.`;
    toast(sv, text, 'warn', { key: 'wake', title: 'Tended' });
    if (mira && mira.distTo?.(P) < 40) speak(sv, mira, pickLine(MIRA_WAKE, g.rng));
    if (lyraLine) setTimeout(() => speak(sv, lyra, lyraLine), 1800);
    g.bus?.emit?.('player_woke_tended', { bill: bill.paid, owed: bill.owed, fine });
  };
  return (sv.pending = seq());
}

// ---------------------------------------------------------------- dying

// "Wake at home" (the softer setting, §27): the old way. Someone found you; you wake in
// your own bed; your coins stay where you fell, in the ember-ring.
export function wakeHome(sv, rec) {
  const g = sv.game;
  const P = g.player;
  const prev = g.state;
  if (g.state === 'playing') g.state = 'sleeping';
  g.bus?.emit?.('player_died', { mode: 'home', ring: rec?.ring || null });
  const seq = async () => {
    await fade(sv, 'out', 1.2);
    const bed = safe(() => g.objects?.get?.('home_bed'));
    const spot = bed ? bedSide(sv, bed, P) : g.spawns?.player || { x: P.x, y: P.y };
    standUp(sv, P, spot, HOME_WAKE_HP);
    P.faceDir?.('down');
    sv.addCondition('bruised');
    const lyra = g.companion;
    let carrier = null;
    if (lyra && !lyra.downed && rec?.lyraCame) {
      carrier = lyra;
      const s = sv.freeSpotNear(P.x + 14, P.y, lyra);
      if (s) {
        lyra.x = s.x;
        lyra.y = s.y;
      }
      lyra.behavior?.clearFocus?.();
      lyra.behavior?.steering?.reset?.();
    }
    safe(() => g.camera?.snap?.());
    sv._quiet = true;
    g.bus?.emit?.('revived', { entity: P, by: carrier });
    sv._quiet = false;
    if (g.state === 'sleeping') g.state = prev === 'sleeping' ? 'playing' : prev || 'playing';
    requestSave(sv, 'auto');
    await fade(sv, 'in', 1.2);
    let text = carrier ? `${carrier.name || 'Lyra'} carried you home. You wake in your own bed, bruised but breathing.` : 'Someone from the village found you and carried you home. You wake in your own bed, bruised but breathing.';
    text += ringWords(rec?.ring);
    toast(sv, text, 'warn', { key: 'wake', title: 'You died' });
  };
  return (sv.pending = seq());
}

// The kept flame brings them back (§27): the flame is spent, coin is lost, and they wake
// at the chapel at dawn, flame-thin, and the whole village knows.
export function flameReturn(sv, rec) {
  const g = sv.game;
  const P = g.player;
  if (g.state === 'playing') g.state = 'sleeping';
  g.bus?.emit?.('player_died', { mode: 'flame', ring: rec?.ring || null });
  const seq = async () => {
    await fade(sv, 'out', 1.4);
    await sv.wait(3.8);
    spendKeptFlame(g);
    if (g.clock?.skipTo) g.clock.skipTo(6);
    const lost = rec?.ring?.coins || 0; // in the embers where they fell
    const altar = safe(() => (g.objects?.all?.() || []).find((o) => o.objType === 'altar'));
    const chapel = safe(() => g.locations?.get?.('chapel'));
    const at = altar ? { x: altar.x, y: altar.y + 36 } : chapel?.center || { x: P.x, y: P.y };
    standUp(sv, P, sv.freeSpotNear(at.x, at.y, P) || at, FLAME_WAKE_HP);
    P.faceDir?.('up');
    sv.addCondition('flame_thin');
    const ave = g.entities?.get?.('aveline');
    if (ave && !ave.downed && !sv.patients.has(ave)) {
      const s = sv.freeSpotNear(P.x + 16, P.y - 8, ave);
      if (s) {
        ave.x = s.x;
        ave.y = s.y;
        ave.walker?.stop?.();
        if (ave.r) ave.r.key = null;
        ave.faceToward?.(P.x, P.y);
        ave.talkingUntil = (g.clock?.t ?? 0) + 8;
      }
    }
    sv.lyraRemembers(P, 'flame');
    safe(() => g.village?.addRumor?.('flame_spent', { witnesses: ['aveline', ...(g.village?.villagers?.() || []).map((v) => v.id)], source: 'aveline' }));
    safe(() => g.camera?.snap?.());
    if (g.state === 'sleeping') g.state = 'playing';
    requestSave(sv, 'flame');
    g.bus?.emit?.('flame_returned', { lost });
    await fade(sv, 'in', 2.2);
    toast(sv, `You died. The flame Sister Aveline kept in your name brought you back at dawn, and is spent.${ringWords(rec?.ring)} Flame-thin: weaker for a day. The whole village knows.`, 'warn', { key: 'wake', title: 'The kept flame' });
    if (ave && ave.distTo?.(P) < 48) speak(sv, ave, 'Welcome back, child. The flame is spent. Light another before you need it.');
  };
  return (sv.pending = seq());
}

// The end of the story (§27): the memorial, and the save closed for good.
export function finalDeath(sv, rec) {
  const g = sv.game;
  g.state = 'dead';
  const memorial = composeMemorial(g, rec);
  const mind = g.companion?.mind;
  safe(() => mind?.addDiary?.(memorial.lyra.text, g.clock?.day ?? 1));
  safe(() => mind?.remember?.(`${g.player?.name && g.player.name !== 'Traveler' ? g.player.name : 'The stranger'} died today, ${memorial.where}. No flame was kept for them.`, { importance: 10, about: ['player'], tags: ['death'], emotion: 'sadness' }));
  sv.memorial = memorial;
  g.bus?.emit?.('player_died', { mode: 'final', memorial });
  const seq = async () => {
    let closed = false;
    try {
      if (typeof g.save?.closeLife === 'function') closed = await g.save.closeLife(memorial);
    } catch (err) {
      console.warn('[survival] could not close the save', err);
    }
    if (!closed) addPastLife(memorial);
    g.bus?.emit?.('life_closed', { memorial });
    return memorial;
  };
  return (sv.pending = seq());
}

// ---------------------------------------------------------------- patients

// Someone laid in a cot (or carried off gravely hurt) rests there until they are well.
export function admitPatient(sv, actor, bed, { seconds = PATIENT_SECONDS, savedBy = null, kind = 'recover' } = {}) {
  const g = sv.game;
  if (actor.downed) {
    sv._quiet = true;
    try {
      if (!g.combat?.revive?.(actor, savedBy || null, 0.25)) {
        actor.downed = false;
        actor.hp = Math.max(1, Math.round(actor.maxHp * 0.25));
      }
    } finally {
      sv._quiet = false;
    }
  }
  sv.resolveFall(actor, 'patient');
  actor.x = bed.lie?.x ?? bed.x;
  actor.y = bed.lie?.y ?? bed.y - 6;
  if (actor.moveIntent) {
    actor.moveIntent.x = 0;
    actor.moveIntent.y = 0;
  }
  actor.setState?.('sleep');
  if (isVillager(actor)) {
    actor.mode = 'patient';
    actor.help = null;
    actor.walker?.stop?.();
    actor.leaveSeat?.();
  }
  if (isLyra(sv, actor)) {
    safe(() => actor.behavior?.cancelTask?.());
    safe(() => actor.behavior?.steering?.stop?.());
  }
  const now = g.clock?.t ?? 0;
  sv.patients.set(actor, { bed, until: now + seconds, kind, savedBy: savedBy?.id ?? savedBy ?? null });
  g.bus?.emit?.('patient', { entity: actor, bed, kind, savedBy: savedBy || null });
}

export function releasePatient(sv, actor) {
  const p = sv.patients.get(actor);
  if (!p) return;
  sv.patients.delete(actor);
  const g = sv.game;
  const spot = bedSide(sv, p.bed, actor);
  actor.x = spot.x;
  actor.y = spot.y;
  actor.hp = Math.max(actor.hp, Math.round(actor.maxHp * 0.6));
  actor.setState?.('idle');
  if (isVillager(actor)) {
    if (actor.mode === 'patient') actor.mode = 'routine';
    if (actor.r) actor.r.key = null;
    actor.shakenDay = g.clock?.day ?? 1;
    if (p.savedBy === 'player') {
      actor.pendingSay = { at: (g.clock?.t ?? 0) + 0.6, text: pickLine(SAVED_BY_PLAYER, g.rng), kind: 'say', target: g.player };
    }
  }
  if (isLyra(sv, actor)) safe(() => actor.behavior?.steering?.reset?.());
  g.bus?.emit?.('patient_released', { entity: actor, kind: p.kind });
}

// Nobody came in time for Lyra or a villager (§27): they are carried off gravely hurt and
// are out for a day, in a sickroom cot (or their own bed when the cots are full).
export function carriedOff(sv, rec) {
  const g = sv.game;
  const a = rec.actor;
  if (a.carriedBy) {
    // Still in someone's arms: they will be laid down, gravely hurt.
    rec.grave = true;
    return;
  }
  const bed = sv.freeBed(['sickbed_1', 'sickbed_2', 'infirmary_cot']) || sv.ownBed(a);
  const seen = sv.visible(a);
  if (!bed) {
    sv.resolveFall(a, 'carried_off');
    return;
  }
  admitPatient(sv, a, bed, { seconds: OUT_FOR_A_DAY, kind: 'grave' });
  if (isLyra(sv, a)) {
    safe(() => a.mind?.remember?.('Nobody came when I went down. Someone carried me to Mira’s in the end, and I lost a day.', { importance: 7, tags: ['hurt'], emotion: 'sadness' }));
  }
  if (seen || isLyra(sv, a)) toast(sv, `${a.name || 'Someone'} was carried off to ${bed.id?.startsWith('sickbed') ? "Mira's sickroom" : 'bed'}, gravely hurt. They will be out for a day.`, 'warn', { key: `off_${a.id}` });
}
