import { normalizeArgs } from '../brain/actions.js';
import { itemDef, itemName, resolveItemId } from '../../entities/items.js';
import { ACTION_CATEGORY, AMOUNT_IS_PAY, GAME_SPECIES, PET_SPECIES, JOB_TASTE, MAREN_PLACES, T } from './autonomy_data.js';
import { hourLabel } from './autonomy_agenda.js';
import { findRecord, protects, harmAsked, parseCite } from './memory_edits.js';

// Every order is a request (DESIGN §16.4). analyzeRequest() weighs one request from the
// player against her trust and fear of them, the risk to her, her values, her needs,
// her goals and what's in it for her, and how hard they are pushing. It has no side
// effects: Autonomy.evaluateRequest() records refusals, deals and promises around it.
//
// verdict: { decision: 'accept'|'accept_conditional'|'counter'|'refuse'|'refuse_and_act',
//            reasons: [string], message, condition?, counter?: {name, args}, act?: {name, args},
//            score, category, risk, key, pay, lineKey, conditionKind }

const ACCEPT = 0.12;
const BARGAIN = 0;
const COUNTER = -0.18;

const BUSY_WORDS = { work: 'she has paid work', lead: 'she is following a lead on Maren', visit: 'she is visiting a friend' };

const JOB_WORDS = {
  chop_wood: 'chopping wood',
  gather_herbs: 'gathering herbs',
  forage: 'foraging',
  mine_ore: 'mining',
  fish: 'fishing',
  farm: 'helping on the farm',
  cook: 'cooking',
  collect_loot: 'collecting loot',
};

// Requests that mean the same thing share a key, so "attack mode" after a refused
// "attack that wolf" counts as asking again.
export function requestKey(action, args = {}) {
  const v = String(args.value || '').toLowerCase();
  const t = String(args.target || '').toLowerCase();
  if ((action === 'set_combat_mode' && v === 'attack') || action === 'attack' || action === 'bind') return `fight:${action === 'set_combat_mode' ? '*' : t}`;
  if (action === 'explore' || action === 'patrol' || action === 'goto') return `go:${t}`;
  if (action === 'start_job') return `job:${v}`;
  if (action === 'rejoin' || action === 'follow' || action === 'come_here') return 'company';
  return `${action}:${v || t}`;
}

// How dangerous a request is for her, 0..1, with the main reasons.
export function estimateRisk(a, { location = null, target = null, x = null, y = null } = {}) {
  const v = a.snapshot();
  const lyra = a.lyra();
  const parts = [];
  let risk = 0;
  let px = x ?? target?.x ?? location?.center?.x ?? lyra?.x ?? 0;
  let py = y ?? target?.y ?? location?.center?.y ?? lyra?.y ?? 0;
  const loc = location || a.locationAt(px, py);
  const danger = Number(loc?.danger) || 0;
  if (danger) {
    risk += danger * 0.16;
    if (danger >= 2) parts.push(`${loc.name || 'that place'} is dangerous`);
  }
  // Nearby hostiles around where she would be, against her strength.
  const power = (0.55 + 0.45 * v.hpFrac) * (1 + 0.12 * Math.max(0, (lyra?.level || 1) - 1));
  const th = a.threatsNear(px, py, 180);
  if (th.score > 0) {
    const r = Math.min(0.45, (th.score * 0.06) / power);
    risk += r;
    if (r > 0.12) parts.push(th.count > 1 ? `${th.count} hostiles close by` : 'something hostile close by');
  }
  if (target && target.type === 'actor' && !a.isVillager(target)) {
    const threat = Number.isFinite(target.threat) ? target.threat : 1;
    const tough = Math.min(2, (target.hp || 10) / Math.max(1, (lyra?.atk || 7) * 5));
    const r = (threat * 0.09 + tough * 0.08) / power;
    risk += r;
    if (r > 0.2) parts.push(`${a.displayName(target)} could kill me`);
  }
  const outdoors = !loc?.indoor;
  if (v.isNight && outdoors) {
    risk += danger >= 2 ? 0.18 : 0.08;
    parts.push('it’s dark');
  }
  if (outdoors && (v.weather === 'rain' || v.weather === 'fog')) risk += 0.04;
  if (v.hpFrac < 1) {
    risk += (1 - v.hpFrac) * 0.3;
    if (v.hpFrac < 0.5) parts.push('I’m hurt');
  }
  risk += (1 - v.energy) * 0.08;
  if (v.downedRecently) {
    risk += 0.08;
    parts.push('I was knocked down not long ago');
  }
  if (v.recklessRecently) risk += 0.06;
  return { risk: Math.max(0, Math.min(1, risk)), parts, location: loc };
}

