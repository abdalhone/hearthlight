// A small stand-in for game.magic (DESIGN.md §22.2) so the controls, the hotbar and the
// Spellbook can be tested before (or without) the real runtime. It follows the contract
// the r4/core runtime implements: slots, unlocked Sets, mana, compile(weave) -> plan
// (ok, name, description, cost, cooldown, dmg, range, count, input, aim, palette),
// cast / castStart / castHold / castRelease, setSlot, unlock, canCast, and it records
// every call so a test can check what the controls asked for. Works in node and in a page.

const PALS = {
  raw: { core: '#cdbcff', glow: '#8a6cff', spark: '#f3eeff', deep: '#3d2a8a' },
  fire: { core: '#ffd36b', glow: '#ff7a2f', spark: '#fff3c4', deep: '#a3261b' },
  water: { core: '#a6e6ff', glow: '#3a9be0', spark: '#ecfbff', deep: '#1d4f9a' },
  frost: { core: '#eafcff', glow: '#8fd8ff', spark: '#ffffff', deep: '#3f7fb8' },
  storm: { core: '#fff59a', glow: '#7fd6ff', spark: '#ffffff', deep: '#3b4fa8' },
  nature: { core: '#c2f283', glow: '#55c25a', spark: '#efffd6', deep: '#1f6b34' },
  dark: { core: '#a88ae0', glow: '#5a3790', spark: '#e0d2ff', deep: '#1a0f30' },
  light: { core: '#fffbe2', glow: '#ffe27a', spark: '#ffffff', deep: '#c98a2a' },
};

const SHAPES = {
  bolt: { cost: 6, cooldown: 0.45, dmg: 9, range: 150, input: 'tap', aim: (r) => ({ type: 'line', range: r, width: 6 }) },
  blast: { cost: 10, cooldown: 1.2, dmg: 12, range: 56, input: 'tap', aim: (r) => ({ type: 'cone', range: r, angle: 1.1 }) },
  strike: { cost: 5, cooldown: 0.7, dmg: 14, range: 28, input: 'tap', aim: (r) => ({ type: 'arc', range: r, angle: 1.6, radius: 14 }) },
  throw: { cost: 9, cooldown: 1.0, dmg: 13, range: 120, input: 'tap', aim: (r) => ({ type: 'circle', range: r, radius: 22 }) },
  beam: { cost: 12, cooldown: 0.8, dmg: 4, range: 130, input: 'hold', aim: (r) => ({ type: 'line', range: r, width: 8 }) },
  nova: { cost: 14, cooldown: 2.5, dmg: 15, range: 0, input: 'tap', aim: () => ({ type: 'ring', range: 0, radius: 46 }) },
  orb: { cost: 12, cooldown: 1.6, dmg: 7, range: 140, input: 'tap', aim: (r) => ({ type: 'line', range: r, width: 16 }) },
  summon: { cost: 18, cooldown: 6, dmg: 6, range: 30, input: 'tap', aim: () => ({ type: 'point', range: 30, radius: 8 }) },
  rune: { cost: 10, cooldown: 2, dmg: 18, range: 90, input: 'tap', aim: (r) => ({ type: 'circle', range: r, radius: 18 }) },
  rain: { cost: 16, cooldown: 3, dmg: 5, range: 130, input: 'tap', aim: (r) => ({ type: 'circle', range: r, radius: 34 }) },
  wall: { cost: 14, cooldown: 4, dmg: 0, range: 50, input: 'tap', aim: (r) => ({ type: 'line', range: r, width: 8, length: 64, across: true }) },
  dash: { cost: 8, cooldown: 1.5, dmg: 6, range: 70, input: 'tap', aim: (r) => ({ type: 'line', range: r, width: 10 }) },
};

function mix(a, b) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a);
  const y = p(b);
  return `#${x.map((v, i) => Math.round((v + y[i]) / 2).toString(16).padStart(2, '0')).join('')}`;
}

