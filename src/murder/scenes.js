// Short scenes for a death (DESIGN §20's engine, §29): the funeral in the chapel and the
// Moot sitting in judgment. Built at the moment from who is alive and what is known, and
// played through game.story like any other scene (they are not part of the fixed story,
// so they are added to the script table only while they play).

import { SCRIPTS } from '../story/scripts.js';
import { murderLine, mootLines, lyraLine, FUNERAL } from './lines.js';
import { fillLine } from '../ai/village_life/voice.js';
import { HEIRS } from './data.js';

function keyed(id, steps) {
  let n = 0;
  for (const st of steps) if (st.narrate != null || st.say != null) st.key = `${id}.${String(n++).padStart(2, '0')}`;
  return steps;
}

export function playScript(m, id, script) {
  const story = m.game?.story;
  if (!story?.play || !script?.steps?.length) return Promise.resolve({ skipped: true });
  const title = script.title || id;
  SCRIPTS[id] = { id, title, steps: keyed(id, script.steps) };
  let p;
  try {
    p = Promise.resolve(story.play(id, { record: false }));
  } catch {
    p = Promise.resolve({ skipped: true });
  }
  return p.then(
    (r) => {
      delete SCRIPTS[id];
      return r;
    },
    () => {
      delete SCRIPTS[id];
      return { skipped: true };
    },
  );
}

function companionNear(m) {
  const L = m.game?.companion;
  const P = m.game?.player;
  return !!L && !!P && !L.downed && Math.hypot(L.x - P.x, L.y - P.y) < 140 && !['left', 'gone'].includes(L.mind?.companionship);
}

export function funeralScript(m, rec, officiant, mourners) {
  const V = m.name(rec.id);
  const steps = [];
  steps.push({ camera: { to: rec.id, dy: -10, ms: 1200 } });
  steps.push({ narrate: fillLine(FUNERAL.narrate[0], 'narrator', { about: rec.id }) });
  if (officiant) steps.push({ say: officiant, text: murderLine(officiant, 'funeralWord', { about: rec.id }, m.rng()) || `Rest now, ${V}.` });
  const spoken = new Set([officiant]);
  // Family first, then those who loved them most: a word each, at most three.
  const order = [...mourners].sort((a, b) => (m.life?.care?.(b, rec.id) ?? 0) - (m.life?.care?.(a, rec.id) ?? 0));
  for (const id of order) {
    if (spoken.has(id) || spoken.size >= 4) continue;
    const line = murderLine(id, 'funeralWord', { about: rec.id }, m.rng());
    if (!line) continue;
    spoken.add(id);
    steps.push({ say: id, text: line });
  }
  if (companionNear(m)) steps.push({ say: 'lyra', text: lyraLine('funeral', { about: rec.id }, m.rng()) || `${V} should be here.`, mood: 'sad' });
  const heir = HEIRS[rec.id];
  if (heir && m.entity(heir.by) && !m.dead[heir.by]) {
    const l = murderLine(heir.by, 'heir', { about: rec.id }, m.rng());
    if (l) steps.push({ say: heir.by, text: l });
  }
  steps.push({ sound: 'bell' });
  steps.push({ narrate: fillLine(FUNERAL.narrate[1], 'narrator', { about: rec.id }) });
  return { title: `The funeral of ${m.entity(rec.id)?.name || V}`, steps };
}

// The Moot sits: the opening and the watch's account; then (after the plea) the verdict.
export function trialScripts(m, about, chair) {
  const c = m.cases[about];
  const lead = c?.lead && !m.dead[c.lead] ? c.lead : null;
  const open = [];
  open.push({ camera: { to: 'player', dy: -14, ms: 900 } });
  const line = (text) => (chair ? { say: chair, text } : { narrate: text });
  for (const l of mootLines(chair, 'open', { about })) open.push(line(l));
  const said = (c?.evidence || [])
    .filter((e) => e.text)
    .sort((a, b) => b.w - a.w)
    .slice(0, 4);
  if (lead) {
    open.push({ say: lead, text: said.length ? 'This is what the watch knows.' : 'The watch knows very little. That is the truth.' });
    for (const e of said) open.push({ say: lead, text: e.text });
  } else for (const e of said) open.push({ narrate: e.text });
  const L = m.game?.companion;
  if (L && m.lyra?.[about]) open.push({ say: 'lyra', text: lyraLine('trial', { about }, m.rng()) });
  if (chair) open.push({ say: chair, text: 'What do you say?' });
  const verdictFor = (v) => {
    const steps = [];
    if (v.plea === 'confess') steps.push({ narrate: 'Nobody in the room says anything for a long time.' });
    // Round 14b (S-11): each juror says how they weighed it, then the chair gives the verdict.
    for (const vote of (v.votes || []).slice(0, 7)) {
      if (!vote?.reason || m.dead?.[vote.id]) continue;
      const word = vote.vote === 'guilty' ? 'Guilty.' : vote.vote === 'mercy' ? 'Guilty. And I ask mercy.' : 'Not proven.';
      steps.push({ say: vote.id, text: `${vote.reason} ${word}` });
    }
    if (v.tally) steps.push({ narrate: `${v.tally.guilty} for guilty, ${v.tally.mercy} for mercy, ${v.tally.notProven} not proven.` });
    for (const l of mootLines(chair, v.guilty ? 'guilty' : 'notProven', { about })) steps.push(line(l));
    if (v.guilty && v.mercy) steps.push(line('The Moot asks mercy for you. One day outside, not three. Your flame stays lit.'));
    else if (v.guilty) for (const l of mootLines(chair, 'outside', { about })) steps.push({ narrate: l });
    return { title: 'The Moot', steps };
  };
  return { open: { title: 'The Moot sits', steps: open }, verdictFor };
}