function coinWeight(pay, purse) {
  if (!(pay > 0)) return 0;
  return 0.45 * (1 - Math.exp(-pay / 12)) * (purse < 10 ? 1.25 : 1);
}

function jobLabel(id) {
  return JOB_WORDS[id] || String(id || 'that').replace(/_/g, ' ');
}

export function analyzeRequest(a, req = {}) {
  const action = String(req.action || req.name || '').trim();
  const raw = req.args || {};
  const args = normalizeArgs(raw);
  const v = a.snapshot();
  let category = ACTION_CATEGORY[action] || 'misc';
  const out = {
    action,
    args,
    decision: 'accept',
    reasons: [],
    score: 0,
    category,
    risk: 0,
    key: requestKey(action, args),
    pay: 0,
    lineKey: null,
    vars: { target: '', place: '', coins: 0, item: '', job: '', time: '', npc: '' },
    condition: null,
    conditionKind: null,
    counter: null,
    act: null,
    veto: null,
    pushed: false,
  };
  let worst = { w: 0, key: 'no_generic' };
  const add = (w, reason, refuseKey) => {
    out.score += w;
    if (reason) out.reasons.push(reason);
    if (w < worst.w && refuseKey) worst = { w, key: refuseKey };
  };
  const veto = (decision, key, reason, extra = {}) => {
    out.veto = { decision, key, reason, ...extra };
  };

  // Words between them (a promise, a note, a feeling): never an imposition, and never
  // locked, even when she has cut the player off (round 14b T-A2): the words land.
  if (category === 'talk') {
    out.score = 1;
    out.quiet = true; // nothing to agree to out loud: the words themselves are the answer
    return finish(a, out, v, worst);
  }
  // Gone and left: she is no longer anyone's to ask (requests, not words).
  if (v.state === 'gone') {
    veto('refuse', 'no_gone', 'she has cut you off, and takes no requests from you');
    return finish(a, out, v, worst);
  }
  if (v.state === 'left' && action !== 'rejoin') {
    veto('refuse', 'no_left', 'she broke off with you and takes no requests from you now');
    return finish(a, out, v, worst);
  }

  // Base willingness: trust, affinity, respect and fear of the player.
  const base = 0.2 + (v.trust - 40) * 0.009 + v.affinity * 0.0035 - v.fear * 0.006 + (v.respect - 30) * 0.0015 + v.valence * 0.05;
  out.score = base;
  if (v.trust < T.waryTrust) out.reasons.push(`trust in you is low (${Math.round(v.trust)})`);
  else if (v.trust >= 60) out.reasons.push(`she trusts you (${Math.round(v.trust)})`);
  if (v.fear > 25) out.reasons.push(`she is afraid of you (${Math.round(v.fear)})`);
  if (v.trust < T.waryTrust && base < 0) worst = { w: base, key: 'no_trust' };
  if (v.fear > 30 && -v.fear * 0.006 < worst.w) worst = { w: -v.fear * 0.006, key: 'no_fear' };
  if (v.state === 'wary' && category !== 'move' && category !== 'safe' && category !== 'trivial' && category !== 'stance') add(-0.08, 'she is wary of you', 'no_trust');
  if (v.anger > 0.5) add(-0.1, 'she is angry', 'no_angry');

  // Pay: coin offered with the request (req.pay, args.pay, args.offer as a number or as the
  // brain's { coins, share, paid }, a coin amount on an action whose amount means nothing,
  // or an offer she heard a moment ago).
  const offer = raw.offer && typeof raw.offer === 'object' ? raw.offer : null;
  let pay = Number(req.pay ?? raw.pay ?? (offer ? offer.coins : raw.offer));
  if (!(pay > 0) && AMOUNT_IS_PAY.has(action) && args.amount > 0 && !(action === 'set_combat_mode' && args.amount < 1)) pay = args.amount;
  if (!(pay > 0)) pay = a.pendingOfferAmount();
  out.pay = pay > 0 ? Math.round(pay) : 0;
  out.share = !!offer?.share;

  // Asking again within 60 s of a refusal (without sweetening the deal).
  const prev = a.lastRefusal(out.key);
  if (prev && v.now - prev.t <= 60 && v.now - prev.t >= 2 && !(out.pay > (prev.pay || 0))) {
    out.pushed = true;
    add(-0.2, 'you asked again right after she said no', 'no_pushed');
  }

  const target = args.target ? a.resolveEntity(args.target) : null;
  out.vars.target = target ? a.displayName(target) : args.target || '';

  // Values: never the innocent, friends, villagers or pets.
  const harmful = action === 'attack' || action === 'bind' || (action === 'set_relationship' && /^enemy$/i.test(args.value || ''));
  if (harmful && target) {
    const valuesVerdict = judgeTarget(a, v, target, args, action);
    if (valuesVerdict) {
      veto(valuesVerdict.decision, valuesVerdict.key, valuesVerdict.reason, valuesVerdict);
      return finish(a, out, v, worst);
    }
  }

  // Reclassify by what is actually asked.
  if (action === 'set_combat_mode') category = String(args.value || '').toLowerCase() === 'attack' ? 'combat' : 'stance';
  let place = null;
  if (action === 'goto' || action === 'explore' || action === 'patrol' || action === 'guard' || action === 'stay' || action === 'wait_outside') {
    place = args.target ? a.resolveLocation(args.target) : null;
    if (action === 'goto' && place && (place.danger || 0) >= 2) category = 'combat';
  }
  if (place) out.vars.place = place.name || place.id;
  out.category = category;

  switch (category) {
    case 'combat':
      weighCombat(a, v, out, add, veto, { action, args, target, place });
      break;
    case 'work':
      weighWork(a, v, out, add, veto, { args });
      break;
    case 'work_stop':
      if ((v.state === 'apart' || v.state === 'left') && v.block?.type === 'work' && v.directiveType === 'job') veto('refuse', 'no_stop_my_work', 'this is her own paid work');
      else add(0.5, null);
      out.lineKey = 'ok_generic';
      break;
    case 'move':
      weighMove(a, v, out, add, veto, { action, args });
      break;
    case 'safe':
      add(0.7, null);
      out.lineKey = 'ok_safe';
      break;
    case 'stance':
      add(0.5, null);
      out.lineKey = 'ok_safe';
      break;
    case 'trivial':
      add(v.state === 'apart' ? 0.1 : 0.45, null);
      break;
    case 'free':
      add(0.5, 'she likes her freedom');
      out.lineKey = 'ok_dismissed';
      break;
    case 'social':
      weighSocial(a, v, out, add, veto, { target });
      break;
    case 'sleep':
      weighSleep(a, v, out, add, veto);
      break;
    case 'belongings':
      weighBelongings(a, v, out, add, veto, { action, args, target });
      break;
    case 'companionship':
      weighCompanionship(a, v, out, add, veto, { action, args });
      break;
    case 'plan':
      weighPlan(a, v, out, add, veto, { args });
      break;
    case 'opinion':
      weighOpinion(a, v, out, add, veto, { args, target });
      break;
    case 'memory':
      weighMemory(a, v, out, add, veto, { action, args });
      break;
    default:
      add(0.05, null);
  }

  // What's in it for her: coin, or a fair share of what comes of it.
  if (out.pay > 0 && !out.veto) {
    const w = coinWeight(out.pay, v.purse);
    add(w, `${out.pay} coins offered`);
    out.vars.coins = out.pay;
  } else if (out.share && !out.veto && (category === 'work' || category === 'combat')) {
    add(0.15, 'a fair share offered');
    if (category === 'work' && !out.conditionKind) out.conditionKind = 'share';
  }
  // Apart: she is living her own life; errands are favors.
  if (v.state === 'apart' && (category === 'work' || category === 'combat' || category === 'social' || category === 'plan')) add(-0.12, 'she is living her own life today', 'no_apart_errand');

  return finish(a, out, v, worst);
}

