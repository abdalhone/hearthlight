import { makeBlock, dayRand } from './autonomy_agenda.js';

// Her open agenda (DESIGN §16.12; the author: "not only those 5 criteria"). Her day is
// planned from a handful of factors (autonomy_agenda.buildPlan); her choices in the
// moment draw on everything she has going on:
//
//   want        what she wants today (her needs, her goals, the weather, a small joy)
//   unfinished  unfinished business (a talk she never got to have, a lead left hanging)
//   person      people she cares about (not seen today, grieving, her mother and father)
//   said        what she said she'd do (her own promises, and the "I'll…" she said today)
//   company     the player's company, when she wants it
//   plan        her plan for today, as it stands
//
// openAgenda(view) lists them, weighed; chooseNext(view) picks one for the next hour or
// so. With Claude in a chat, the list goes into the prompt with ids (a1, a2…), and Claude
// may choose by naming one in set_plan ("a2"); offline, chooseNext decides. Either way the
// result is an ordinary plan block, which her body (own_life) already knows how to live.
//
// view = { day, hour, state, trust, fear, affinity, energy, hunger, fun, purse, valence,
//          neuroticism, extraversion, agreeableness, weather, isNight, questStage,
//          wantsCompany, unfinished: [item], said: [{ text, at?, npc? }], people:
//          [{ id, name, affinity, at, seenToday, family, grieving }], plan: block|null,
//          after: outing|null }

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const num = (v, d) => (Number.isFinite(v) ? v : d);

