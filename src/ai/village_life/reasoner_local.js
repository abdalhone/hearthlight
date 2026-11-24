// The villagers' own reasoning when Claude is not thinking for them (DESIGN §28): the same
// actions, decided by rules over the same knowledge (problems.js buildInput). It reasons the
// way people do: look where they should be, ask whoever is right there, try their home,
// follow any word of where they went, ask the people most likely to know, and when it
// stops making sense, tell the watch, search, or give up for today. Who they are matters:
// family and friends do not give up; a customer after wick asks twice and goes home.
//
// decideLocal(input, { rng, say(key, vars), think(key, vars) }) ->
//   { thought, say, action: { type, target }, belief, source: 'local' }

const pickBest = (list) => (list && list.length ? list[0] : null);

export function decideLocal(I, { rng = Math.random, say = () => '', think = () => '' } = {}) {
  const r = typeof rng === 'function' ? rng : Math.random;
  const checked = new Set(I.checked || []);
  const asked = new Set(I.asked || []);
  const care = I.care ?? 0.5;
  const out = (type, target, thoughtKey, sayKey, vars = {}, belief = null) => ({
    action: { type, target: target ?? null },
    thought: thoughtKey ? think(thoughtKey, vars) || '' : '',
    say: sayKey ? say(sayKey, vars) || '' : '',
    belief,
    source: 'local',
  });
  const placeVars = (p) => ({ place: p.name, placeId: p.id });

  // Goods gone or the way blocked: not about a person.
  if (I.kind === 'item') return out('give_up', null, 'item', 'giveUp', {});
  if (I.kind === 'blocked') {
    if (I.steps === 0) return out('wait', null, 'blocked', null, { place: I.hereName });
    return out('give_up', null, 'blocked', 'giveUp', { place: I.hereName });
  }

  // First moment: say what is wrong, and if they may only have stepped out, wait a little.
  if (I.steps === 0 && (I.expectedBackSoon || I.busyElsewhere) && I.kind !== 'worried') {
    return out('wait', null, 'wait', I.kind === 'shut' ? 'shut' : 'absent', {});
  }

  // They are busy with something bigger (out with the search): it can wait.
  const lastHeard = (I.heard || [])[(I.heard || []).length - 1];
  if (lastHeard?.kind === 'busy' && I.kind !== 'worried') return out('give_up', null, 'busy', 'giveUp', {});

  // The watch is out looking, and they know it: someone who only needed them for an errand
  // leaves it to the watch.
  if (I.knowsSearch && !I.isWatch && care < 0.6 && I.kind !== 'worried') return out('give_up', null, 'watchHasIt', 'giveUp', {});

  // Word of where they went that has not been followed yet: go there.
  // (A place already looked at counts again if they were seen there since.)
  const checkedAt = I.checkedAt || {};
  const fresh = (id, h) => !!id && (!checked.has(id) || (Number.isFinite(h.t) && h.t > (checkedAt[id] ?? Infinity)));
  const told = (I.heard || [])
    .slice()
    .reverse()
    .find((h) => (h.kind === 'seen' || h.kind === 'heard' || h.kind === 'guess') && (fresh(h.heading, h) || fresh(h.place, h)) && (h.heading || h.place) !== I.here);
  if (told) {
    const id = fresh(told.heading, told) ? told.heading : told.place;
    const p = (I.places || []).find((x) => x.id === id) || { id, name: told.placeName || told.headingName || 'there' };
    return out(I.child && I.night ? 'alarm' : 'go', id, 'goTold', null, { from: told.fromName || 'Someone', ...placeVars(p) }, `Maybe ${p.name}: ${told.fromName || 'someone'} saw ${I.aboutName} there.`);
  }

  // Where they always are at this hour, if that is not here.
  const habit = I.habitNow && I.habitNow.id !== I.here && !checked.has(I.habitNow.id) ? I.habitNow : null;
  if (habit && I.steps <= 2) return out('go', habit.id, 'goHabit', I.steps === 0 ? (I.kind === 'shut' ? 'shut' : 'absent') : null, { place: habit.name, placeId: habit.id }, `Probably ${habit.name}, at this hour.`);

  // Somebody right here might have seen them.
  const near = (I.askable || []).find((a) => a.near && a.id !== 'player' && !asked.has(a.id));
  if (near && I.steps <= 4) return out('ask', near.id, 'askNear', I.steps === 0 ? (I.kind === 'shut' ? 'shut' : 'absent') : null, { a: near.name });

  // Their own house, for those who care enough to knock.
  if (I.home && !checked.has(I.home.id) && I.home.id !== I.here && (care >= 0.45 || I.kind === 'worried')) {
    return out('go', I.home.id, 'goHome', null, { place: I.home.name, placeId: I.home.id }, `At home, perhaps.`);
  }

  // Where they themselves last saw them, if that was not long ago.
  if (I.ownSeen?.place && !checked.has(I.ownSeen.place) && care >= 0.6 && I.ownSeen.place !== I.here && I.ownSeenAgo <= 2) {
    return out('go', I.ownSeen.place, 'goPlace', null, { place: I.ownSeen.placeName, placeId: I.ownSeen.place });
  }

  // Back to where they should have been: they may be there by now.
  if (I.origin && I.origin !== I.here && I.originAgo >= 0.6 && I.kind !== 'worried' && I.steps >= 2 && (I.backs ?? 0) < 2 && !I.caseSearching) {
    return out('go', I.origin, 'goBack', null, { place: I.originName, placeId: I.origin });
  }

  // Too dark to look: first light, then (the watch keeps on with lanterns).
  if (I.night && !I.isWatch && !(I.options || []).includes('search') && asked.size >= 1) return out('give_up', null, 'night', 'giveUp', {});

  // The watch is already searching: those who love them join in; others leave it to the watch.
  if (I.caseSearching && !I.isWatch) {
    // Each does their share: a couple of places, more for family.
    const share = care >= 0.85 ? 4 : 2;
    if (care >= 0.6 && (I.options || []).includes('search') && (I.searches ?? 0) < share) {
      const p = (I.places || []).find((x) => !x.checked && !x.origin && !x.public);
      if (p) return out('search', p.id, I.joined ? 'search' : 'joined', null, placeVars(p));
    }
    if ((I.searches ?? 0) >= share) return out('give_up', null, 'leaveToWatch', 'giveUp', {});
    if (asked.size >= 1 || I.steps >= 3) return out('give_up', null, 'giveUp', 'giveUp', {});
  }

  // Seen not an hour ago: they are about somewhere, only not here. No matter for the watch;
  // the errand can wait until they turn up.
  const recent = I.lastKnownAgo != null && I.lastKnownAgo < 1.2 && !(I.child && I.night) && !I.caseSearching;
  if (recent && (asked.size >= 1 || I.steps >= 2)) {
    const lk = I.lastKnown || {};
    return out('give_up', null, lk.fromName ? 'about' : 'aboutOwn', 'later', { from: lk.fromName || '', when: lk.when || 'just now' }, `About the village somewhere: seen ${lk.when || 'just now'}.`);
  }

  // How long since anyone they know of saw them: an hour or two is a busy day, not a worry.
  const goneH = I.lastKnownAgo ?? I.elapsedH + 2;
  const longGone = goneH >= 3 || (I.night && goneH >= 1.5);

  // The watch itself: once it is clearly more than a stepped-out hour, it searches.
  if (I.isWatch && !I.caseSearching && I.elapsedH >= 1 && longGone && (asked.size >= 2 || I.caseStatus === 'asking')) {
    return out('alarm', null, 'alarmWatch', null, { when: I.ownSeen?.since || 'this morning' });
  }

  // Enough asking: it is time someone told the watch.
  const worried = care >= 0.6 || I.kind === 'worried';
  const family = care >= 0.95;
  if (!I.watchKnows && !I.isWatch && ((family && asked.size >= 1 && I.elapsedH >= 1 && goneH >= 2) || (longGone && ((asked.size >= 2 && worried && I.elapsedH >= 1.5) || (asked.size >= 3 && I.elapsedH >= 2.5) || (I.elapsedH >= 4 && asked.size >= 1))))) {
    return out('alarm', null, 'alarm', null, { when: I.ownSeen?.since || 'this morning' });
  }

  // Lyra sees more than most, and she is right here.
  if ((I.options || []).includes('tell_lyra') && I.lyraNear && !I.lyraAsked && r() < 0.7) return out('tell_lyra', 'lyra', 'tellLyra', null, {});

  // Ask the people most likely to know.
  const limit = I.knowsSearch ? 2 : worried ? 5 : 3;
  const candidates = (I.askable || []).filter((a) => !asked.has(a.id));
  const askPlayer = candidates.find((a) => a.id === 'player');
  if (askPlayer && asked.size >= 1 && r() < 0.6) return out('ask', 'player', 'askAny', null, { a: askPlayer.name });
  const best = pickBest(candidates.filter((a) => a.id !== 'player'));
  if (best && asked.size < limit) {
    const key = /family|lives with/.test(best.why) ? 'askKin' : /works with/.test(best.why) ? 'askWork' : /watch/.test(best.why) ? 'askWatch' : 'askAny';
    return out('ask', best.id, key, null, { a: best.name });
  }

  // Go and look properly, if they matter to you.
  if (worried && (I.options || []).includes('search') && (I.searches ?? 0) < (care >= 0.85 ? 4 : 2)) {
    const p = (I.places || []).find((x) => !x.checked && !x.origin && !x.public);
    if (p) return out('search', p.id, 'search', null, placeVars(p));
  }
  if (!I.watchKnows && longGone && (worried || I.elapsedH >= 3)) return out('alarm', null, I.isWatch ? 'alarmWatch' : 'alarm', null, { when: I.ownSeen?.since || 'this morning' });

  return out('give_up', null, 'giveUp', 'giveUp', {});
}