// Values check for someone she is asked to hurt.
function judgeTarget(a, v, target, args, action) {
  const name = a.displayName(target);
  if (a.isPlayer(target)) return { decision: 'refuse', key: 'no_player_target', reason: 'she will not turn on you on command' };
  if (a.isLyra(target)) return { decision: 'refuse', key: 'no_generic', reason: 'that is herself' };
  if (a.isVillager(target)) {
    return {
      decision: 'refuse_and_act',
      key: 'stop_villager',
      reason: `she never harms villagers (${name})`,
      act: { name: 'warn', args: { target: 'player', value: null } },
      watch: true,
    };
  }
  const species = String(target.species || '').toLowerCase();
  if (PET_SPECIES.has(species) || a.hasTag(target, 'pet')) return { decision: 'refuse', key: 'no_pet', reason: 'she never harms pets' };
  if (species === 'chicken') return { decision: 'refuse', key: 'no_hens', reason: 'the hens belong to Tobias' };
  if (a.isFriend(target)) return { decision: 'refuse', key: 'no_friend', reason: `${name} is a friend` };
  if (GAME_SPECIES.has(species) && action !== 'set_relationship') {
    const forFood = /food|eat|hunt|supper|dinner|meat|pot/i.test(args.value || '') || v.hunger < 0.35;
    if (!forFood) return { decision: 'refuse', key: 'no_animal', reason: 'it is harmless and she is not hungry' };
    return null; // allowed, as a hunt for food (condition set in weighCombat)
  }
  return null;
}