export function openAgenda(v = {}) {
  const out = [];
  const h = num(v.hour, 12);
  const end = (n) => Math.min(24, h + n);
  const add = (kind, text, weight, block, why) => out.push({ kind, text, weight: Math.round(weight * 100) / 100, block, why: why || text });
  const after = v.after || null;
  const heard = after && after.result === 'talked';

  // The player's company: only while she wants it (trust, fear, the worth of it).
  if (v.wantsCompany && (v.state === 'together' || v.state === 'wary' || v.state === 'apart')) {
    const w = 0.28 + num(v.affinity, 20) / 220 + (num(v.trust, 40) >= 60 ? 0.08 : 0) + (heard && num(v.agreeableness, 0.7) > 0.6 ? 0.04 : 0);
    add('company', 'stay with you a while', w, makeBlock(h, end(2), 'travel', null, 'I want your company. That’s all.', { company: 'player' }));
  }

  // Just heard something hard (the Maren talk): a while alone with it, then her people.
  if (heard) {
    const grave = /maren/i.test(String(after.topic || '')) || after.npc === 'aveline';
    if (grave) {
      const w = 0.3 + num(v.neuroticism, 0.4) * 0.35 + (num(v.valence, 0) < 0 ? 0.12 : 0) + (num(v.extraversion, 0.6) < 0.5 ? 0.08 : 0);
      add('want', 'sit with what I just heard', w, makeBlock(h, end(1), 'rest', after.at || 'chapel', 'I need a while with what I just heard. On my own.', { company: 'alone', activity: 'sit quietly with the news', doing: 'sitting quietly with the news' }));
    }
  }

  // Needs first, the way a body asks.
  if (num(v.hunger, 0.7) < 0.35) add('want', 'eat something', 0.3 + (0.35 - num(v.hunger, 0.7)) * 1.6, makeBlock(h, end(1), 'eat', 'ember_kettle', 'I’m starving. Supper, or anything.', { company: 'invite' }));
  if (num(v.energy, 0.8) < 0.3) add('want', 'rest', 0.3 + (0.3 - num(v.energy, 0.8)) * 1.6, makeBlock(h, end(1), 'rest', 'ember_kettle', 'I’m worn through. An hour by the fire.', { company: 'invite' }));
  if (num(v.purse, 20) < 10 && !v.isNight) add('want', 'earn a few coins', 0.3, null, 'My purse is light.');
  if (num(v.fun, 0.6) < 0.35) {
    if (v.isNight && v.weather !== 'rain') add('want', 'watch the stars', 0.3, makeBlock(h, end(1.5), 'stars', 'south_meadow', 'A sky like this wants watching.', { company: 'invite' }));
    else if (v.weather === 'rain') add('want', 'sit by the fire at the Kettle', 0.3, makeBlock(h, end(1.5), 'hearth', 'ember_kettle', 'Rain on the roof and a fire. Perfect.', { company: 'invite' }));
    else add('want', 'a honey cake at the Kettle', 0.26, makeBlock(h, end(1), 'eat', 'ember_kettle', 'I want a honey cake. I’ve earned one.', { company: 'invite', activity: 'a honey cake at the Kettle' }));
  }

  // Unfinished business: older is heavier, until it is a week stale.
  for (const u of v.unfinished || []) {
    const age = Math.max(0, num(v.day, 1) - num(u.since, v.day));
    if (age > 7) continue;
    const blk = u.npc ? makeBlock(h, end(2), u.npc === 'aveline' || /maren/i.test(String(u.topic || '')) ? 'lead' : 'visit', u.at || null, u.why || `I still have to ${u.text}.`, { npc: u.npc, company: 'invite' }) : u.at ? makeBlock(h, end(1.5), 'free', u.at, u.why || `I still mean to ${u.text}.`, { company: 'invite' }) : null;
    add('unfinished', u.text, 0.32 + Math.min(0.15, age * 0.05) + (/maren/i.test(String(u.topic || u.text)) ? 0.1 : 0), blk, `I still have to ${u.text}.`);
  }

  // What she said she'd do (her own promises; "I'll…" said today).
  for (const s of v.said || []) {
    const blk = s.npc ? makeBlock(h, end(1.5), 'visit', s.at || null, `I said I would. ${cap(s.text)}.`, { npc: s.npc, company: 'invite' }) : s.at ? makeBlock(h, end(1.5), 'free', s.at, `I said I would. ${cap(s.text)}.`, { company: 'invite' }) : null;
    add('said', s.text, 0.34, blk, `I said I'd ${s.text}.`);
  }

  // People she cares about: her mother and father most, the grieving, the unseen today.
  for (const p of v.people || []) {
    if (!p || num(p.affinity, 0) < 35) continue;
    let w = 0.1 + num(p.affinity, 0) / 300;
    if (p.family) w += 0.08;
    if (p.grieving) w += 0.2;
    if (!p.seenToday) w += 0.06;
    if (heard && p.family) w += 0.12; // news like that, she takes home
    if (v.isNight && !p.family) w -= 0.1;
    const why = p.grieving ? `${p.name} is grieving. I want to sit with them.` : heard && p.family ? `${p.name} should hear it from me.` : `I want to see ${p.name}.`;
    add('person', `see ${p.name}`, w, makeBlock(h, end(1.5), 'visit', p.at || 'town_square', why, { npc: p.id, npcName: p.name, company: 'invite' }), why);
  }

  // Her plan as it stands.
  if (v.plan) add('plan', 'what I planned', 0.24, v.plan, v.plan.why);

  // A day's small randomness: two days never weigh exactly alike.
  out.forEach((it, i) => {
    it.weight = Math.round((it.weight + (dayRand(num(v.day, 1), 13 + i * 7 + it.text.length) - 0.5) * 0.06) * 100) / 100;
  });
  out.sort((a, b) => b.weight - a.weight);
  out.forEach((it, i) => {
    it.id = `a${i + 1}`;
  });
  return out;
}

// The best thing to do next. `exclude`: kinds she won't choose now.
export function chooseNext(v = {}, { exclude = [] } = {}) {
  const items = openAgenda(v).filter((it) => !exclude.includes(it.kind) && (it.block || it.kind === 'want'));
  return items[0] || null;
}

// One line per item for Claude, under `max` characters.
export function agendaText(items, max = 420) {
  let out = '';
  for (const it of items.slice(0, 6)) {
    const s = `${it.id}: ${it.text} (${it.kind}, ${it.weight})`;
    if (out.length + s.length + 2 > max) break;
    out += (out ? '; ' : '') + s;
  }
  return out;
}