export function makeMagicStub(game = null, opts = {}) {
  const unlocked = {
    shapes: new Set(opts.shapes || ['bolt', 'blast', 'throw', 'beam', 'nova', 'strike']),
    essences: new Set(opts.essences || ['raw', 'fire', 'frost', 'storm']),
    twists: new Set(opts.twists || ['multishot', 'split', 'charge', 'homing']),
  };
  const calls = [];
  const m = {
    calls,
    unlocked,
    slots: opts.slots || [
      { shape: 'bolt', essences: ['fire'], twists: ['multishot'] },
      { shape: 'throw', essences: ['frost'], twists: [] },
      { shape: 'beam', essences: ['storm'], twists: [] },
      { shape: 'nova', essences: [], twists: [] },
      null,
      null,
    ],
    slotCount: opts.slotCount ?? 4,
    essenceSlots: 2,
    twistSlots: 2,
    mana: { cur: opts.mana ?? 40, max: 40 },
    cooldowns: [0, 0, 0, 0, 0, 0],
    holding: null,
    compile(w) {
      if (!w || !w.shape) return { ok: false, reason: 'Pick a shape for this weave.' };
      const s = SHAPES[w.shape];
      if (!s) return { ok: false, reason: `There is no shape called "${w.shape}".` };
      const ess = (w.essences && w.essences.length ? w.essences : ['raw']).filter(Boolean);
      for (const e of ess) if (!unlocked.essences.has(e)) return { ok: false, reason: `You haven't learned to weave ${e} yet.` };
      for (const t of w.twists || []) if (!unlocked.twists.has(t)) return { ok: false, reason: `You haven't learned the ${t} twist yet.` };
      const pals = ess.map((e) => PALS[e] || PALS.raw);
      const palette = pals.length > 1 ? { core: mix(pals[0].core, pals[1].core), glow: mix(pals[0].glow, pals[1].glow), spark: pals[0].spark, deep: mix(pals[0].deep, pals[1].deep) } : pals[0];
      const multi = (w.twists || []).includes('multishot');
      const charge = (w.twists || []).includes('charge');
      const count = multi ? 3 : 1;
      const tw = (w.twists || []).length;
      const name = w.name || `${multi ? 'Triple ' : ''}${ess[0] === 'raw' ? '' : ess[0][0].toUpperCase() + ess[0].slice(1) + ' '}${w.shape[0].toUpperCase()}${w.shape.slice(1)}`;
      return {
        ok: true,
        name,
        description: `Casts ${count === 1 ? 'a' : count} ${w.shape} of ${ess.join(' and ')}.`,
        shape: w.shape,
        essences: ess,
        twists: w.twists || [],
        cost: s.cost * (1 + 0.25 * tw) * (ess.length > 1 ? 1.3 : 1),
        cooldown: s.cooldown * (1 + 0.15 * tw),
        dmg: s.dmg * (ess.length > 1 ? 1.2 : 1),
        range: s.range,
        radius: 3,
        speed: 170,
        count,
        input: charge ? 'charge' : s.input,
        held: s.input === 'hold',
        drain: s.input === 'hold' ? s.cost : 0,
        aim: s.aim(s.range),
        palette,
        palettes: pals,
      };
    },
    canCast(i) {
      const p = m.compile(m.slots[i]);
      if (!p.ok) return { ok: false, reason: 'invalid' };
      if (m.cooldowns[i] > 0) return { ok: false, reason: 'cooldown' };
      if (m.mana.cur < p.cost) return { ok: false, reason: 'mana' };
      return { ok: true };
    },
    cooldownLeft(i) {
      return m.cooldowns[i] || 0;
    },
    spend(i) {
      const p = m.compile(m.slots[i]);
      m.mana.cur -= p.cost;
      m.cooldowns[i] = p.cooldown;
      game?.bus?.emit?.('mana_changed', { cur: m.mana.cur, max: m.mana.max });
      game?.bus?.emit?.('spell_cast', { caster: game?.player, weave: m.slots[i], plan: p, slot: i });
      return p;
    },
    cast(caster, slot, aim) {
      calls.push({ fn: 'cast', slot, aim: aim ? { x: aim.x, y: aim.y, target: aim.target || null } : null });
      const c = m.canCast(slot);
      if (!c.ok) return { ok: false, reason: c.reason };
      return { ok: true, plan: m.spend(slot) };
    },
    castStart(caster, slot, aim) {
      calls.push({ fn: 'castStart', slot, aim: aim ? { x: aim.x, y: aim.y } : null });
      const c = m.canCast(slot);
      if (!c.ok) return { ok: false, reason: c.reason };
      m.holding = { slot, t: 0 };
      return { ok: true, plan: m.spend(slot) };
    },
    castHold(caster, slot, aim, dt) {
      calls.push({ fn: 'castHold', slot, aim: aim ? { x: aim.x, y: aim.y } : null });
      if (m.holding) m.holding.t += dt || 0;
      return { ok: true };
    },
    castRelease(caster, slot, aim, o) {
      calls.push({ fn: 'castRelease', slot, aim: aim ? { x: aim.x, y: aim.y } : null, cancel: !!o?.cancel });
      m.holding = null;
      return { ok: true };
    },
    castCancel(caster, slot) {
      calls.push({ fn: 'castCancel', slot });
      m.holding = null;
      return { ok: true };
    },
    setSlot(i, w) {
      calls.push({ fn: 'setSlot', slot: i, weave: w });
      m.slots[i] = w ? { ...w, essences: [...(w.essences || [])], twists: [...(w.twists || [])] } : null;
      return { ok: true };
    },
    unlock(kind, id, source) {
      const k = kind.endsWith('s') ? kind : `${kind}s`;
      unlocked[k]?.add(id);
      game?.bus?.emit?.('magic_unlocked', { kind, id, source });
    },
    update(dt) {
      m.mana.cur = Math.min(m.mana.max, m.mana.cur + dt * 4);
      for (let i = 0; i < m.cooldowns.length; i++) m.cooldowns[i] = Math.max(0, m.cooldowns[i] - dt);
    },
  };
  return m;
}