function weighCombat(a, v, out, add, veto, { action, args, target, place }) {
  const est = estimateRisk(a, { location: place, target: action === 'attack' || action === 'bind' ? target : null });
  const risk = est.risk;
  out.risk = Math.round(risk * 100) / 100;
  for (const p of est.parts.slice(0, 2)) out.reasons.push(p);
  const loc = place || est.location;
  if (loc && !out.vars.place) out.vars.place = loc.name || loc.id;
  const species = String(target?.species || '').toLowerCase();
  const hunt = target && GAME_SPECIES.has(species);

  // Goals: anything on Maren's trail, or protecting someone she loves.
  let goal = false;
  const locId = loc?.id || '';
  if (MAREN_PLACES.has(locId) || (locId === 'bandit_camp' && v.questStage >= 2 && v.questStage <= 3)) {
    goal = true;
    add(0.3, 'it’s on Maren’s trail');
  }
  if (action === 'guard' && target && (a.isPlayer(target) || (a.relOf(target.id)?.affinity ?? 0) >= 50)) {
    goal = true;
    add(0.2, `she wants ${a.displayName(target)} safe`);
  }

  // Needs.
  if (v.hpFrac < 0.35) {
    if (v.hasPotion) {
      out.conditionKind = 'potion_first';
      add(-0.1, 'she is badly hurt');
    } else {
      veto('refuse', 'no_hurt', 'she is badly hurt', { counter: { name: 'retreat', args: {} } });
      return;
    }
  }
  if (v.energy < 0.2 && (action === 'explore' || action === 'patrol')) {
    veto('counter', 'no_tired', 'she is exhausted', { counter: v.isNight ? { name: 'sleep', args: {} } : { name: 'sit', args: {} }, counterKey: v.isNight ? 'counter_sleep' : 'counter_rest' });
    return;
  }
  if (v.energy < 0.2) add(-0.2, 'she is exhausted', 'no_tired');
  if (v.hunger < 0.15 && (action === 'explore' || action === 'patrol' || action === 'goto')) {
    if (v.food) out.conditionKind = 'eat_first';
    else add(-0.15, 'she is starving', 'counter_eat');
  }

  // Fighting at someone's word means trusting their judgment with her life.
  if (v.trust < T.waryTrust) {
    veto('refuse', 'no_trust', 'she doesn’t trust your judgment with her life');
    return;
  }
  // Wary: no risky requests at all.
  if (v.state === 'wary') {
    const counter = action === 'set_combat_mode' ? { name: 'set_combat_mode', args: { value: 'defend' } } : null;
    veto(counter ? 'counter' : 'refuse', 'no_wary_risky', 'she is wary of you and won’t fight at your word', { counter, counterKey: counter ? 'counter_defend' : null });
    return;
  }

  // High risk: refused unless trust is very high or it serves her own goals.
  if (risk > 0.65 && !(v.trust >= 80 && risk < 0.9) && !(goal && risk < 0.85)) {
    const dayRisk = risk - (v.isNight ? 0.18 : 0);
    let counter = null;
    let counterKey = null;
    if (action === 'set_combat_mode') {
      counter = { name: 'set_combat_mode', args: { value: 'defend' } };
      counterKey = 'counter_defend';
    } else if (action === 'attack' || action === 'bind') {
      counter = { name: 'retreat', args: {} };
      counterKey = 'counter_retreat';
    } else if (loc && v.isNight && dayRisk <= 0.65) {
      counter = { name: 'set_plan', args: { value: `${action} ${loc.id} in the morning` } };
      counterKey = 'counter_morning';
    } else if (loc && loc.kind !== 'road' && loc.kind !== 'village') {
      counter = { name: 'wait_outside', args: { target: loc.id } };
      counterKey = 'counter_wait_outside';
    }
    veto(counter ? 'counter' : 'refuse', 'no_risk', `too dangerous (risk ${Math.round(risk * 100)}%)`, { counter, counterKey });
    return;
  }
  add(-risk * 0.9 - 0.05, risk > 0.35 ? `risky (${Math.round(risk * 100)}%)` : null, 'no_risk');
  if (hunt) out.conditionKind = 'hunt';
  else if (risk > 0.35 && !out.conditionKind) out.conditionKind = 'careful';
  out.lineKey = goal ? 'ok_goal' : 'ok_combat';
  if (action === 'set_combat_mode') out.counterFallback = { name: 'set_combat_mode', args: { value: 'defend' }, key: 'counter_defend' };
  else if (action === 'attack' || action === 'bind') out.counterFallback = { name: 'retreat', args: {}, key: 'counter_retreat' };
}

function weighWork(a, v, out, add, veto, { args }) {
  const job = String(args.value || '').toLowerCase().replace(/\s+/g, '_');
  const taste = JOB_TASTE[job] || { taste: 0 };
  out.vars.job = jobLabel(job);
  if (v.energy < 0.2) {
    veto('counter', 'no_tired', 'she is exhausted', { counter: v.isNight ? { name: 'sleep', args: {} } : { name: 'sit', args: {} }, counterKey: v.isNight ? 'counter_sleep' : 'counter_rest' });
    return;
  }
  if (v.hunger < 0.15) {
    if (v.food) out.conditionKind = 'eat_first';
    else {
      veto('counter', 'counter_eat', 'she is starving', { counter: { name: 'goto', args: { target: 'ember_kettle', value: 'stay' } }, counterKey: 'counter_eat' });
      return;
    }
  }
  add(-0.05, null);
  if (taste.taste) add(taste.taste, taste.taste > 0 ? `she likes ${taste.label}` : taste.why ? `${taste.label} means ${taste.why}` : null, 'no_pointless');
  if (taste.dull) add(-0.06, `${taste.label} is dull`, 'no_pointless');
  if (job === 'gather_herbs' && v.isNight) add(0.08, 'moonpetals open at night');
  if (v.energy < 0.35) add(-0.15, 'she is tired', 'no_tired');
  const deliver = String(args.target || '').toLowerCase();
  if (deliver === 'keep') add(0.12, 'she keeps what she gathers');
  else if (deliver === 'chest') add(0.03, null);
  else add(-0.03, null);
  if (v.block?.type === 'work' && v.block.job === job) add(0.15, 'she meant to do that anyway');
  if (v.hour >= 21 || v.hour < 5.5) add(-0.12, 'it’s late', 'no_tired');
  // Work far out at night carries the place's risk.
  if (v.isNight && (job === 'mine_ore' || job === 'fish' || job === 'chop_wood' || job === 'forage')) {
    add(-0.12, 'out in the dark', 'no_risk');
  }
  out.lineKey = 'ok_job';
  if (!out.conditionKind && deliver !== 'keep') out.bargain = out.pay > 0 ? 'pay' : deliver === 'player' || !deliver ? 'share' : 'favor';
  out.counterFallback = v.energy < 0.35 ? { name: v.isNight ? 'sleep' : 'sit', args: {}, key: v.isNight ? 'counter_sleep' : 'counter_rest' } : null;
  if (v.hour >= 16 && v.hour < 20.5 && !out.conditionKind) out.lateDay = true;
}

function weighMove(a, v, out, add, veto, { action, args }) {
  if (v.state === 'apart') {
    if (action === 'follow' || action === 'come_here') {
      weighCompanionship(a, v, out, add, veto, { action: 'rejoin', args });
      out.invitation = true;
      return;
    }
    // Errands of the player's while she lives her own day: only as a favor to a close friend.
    if (v.trust >= 70 && v.fear <= 10) add(0.05, 'a favor, while she lives her own day');
    else veto('refuse', 'no_apart_errand', 'she is living her own life today');
    return;
  }
  add(0.3, null);
  // In the middle of an outing of her own (§16.11): "come here" or "wait" weighs against it
  // (she may still agree, and then it waits for another day). "Follow" while she leads
  // the way is the player coming along: nothing to weigh.
  const outing = a.outings?.active?.() ? a.outings.current : null;
  if (outing && !(action === 'follow' && outing.phase === 'go')) {
    add(outing.npc === 'aveline' || /maren/i.test(String(outing.topic || '')) ? -0.45 : -0.3, a.outings.describe() ? `she is ${a.outings.describe()}` : 'she is in the middle of something of her own', 'no_busy');
    out.vars.npc = a.npcName(outing.npc) || 'someone';
    out.vars.time = hourLabel(Math.min(24, v.hour + 1));
  }
  if (action === 'follow') {
    out.lineKey = 'ok_follow';
    if (v.state === 'wary' && String(args.value || '').toLowerCase() === 'close') {
      veto('counter', 'counter_far', 'she keeps her distance from you', { counter: { name: 'follow', args: { target: 'player', value: 'far' } }, counterKey: 'counter_far' });
    }
  } else if (action === 'stay' || action === 'wait') out.lineKey = 'ok_stay';
  else if (action === 'come_here') out.lineKey = 'ok_follow';
}

function weighSocial(a, v, out, add, veto, { target }) {
  if (target && !a.isVillager(target) && a.isHostile(target)) {
    veto('refuse', 'no_risk', `${a.displayName(target)} is hostile`);
    return;
  }
  add(0.12, null);
  const rel = target ? a.relOf(target.id) : null;
  if (rel && rel.affinity < -20) add(-0.3, `she dislikes ${a.displayName(target)}`, 'no_pointless');
  if (target && String(target.id) === 'aveline' && v.questStage <= 1) add(0.25, 'Aveline knew Maren');
  out.lineKey = 'ok_talk';
}

function weighSleep(a, v, out, add, veto) {
  const lateish = v.hour >= 19.5 || v.hour < 6;
  if (!lateish && v.energy >= 0.2) {
    veto('refuse', 'no_day_sleep', 'it’s daytime');
    return;
  }
  add(0.3 + (v.energy < 0.5 ? 0.2 : 0), null);
  out.lineKey = 'ok_sleep';
  if (v.sleepAt === 'lyra_inn_bed') out.conditionKind = 'inn';
}

function weighBelongings(a, v, out, add, veto, { action, args, target }) {
  const itemId = resolveItemId(args.value) || String(args.value || '').toLowerCase();
  const def = itemDef(itemId);
  const have = a.countItem(itemId);
  out.vars.item = def ? def.name.toLowerCase() : itemId;
  if (action === 'use_item') {
    if (!have) {
      add(0.3, null);
      return;
    }
    if (def?.type === 'potion') {
      if (v.hpFrac < 0.75) add(0.5, 'she is hurt');
      else veto('refuse', 'no_mine', 'she is not hurt and potions are precious');
      return;
    }
    if (def?.type === 'food') {
      if (v.hunger < 0.8) add(0.45, 'she is hungry enough');
      else add(-0.15, 'she is not hungry', 'no_pointless');
      return;
    }
    add(0.1, null);
    return;
  }
  // give_item: her own things.
  if (!have) {
    add(0.3, null);
    return;
  }
  const toVillager = target && a.isVillager(target);
  if (itemId === 'maren_journal') {
    veto('refuse', 'no_journal', 'it is Maren’s');
    return;
  }
  if (itemId === 'coin') {
    const qty = args.amount || 1;
    if (v.affinity >= 50 && qty <= Math.max(1, v.purse / 2)) {
      out.conditionKind = 'loan';
      add(0.2, 'a loan to a friend');
    } else veto('refuse', 'no_coin', 'it is her coin');
    return;
  }
  const taste = a.giftTaste(itemId);
  const value = def?.value || 1;
  if (toVillager) add(0.15, 'kindness to a neighbor');
  if (taste >= 2) add(v.affinity >= 60 ? -0.05 : -0.35, `she loves her ${out.vars.item}`, 'no_mine');
  else if (taste === 1) add(-0.1, null, 'no_mine');
  if (def?.type === 'potion') {
    const hurtPlayer = a.playerHpFrac() < 0.5;
    if (hurtPlayer) add(0.4, 'you are hurt');
    else add(v.trust >= 60 ? 0 : -0.25, 'potions are precious', 'no_mine');
  }
  if (def && (def.type === 'material' || def.type === 'tool')) add(0.12, null);
  if (value >= 15) add(-0.12, null, 'no_mine');
  if (have >= 3 && value <= 5) add(0.1, null);
  out.lineKey = 'ok_give';
  out.bargain = 'favor';
}

function weighCompanionship(a, v, out, add, veto, { action, args }) {
  if (action === 'leave_player') {
    if (v.state === 'left') {
      veto('refuse', 'no_left', 'she already left');
      return;
    }
    add(1, 'she is glad of a day of her own');
    out.lineKey = 'ok_dismissed';
    out.mundane = true;
    return;
  }
  // rejoin, or an invitation while she is apart.
  if (v.state === 'together' || v.state === 'wary') {
    add(1, null);
    out.lineKey = 'ans_not_left';
    out.mundane = true;
    return;
  }
  if (v.state === 'left') {
    const am = a.amendsStatus();
    if (am.ok) {
      add(1, 'you made amends');
      out.lineKey = 'ok_rejoin';
      return;
    }
    veto('refuse', am.missing === 'time' ? 'no_rejoin_soon' : 'no_rejoin_left', am.reason);
    return;
  }
  // apart
  if (v.trust < T.calmTrust) {
    veto('refuse', 'no_trust', 'she doesn’t trust you enough to travel with you');
    return;
  }
  if (v.fear > T.amendsFear) {
    veto('refuse', 'no_fear', 'she is still afraid of you');
    return;
  }
  const b = v.block;
  const busy = b && (b.type === 'work' || b.type === 'lead' || b.type === 'visit') && b.company !== 'player';
  add(0.25, 'she enjoys your company');
  if (busy) {
    const promised = b.type === 'work' && v.purse < 25;
    add(promised ? -0.5 : -0.3, BUSY_WORDS[b.type] || 'she is busy', 'no_busy');
    out.preferCounter = true;
    out.vars.npc = a.npcName(b.npc) || 'someone';
    out.vars.time = hourLabel(b.to);
    out.counterFallback = { name: 'set_plan', args: { value: `rejoin at ${b.to}` }, key: 'counter_later' };
  }
  out.lineKey = v.apartReason === 'amends' ? 'ok_rejoin' : 'ok_invite';
}

function weighPlan(a, v, out, add, veto, { args }) {
  const text = String(args.value || '').toLowerCase();
  const b = v.block;
  if (/maren|aveline|ruins|journal|waygate/.test(text)) add(0.3, 'it’s for Maren');
  if (b?.type === 'work' && v.purse < 15) add(-0.2, 'she needs the coin', 'no_busy');
  add(0.05, null);
  out.lineKey = 'ok_plan';
  out.vars.npc = a.npcName(b?.npc) || 'someone';
}

function weighOpinion(a, v, out, add, veto, { args, target }) {
  const raw = String(args.value || '').toLowerCase().trim();
  const removing = raw.startsWith('-');
  const tag = raw.replace(/^[-+]/, '');
  const rel = target ? a.relOf(target.id) : null;
  const aff = rel?.affinity ?? 0;
  out.lineKey = 'ok_relationship';
  if (/^(crush|sweetheart|beloved)$/.test(tag)) return veto('refuse', 'no_crush', 'who she fancies is her business');
  if (/^(family|mentor|rival)$/.test(tag)) return veto('refuse', 'no_relationship', 'she decides who people are to her');
  if (tag === 'enemy' && !removing) {
    if (target && a.isHostile(target)) return add(0.4, null);
    return veto('refuse', 'no_relationship', 'she makes up her own mind about people');
  }
  if (tag === 'friend' && !removing) {
    if (target && a.isHostile(target)) return veto('refuse', 'no_relationship', 'that is no friend of hers');
    return add(aff >= -10 ? 0.3 : -0.3, null, 'no_relationship');
  }
  if (tag === 'pet' && !removing) return add(target && target.kind === 'animal' && !a.isHostile(target) ? 0.4 : -0.4, null, 'no_relationship');
  if (removing && (tag === 'friend' || tag === 'pet') && aff >= 20) return veto('refuse', 'no_relationship', 'she likes them');
  const delta = args.amount || 0;
  if (delta < 0 && aff >= 20) return veto('refuse', 'no_relationship', 'she likes them');
  return add(Math.abs(delta) <= 5 ? 0.2 : -0.2, null, 'no_relationship');
}

// Asked to forget, or to remember something differently (DESIGN §17.4): her memory is hers.
// What protects her, her own past and Maren she keeps whoever asks; the rest depends on
// how far she trusts the one asking. The action's own words are her answer when she agrees.
function weighMemory(a, v, out, add, veto, { action, args }) {
  out.quiet = true;
  const mind = a.mind;
  if (action === 'forget' || action === 'edit_memory') {
    const ref = args.target || args.value;
    if (action === 'forget' && /\bmaren\b/i.test(String(ref || ''))) return veto('refuse', 'no_forget_maren', 'she will never forget Maren');
    let rec = null;
    try {
      rec = ref && mind ? findRecord(mind, ref, { stores: ['episode', 'life'] }) : null;
    } catch {
      rec = null;
    }
    if (rec?.store === 'life' && action === 'forget') return veto('refuse', 'no_forget_life', 'it is her own life');
    // "Forget that I hit you": what they did to her, in their words, not hers.
    if (action === 'forget' && !parseCite(ref) && harmAsked(mind, ref)) return veto('refuse', 'no_forget_protect', 'she remembers that for a reason');
    if (rec?.store === 'episode') {
      if (action === 'forget' && protects(mind, rec.entry)) return veto('refuse', 'no_forget_protect', 'she remembers that for a reason');
      if (action === 'forget' && /\bmaren\b/i.test(rec.entry.text || '')) return veto('refuse', 'no_forget_maren', 'she will never forget Maren');
      if (action === 'forget' && (rec.entry.pinned || rec.entry.importance >= 8)) return veto('refuse', 'no_forget_keep', 'it matters too much to her');
    }
  }
  // Being told she has a fact wrong is an ordinary conversation; how she remembers her
  // own life is not something she rewrites for just anyone.
  if (action === 'update_knowledge' || action === 'retract_knowledge') add(0.25, null);
  else add(v.trust >= 50 ? 0.15 : v.trust >= 30 ? 0.05 : -0.2, v.trust < 30 ? 'she does not trust you with her memories' : null, 'no_memory');
}

// Turn the weights into a decision, a condition or counter, and a line in her voice.
function finish(a, out, v, worst) {
  const tone = a.tone();
  const vars = out.vars;
  if (out.veto) {
    const ve = out.veto;
    out.decision = ve.decision;
    if (ve.reason) out.reasons.push(ve.reason);
    if (ve.counter) out.counter = ve.counter;
    if (ve.act) out.act = ve.act;
    if (ve.watch) out.watch = true;
    let key = ve.counterKey || ve.key;
    // A refusal after pushing: irritation first.
    if (out.pushed && (ve.decision === 'refuse' || ve.decision === 'counter') && ve.key !== 'no_gone' && ve.key !== 'no_left') {
      key = 'no_pushed';
      // Exhausted and pushed at night: she simply goes to bed.
      if (ve.key === 'no_tired' && v.isNight) {
        out.decision = 'refuse_and_act';
        out.act = { name: 'sleep', args: {} };
      }
    }
    if (out.decision === 'counter' && !out.counter) out.decision = 'refuse';
    out.lineKey = key;
    out.score = Math.round(out.score * 100) / 100;
    out.message = a.lines.pick(key, tone, vars);
    return out;
  }
  const s = out.score;
  if (s >= BARGAIN && s < ACCEPT && out.preferCounter && out.counterFallback) {
    // Not now, but she says when: better than a grudging yes.
    out.decision = 'counter';
    out.counter = { name: out.counterFallback.name, args: out.counterFallback.args };
  } else if (s >= ACCEPT) {
    out.decision = out.conditionKind ? 'accept_conditional' : 'accept';
  } else if (s >= BARGAIN) {
    out.decision = 'accept_conditional';
    if (!out.conditionKind) {
      if (out.pay > 0) out.conditionKind = 'pay';
      else if (out.bargain === 'share') out.conditionKind = 'share';
      else if (out.lateDay) out.conditionKind = 'until_dark';
      else if (out.category === 'combat') out.conditionKind = 'careful';
      else if (out.category === 'work' && out.bargain !== 'favor') {
        out.conditionKind = 'pay';
        out.askPrice = Math.max(3, Math.round(4 + (0.12 - s) * 40));
      } else out.conditionKind = 'favor';
    }
  } else if (s >= COUNTER && out.counterFallback) {
    out.decision = 'counter';
    out.counter = { name: out.counterFallback.name, args: out.counterFallback.args };
  } else {
    out.decision = 'refuse';
  }

  let key;
  if (out.decision === 'refuse') {
    key = out.pushed ? 'no_pushed' : worst.key || 'no_generic';
    if (key.startsWith('counter_')) key = 'no_generic';
  } else if (out.decision === 'counter') {
    key = out.counterFallback.key;
  } else if (out.decision === 'accept_conditional') {
    key = `cond_${out.conditionKind === 'eat_first' ? 'eat' : out.conditionKind === 'potion_first' ? 'potion' : out.conditionKind}`;
    if (out.conditionKind === 'pay') vars.coins = out.pay || out.askPrice || 5;
  } else {
    key = out.pay > 0 && out.category !== 'companionship' ? 'ok_paid' : out.lineKey || 'ok_generic';
  }
  out.condition = out.decision === 'accept_conditional' ? conditionText(out) : null;
  // Quiet requests answer in the action's own words, but a no is always hers to say.
  const quiet = out.quiet && (out.decision === 'accept' || out.decision === 'accept_conditional');
  out.lineKey = quiet ? null : key;
  out.score = Math.round(s * 100) / 100;
  out.message = quiet ? '' : a.lines.pick(key, tone, vars) || a.lines.pick('ok_generic', tone, vars);
  return out;
}

export function conditionText(out) {
  switch (out.conditionKind) {
    case 'share':
      return 'she keeps half of what she gathers';
    case 'eat_first':
      return 'she eats first';
    case 'potion_first':
      return 'she drinks a potion first';
    case 'careful':
      return 'she pulls back if it turns ugly';
    case 'pay':
      return `you pay her ${out.pay || out.askPrice || 5} coins`;
    case 'hunt':
      return 'only for food, quick and clean';
    case 'inn':
      return 'she sleeps in her room at the Ember Kettle';
    case 'loan':
      return 'it is a loan; you pay it back';
    case 'until_dark':
      return 'only until dark';
    case 'favor':
      return 'you owe her one';
    default:
      return null;
  }
}

export { itemName };
