// Weaving controls (DESIGN.md §22.4) without a browser: the key, mouse-wheel and gamepad
// maps, the weave controller against a stub game.magic (keys, held beams, touch taps,
// drags and cancels, auto-aim, slot cycling, mana and cooldowns), the touch cluster's
// geometry, the aim maths, and the Spellbook's building blocks. The browser half —
// real multi-touch, screenshots, the Spellbook panel — is scripts/controls_check.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionForKey, KEYMAP, GAMEPAD_BUTTONS, slotOfAction, wheelSteps, cycleSlot, followBase, Input, WEAVE_SLOTS } from '../src/core/input.js';
import { Weaving, dragAim, pickTarget, TOUCH_AIM_START, TOUCH_DRAG_MAX } from '../src/ui/weaving.js';
import { clusterLayout, paintSlotState } from '../src/ui/touch.js';
import { coneAngle } from '../src/ui/aim_preview.js';
import { previewOf, aimsAtSpot, castModeOf, cleanWeave, weavePalette, fallbackName, componentInfo, paletteOf, BOSS_HINTS, SHAPE_IDS, ESSENCE_IDS, TWIST_IDS, normKind } from '../src/ui/weave_meta.js';
import { SHAPE_GLYPHS, TWIST_GLYPHS, ESSENCE_SYMBOLS, shapeIconUrl, essenceIconUrl, twistIconUrl, silhouetteUrl, essenceGrid } from '../src/ui/weave_icons.js';
import { makeMagicStub } from './helpers/magic_stub.mjs';

// ---------- input maps ----------

test('number row casts weaves 1–6; Alt + 1–5 and the numpad ask Lyra', () => {
  for (let i = 1; i <= 6; i++) {
    assert.equal(actionForKey(`Digit${i}`), `weave${i}`);
    assert.equal(slotOfAction(`weave${i}`), i - 1);
  }
  for (let i = 1; i <= 5; i++) {
    assert.equal(actionForKey(`Digit${i}`, String(i), true), `cmd${i}`);
    assert.equal(actionForKey(`Numpad${i}`), `cmd${i}`);
  }
  assert.equal(actionForKey('Digit6', '6', true), null, 'there are five requests');
  assert.equal(slotOfAction('attack'), -1);
  assert.equal(slotOfAction('weave7'), -1);
  assert.equal(WEAVE_SLOTS, 6);
});

test('existing keys keep working next to the new ones', () => {
  const same = { KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right', ArrowUp: 'up', KeyJ: 'attack', Space: 'attack', KeyK: 'dodge', ShiftLeft: 'dodge', KeyE: 'interact', KeyT: 'talk', Enter: 'talk', Tab: 'mind', KeyM: 'mind', KeyI: 'inventory', Escape: 'menu' };
  for (const [code, a] of Object.entries(same)) assert.equal(KEYMAP[code], a, code);
  assert.equal(KEYMAP.KeyB, 'spellbook');
  assert.equal(KEYMAP.KeyQ, 'slot_prev');
  assert.equal(KEYMAP.KeyR, 'slot_next');
  // Nothing new took a key that was already bound.
  const values = Object.values(KEYMAP);
  assert.ok(values.includes('interact') && KEYMAP.KeyE === 'interact', 'E stays interact (cycling uses Q / R)');
});

test('gamepad: triggers cast and cycle, the old buttons stay', () => {
  assert.equal(GAMEPAD_BUTTONS[7], 'cast');
  assert.equal(GAMEPAD_BUTTONS[6], 'slot_prev');
  assert.equal(GAMEPAD_BUTTONS[5], 'slot_next');
  for (const [i, a] of [
    [0, 'attack'],
    [1, 'dodge'],
    [2, 'interact'],
    [3, 'talk'],
    [9, 'menu'],
  ])
    assert.equal(GAMEPAD_BUTTONS[i], a);
});

test('the mouse wheel steps one slot per notch, trackpads accumulate', () => {
  assert.equal(wheelSteps(0, 120).steps, 1);
  assert.deepEqual(wheelSteps(0, -100), { steps: -1, rest: 0 });
  let r = { steps: 0, rest: 0 };
  let total = 0;
  for (let i = 0; i < 10; i++) {
    r = wheelSteps(r.rest, 12);
    total += r.steps;
  }
  assert.equal(total, 1, 'ten small trackpad deltas make one step');
  assert.equal(wheelSteps(0, 3, 1).steps, 1, 'line mode is scaled to pixels');
  assert.equal(cycleSlot(3, 1, 4), 0);
  assert.equal(cycleSlot(0, -1, 4), 3);
  assert.equal(cycleSlot(2, 1, 0), 0);
});

test('the floating stick base follows the thumb past the rim', () => {
  assert.deepEqual(followBase(100, 100, 120, 100, 50), { x: 100, y: 100 });
  const b = followBase(100, 100, 200, 100, 50);
  assert.equal(b.x, 150);
  assert.equal(b.y, 100);
  const d = followBase(0, 0, 30, 40, 25);
  assert.ok(Math.abs(Math.hypot(30 - d.x, 40 - d.y) - 25) < 1e-9);
});

test('Input: sword aim goes stale, the wheel queue drains, Alt chords release', () => {
  const game = { time: 10 };
  const inp = new Input(game);
  inp.setSwingAim(3, 4, 0.4);
  const a = inp.swingAim();
  assert.ok(Math.abs(a.x - 0.6) < 1e-9 && Math.abs(a.y - 0.8) < 1e-9);
  game.time = 10.5;
  assert.equal(inp.swingAim(), null);
  inp.wheelSteps = 2;
  assert.equal(inp.takeWheel(), 2);
  assert.equal(inp.takeWheel(), 0);
  // A key held with Alt and released without it lets go of both meanings.
  inp._onKeyDown({ code: 'Digit2', key: '2', altKey: true, target: null, preventDefault() {} });
  assert.ok(inp.uiPressed('cmd2') && inp.held.has('cmd2'));
  inp._onKeyUp({ code: 'Digit2', key: '2' });
  assert.ok(!inp.held.has('cmd2') && !inp.held.has('weave2'));
  inp.endFrame();
  inp._onKeyDown({ code: 'Digit3', key: '3', target: null, preventDefault() {} });
  assert.ok(inp.pressed('weave3') && inp.down('weave3'));
  inp._onKeyDown({ code: 'KeyC', key: 'c', ctrlKey: true, target: null, preventDefault() {} });
  assert.ok(!inp.edge.has('cast'), 'Ctrl chords stay with the browser');
});

// ---------- the weave controller against a stub runtime ----------

function bus() {
  const subs = new Map();
  return {
    on(t, fn) {
      if (!subs.has(t)) subs.set(t, []);
      subs.get(t).push(fn);
      return () => {};
    },
    emit(t, p) {
      for (const fn of subs.get(t) || []) fn(p);
    },
  };
}

function world(opts = {}) {
  const foes = [];
  const g = {
    state: 'playing',
    paused: false,
    hitStop: 0,
    time: 0,
    bus: bus(),
    player: { x: 100, y: 100, facing: { x: 1, y: 0 }, isAlive: () => true, faceToward(x, y) {
      const l = Math.hypot(x - this.x, y - this.y) || 1;
      this.facing = { x: (x - this.x) / l, y: (y - this.y) / l };
    } },
    companion: { id: 'lyra', type: 'actor', x: 130, y: 100, isAlive: () => true },
    entities: { all: () => [g.player, g.companion, ...foes] },
    combat: { isHostile: (a, b) => !!b.hostile },
    ui: { isModalOpen: () => false },
  };
  g.input = new Input(g);
  g.magic = makeMagicStub(g, opts);
  g.addFoe = (x, y) => {
    const f = { type: 'actor', x, y, hostile: true, isAlive: () => true };
    foes.push(f);
    return f;
  };
  return g;
}

function step(g, w, n = 1, dt = 1 / 60) {
  for (let i = 0; i < n; i++) {
    g.time += dt;
    w.update(dt);
    g.magic.update(dt);
    g.input.endFrame();
  }
}

test('a number key starts that slot (charging) and a quick tap casts it on the release, uncharged', () => {
  const g = world();
  const w = new Weaving(g);
  const foe = g.addFoe(160, 100);
  g.input._onKeyDown({ code: 'Digit2', key: '2', target: null, preventDefault() {} });
  step(g, w);
  const s = g.magic.calls.find((x) => x.fn === 'castStart');
  assert.ok(s, 'started on the press');
  assert.equal(s.slot, 1);
  assert.equal(s.opts.charge, true, 'every press may charge');
  assert.equal(s.aim.target, foe, 'aimed at the foe');
  assert.equal(w.selected, 1);
  assert.equal(g.magic.released.length, 0, 'nothing cast while the key is down');
  step(g, w, 3);
  g.input._onKeyUp({ code: 'Digit2', key: '2' });
  step(g, w);
  assert.equal(g.magic.released.length, 1, 'cast on the release');
  assert.equal(g.magic.released[0].k, 0, 'a quick tap is not charged');
  assert.equal(g.magic.released[0].aim.target, foe);
  assert.ok(!g.magic.calls.some((x) => x.fn === 'cast'), 'never an instant cast');
});

test('holding a weave charges it: no preview in the dead zone, then the charge grows to full', () => {
  const g = world();
  const w = new Weaving(g);
  g.addFoe(160, 100);
  g.input._onKeyDown({ code: 'Digit1', key: '1', target: null, preventDefault() {} });
  step(g, w, 5);
  assert.equal(w.aims.length, 0, 'a tap-length press draws no preview');
  step(g, w, 30);
  assert.equal(w.aims.length, 1, 'past the dead zone the aim shows');
  assert.ok(w.aims[0].charge > 0 && w.aims[0].charge < 1, `charging ${w.aims[0].charge}`);
  step(g, w, 120);
  assert.equal(w.aims[0].charge, 1, 'full');
  g.input._onKeyUp({ code: 'Digit1', key: '1' });
  step(g, w);
  assert.equal(g.magic.released.length, 1);
  assert.equal(g.magic.released[0].k, 1, 'cast at a full charge');
});

test('one charge at a time: a second weave pressed while one charges lets the first go', () => {
  const g = world();
  const w = new Weaving(g);
  g.input._onKeyDown({ code: 'Digit1', key: '1', target: null, preventDefault() {} });
  step(g, w, 40);
  g.input._onKeyDown({ code: 'Digit2', key: '2', target: null, preventDefault() {} });
  step(g, w);
  assert.equal(g.magic.released.length, 1, 'the first was cast');
  assert.equal(g.magic.released[0].slot, 0);
  assert.ok(g.magic.released[0].k > 0, 'with the charge it had');
  assert.equal(g.magic.holding?.slot, 1, 'the second charges now');
  g.input._onKeyUp({ code: 'Digit1', key: '1' });
  step(g, w);
  assert.equal(g.magic.released.length, 1, 'letting go of the first key casts nothing more');
  g.input._onKeyUp({ code: 'Digit2', key: '2' });
  step(g, w);
  assert.deepEqual(g.magic.released.map((r) => r.slot), [0, 1]);
});

test('held beams: key down starts, every step holds, key up releases', () => {
  const g = world();
  const w = new Weaving(g);
  g.input._onKeyDown({ code: 'Digit3', key: '3', target: null, preventDefault() {} });
  step(g, w, 10);
  g.input._onKeyUp({ code: 'Digit3', key: '3' });
  step(g, w);
  const fns = g.magic.calls.map((c) => c.fn);
  assert.equal(fns[0], 'castStart');
  assert.ok(fns.filter((f) => f === 'castHold').length >= 8);
  assert.equal(fns[fns.length - 1], 'castRelease');
  assert.ok(!fns.includes('cast'));
});

test('touch: a quick tap casts on release, auto-aimed at the nearest foe in range', () => {
  const g = world();
  const w = new Weaving(g);
  const near = g.addFoe(150, 110);
  g.addFoe(400, 100); // out of range
  w.touchStart(0, 7);
  step(g, w, 3);
  assert.equal(g.magic.calls[0].fn, 'castStart', 'the press starts it');
  assert.equal(g.magic.released.length, 0, 'nothing cast until the finger lifts');
  w.touchEnd(7);
  step(g, w);
  const c = g.magic.released[0];
  assert.equal(c.slot, 0);
  assert.equal(c.k, 0);
  assert.equal(c.aim.target, near);
});

test('touch: a drag aims (the preview follows) and lifting casts toward the drag', () => {
  const g = world();
  const w = new Weaving(g);
  w.touchStart(0, 1);
  step(g, w);
  w.touchMove(1, -60, -60);
  step(g, w, 2);
  assert.equal(w.aims.length, 1, 'the aim layer has a preview');
  assert.ok(w.aims[0].x < g.player.x && w.aims[0].y < g.player.y);
  w.touchEnd(1);
  step(g, w);
  const c = g.magic.released[0];
  assert.ok(c.aim.x < 100 && c.aim.y < 100, 'cast up-left');
  assert.equal(w.aims.length, 0);
});

test('touch: dragging back onto the button cancels', () => {
  const g = world();
  const w = new Weaving(g);
  w.touchStart(0, 2);
  step(g, w);
  w.touchMove(2, 80, 0);
  step(g, w);
  w.touchMove(2, 4, 2);
  step(g, w);
  assert.ok(w.aims[0].cancel, 'the preview shows the cancel');
  w.touchEnd(2);
  step(g, w);
  assert.equal(g.magic.released.length, 0);
  assert.equal(g.magic.calls[g.magic.calls.length - 1].fn, 'castCancel');
});

test('touch on a held weave: press starts, drag steers, back onto the button cancels it', () => {
  const g = world();
  const w = new Weaving(g);
  w.touchStart(2, 3); // slot 3 is the storm beam
  step(g, w);
  assert.equal(g.magic.calls[0].fn, 'castStart');
  w.touchMove(3, 0, -70);
  step(g, w, 3);
  const hold = g.magic.calls.filter((c) => c.fn === 'castHold').pop();
  assert.ok(hold.aim.y < 100 - 30, 'held aim follows the drag up');
  w.touchMove(3, 2, -3);
  step(g, w);
  w.touchEnd(3);
  step(g, w);
  assert.equal(g.magic.calls[g.magic.calls.length - 1].fn, 'castCancel');
});

test('mana and cooldowns: starved slots dim, failed casts shake, cooldown sweeps', () => {
  const g = world({ mana: 3 });
  const w = new Weaving(g);
  assert.ok(w.starved(0));
  assert.equal(w.canCast(0).reason, 'mana');
  g.input._onKeyDown({ code: 'Digit1', key: '1', target: null, preventDefault() {} });
  step(g, w);
  assert.equal(w.lastFail(0)?.reason, 'mana');
  g.magic.mana.cur = 40;
  g.input._onKeyUp({ code: 'Digit1', key: '1' });
  g.input._onKeyDown({ code: 'Digit1', key: '1', target: null, preventDefault() {} });
  step(g, w);
  g.input._onKeyUp({ code: 'Digit1', key: '1' });
  step(g, w);
  assert.ok(w.cooldownFrac(0) > 0.5, 'just cast: cooling');
  assert.ok(w.cooldownLeft(0) > 0.2, 'seconds left to show');
  // Pressing it again while it cools: refused, and the button shakes with "cooldown".
  g.input._onKeyDown({ code: 'Digit1', key: '1', target: null, preventDefault() {} });
  step(g, w);
  assert.equal(w.lastFail(0)?.reason, 'cooldown');
  g.input._onKeyUp({ code: 'Digit1', key: '1' });
  step(g, w, 60);
  assert.equal(w.cooldownFrac(0), 0, 'ready again');
});

// A weave button's moving parts without a browser: just enough of an element.
function fakeEl() {
  const classes = new Set();
  const style = new Map();
  return {
    classes,
    style: { setProperty: (k, v) => style.set(k, v), get: (k) => style.get(k) },
    classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
    textContent: '',
  };
}

test('the button: a sweep with its seconds while one or more is left, a flash when ready, the charge ring, not-ready shake', () => {
  const slot = { b: fakeEl(), cd: fakeEl(), secs: fakeEl(), chg: fakeEl() };
  const rec = { plan: { ok: true }, cooldown: 3.5 };
  const st = { frac: 0, left: 0, charge: null, fail: null, starved: false };
  const w = {
    cooldownFrac: () => st.frac,
    cooldownLeft: () => st.left,
    chargeOf: () => st.charge,
    starved: () => st.starved,
    lastFail: () => st.fail,
  };
  const paint = (t) => paintSlotState(slot, rec, w, 0, t);
  Object.assign(st, { frac: 0.75, left: 2.6 });
  paint(1);
  assert.ok(slot.b.classes.has('cooling'));
  assert.equal(slot.cd.style.get('--cd'), '0.750');
  assert.equal(slot.secs.textContent, '3', 'whole seconds, rounded up');
  Object.assign(st, { frac: 0.2, left: 0.7 });
  paint(2);
  assert.equal(slot.secs.textContent, '', 'under a second: the sweep alone');
  // Pressed while cooling: the shake, marked not-ready.
  st.fail = { reason: 'cooldown', t: 2 };
  paint(2.1);
  assert.ok(slot.b.classes.has('shake') && slot.b.classes.has('not-ready'));
  Object.assign(st, { frac: 0, left: 0 });
  paint(2.5);
  assert.ok(!slot.b.classes.has('cooling'));
  assert.ok(slot.b.classes.has('ready'), 'it flashes as it comes back');
  paint(3.2);
  assert.ok(!slot.b.classes.has('ready'), 'for a moment only');
  assert.ok(!slot.b.classes.has('shake'));
  // Charging: the ring fills; full, it pulses; held back by mana, it says so.
  st.charge = { k: 0.4, live: true, capped: false, full: false };
  paint(4);
  assert.ok(slot.b.classes.has('charging') && !slot.b.classes.has('charged'));
  assert.equal(slot.chg.style.get('--charge'), '0.400');
  st.charge = { k: 1, live: true, capped: false, full: true };
  paint(4.5);
  assert.ok(slot.b.classes.has('charged'));
  st.charge = { k: 0.3, live: true, capped: true, full: false };
  st.starved = true;
  paint(5);
  assert.ok(slot.b.classes.has('capped') && !slot.b.classes.has('starved'), 'capped, not starved, while it charges');
  st.charge = null;
  paint(5.5);
  assert.ok(!slot.b.classes.has('charging') && slot.b.classes.has('starved'));
});

test('no casting while paused, in a menu, typing, downed or in a scene', () => {
  const blockers = [(g) => (g.paused = true), (g) => (g.ui.isModalOpen = () => true), (g) => (g.input.enabled = false), (g) => (g.player.downed = true), (g) => (g.state = 'cutscene')];
  for (const block of blockers) {
    const g = world();
    const w = new Weaving(g);
    block(g);
    g.input._onKeyDown({ code: 'Digit1', key: '1', target: null, preventDefault() {} });
    w.touchStart(0, 9);
    w.touchEnd(9);
    step(g, w);
    assert.equal(g.magic.calls.length, 0, String(block));
  }
});

test('slot cycling skips empty slots; the wheel and Q / R drive it', () => {
  const g = world({ slots: [{ shape: 'bolt', essences: [], twists: [] }, null, { shape: 'nova', essences: [], twists: [] }, null, null, null] });
  const w = new Weaving(g);
  w.selected = 0;
  w.cycle(1);
  assert.equal(w.selected, 2, 'skipped the empty slot 2');
  g.input.wheelSteps = 1;
  step(g, w);
  assert.equal(w.selected, 0);
  g.input._onKeyDown({ code: 'KeyQ', key: 'q', target: null, preventDefault() {} });
  step(g, w);
  assert.equal(w.selected, 2);
});

test('slots, limits and unlocks are read from the runtime; the UI hides without it', () => {
  const g = world();
  const w = new Weaving(g);
  assert.equal(w.slotCount(), 4);
  g.magic.slotCount = 6;
  assert.equal(w.slotCount(), 6);
  assert.equal(w.limit('essences'), 2);
  assert.equal(w.limit('twist'), 2);
  assert.ok(w.isUnlocked('shapes', 'bolt'));
  assert.ok(!w.isUnlocked('essences', 'dark'));
  g.magic.unlock('essence', 'dark', 'boss:bone_warden');
  assert.ok(w.isUnlocked('essence', 'dark'));
  const ids = w.ids('essences');
  for (const id of ESSENCE_IDS) assert.ok(ids.includes(id));
  delete g.magic;
  assert.equal(w.slotCount(), 0);
  assert.equal(w.available(), false);
});

test('setSlot saves through the runtime and recompiles the slot', () => {
  const g = world();
  const w = new Weaving(g);
  const v0 = w.version;
  const r = w.setSlot(4, { shape: 'blast', essences: ['frost', 'fire', 'storm'], twists: ['split'] });
  assert.ok(r.ok);
  assert.deepEqual(g.magic.slots[4].essences, ['frost', 'fire'], 'trimmed to the essence limit');
  assert.ok(w.version > v0);
  g.magic.slotCount = 5;
  const rec = w.slotInfo(4);
  assert.ok(rec.plan && rec.name);
  assert.equal(rec.mode, 'quick');
});

// ---------- aim maths ----------

test('drag aim: direction for lines, distance for spots, nothing on the button', () => {
  assert.equal(dragAim(5, 5, { type: 'line' }, 150), null);
  const l = dragAim(TOUCH_AIM_START + 10, 0, { type: 'line' }, 150);
  assert.ok(Math.abs(l.x - 150) < 1e-9 && l.y === 0, 'a line reaches its full range');
  const near = dragAim(TOUCH_AIM_START + 1, 0, { type: 'circle' }, 120);
  const far = dragAim(TOUCH_DRAG_MAX * 2, 0, { type: 'circle' }, 120);
  assert.ok(near.x < far.x && Math.abs(far.x - 120) < 1e-9, 'a spot follows the finger out to the range');
  assert.ok(aimsAtSpot({ type: 'point' }) && aimsAtSpot({ type: 'wall' }) && !aimsAtSpot({ type: 'cone' }));
});

test('auto-aim prefers the nearest foe, a little in favour of what is in front', () => {
  const behind = { x: -30, y: 0, hostile: true };
  const ahead = { x: 34, y: 0, hostile: true };
  assert.equal(pickTarget([behind, ahead], 0, 0, 1, 0, 100), ahead);
  assert.equal(pickTarget([{ x: 10, y: 0, hostile: false }], 0, 0, 1, 0, 100), null);
  assert.equal(pickTarget([{ x: 200, y: 0, hostile: true }], 0, 0, 1, 0, 100), null);
});

test('cone angles come from radians, degrees or a width', () => {
  assert.ok(Math.abs(coneAngle({ angle: 1.2 }) - 1.2) < 1e-9);
  assert.ok(Math.abs(coneAngle({ angle: 90 }) - Math.PI / 2) < 1e-9);
  assert.ok(coneAngle({ width: 40, range: 40 }) > 0.5);
  assert.equal(coneAngle({}), 1.1);
});

// ---------- the touch cluster ----------

test('the weave arc never overlaps and stays on a 667×375 phone, for 0–6 slots, either hand', () => {
  const geos = [
    [{ sword: 78, btn: 56, dodge: 54, use: 52, r1: 96, r2: 162, edge: 14 }, 667, 375],
    [{ sword: 70, btn: 52, dodge: 50, use: 48, r1: 86, r2: 146, edge: 12 }, 390, 844],
  ];
  for (const [geo, W, H] of geos) for (const mirror of [false, true]) {
    for (let n = 0; n <= 6; n++) {
      const L = clusterLayout(n, geo, mirror);
      assert.equal(L.slots.length, n);
      const pieces = [{ x: 0, y: 0, s: geo.sword }, { ...L.dodge, s: geo.dodge }, { ...L.use, s: geo.use }, ...L.slots.map((p) => ({ ...p, s: geo.btn }))];
      for (let i = 0; i < pieces.length; i++) {
        for (let j = i + 1; j < pieces.length; j++) {
          const a = pieces[i];
          const b = pieces[j];
          // Round buttons: centres at least the two radii plus 3 px apart.
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - (a.s + b.s) / 2;
          assert.ok(gap >= 3, `${W}×${H}, ${n} slots: pieces ${i} and ${j} overlap (${gap.toFixed(1)})`);
        }
      }
      // The sword's centre sits (sword/2 + edge) in from the corner; everything must fit.
      const c = geo.sword / 2 + geo.edge;
      for (const p of pieces) {
        const x = mirror ? c + p.x : W - c + p.x;
        const y = H - c + p.y;
        assert.ok(x - p.s / 2 >= 0 && x + p.s / 2 <= W && y - p.s / 2 >= 56 && y + p.s / 2 <= H, `${n} slots: a piece is off screen or under the strip`);
      }
    }
  }
});

// ---------- the Spellbook's building blocks ----------

test('plans: the runtime aim descriptor wins; walls are laid across; modes from input', () => {
  const pv = previewOf({ aim: { type: 'cone', range: 60, angle: 1 } }, { shape: 'blast' });
  assert.equal(pv.type, 'cone');
  assert.equal(pv.range, 60);
  const wall = previewOf({ aim: { type: 'line', range: 50, width: 8, length: 70, across: true } }, { shape: 'wall' });
  assert.equal(wall.type, 'wall');
  assert.equal(wall.width, 70);
  assert.equal(previewOf(null, { shape: 'nova' }).type, 'ring');
  assert.equal(castModeOf({ input: 'hold' }, { shape: 'beam' }), 'hold');
  assert.equal(castModeOf({ input: 'charge' }, { shape: 'bolt', twists: ['charge'] }), 'charge');
  assert.equal(castModeOf({ input: 'tap' }, { shape: 'bolt' }), 'quick');
  assert.equal(castModeOf(null, { shape: 'beam' }), 'hold');
});

test('weaves are cleaned to the limits; palettes blend; names fall back', () => {
  assert.deepEqual(cleanWeave({ shape: 'bolt', essences: ['fire', 'fire', 'frost', 'dark'], twists: ['a', 'b', 'c'], name: '  Ember  ' }, 2, 2), { shape: 'bolt', essences: ['fire', 'frost'], twists: ['a', 'b'], name: 'Ember' });
  assert.equal(cleanWeave(null), null);
  const p = weavePalette({ essences: ['fire', 'frost'] }, null);
  assert.ok(/^#[0-9a-f]{6}$/.test(p.core) && p.core !== '#ffd36b');
  assert.equal(weavePalette({ essences: [] }, { palette: { core: '#123456', glow: '#654321' } }).core, '#123456');
  assert.equal(fallbackName({ shape: 'bolt', essences: ['fire'], twists: ['split'] }), 'Splitting Ember Bolt');
  assert.equal(fallbackName(null), 'Empty');
  assert.equal(paletteOf({ nope: 1 }), null);
  assert.equal(componentInfo('essence', 'fire', { name: 'Fire!', palette: { core: '#ff0000', glow: '#aa0000' } }).name, 'Fire!');
  assert.equal(componentInfo('twist', 'brand_new').name, 'Brand New', 'a new registry entry gets a readable name');
  assert.equal(normKind('essence'), 'essences');
});

test('every component has a glyph or a symbol, and every boss gift a hint', () => {
  for (const id of SHAPE_IDS) {
    const g = SHAPE_GLYPHS[id];
    assert.ok(g, id);
    assert.ok(g.every((r) => r.length === g[0].length && /^[.kdgcswpaAe]+$/.test(r)), `${id} grid`);
    assert.ok(shapeIconUrl(id).startsWith('data:image/svg+xml,'));
  }
  for (const id of TWIST_IDS) {
    assert.ok(TWIST_GLYPHS[id], id);
    assert.ok(twistIconUrl(id).length > 100);
  }
  for (const id of ESSENCE_IDS) {
    assert.ok(ESSENCE_SYMBOLS[id], id);
    assert.equal(essenceGrid(id).length, 11);
    assert.ok(essenceIconUrl(id).length > 100);
  }
  assert.ok(silhouetteUrl('twists', 'whatever').length > 100, 'unknown ids still draw');
  for (const k of ['essences:fire', 'twists:volley', 'essences:wind', 'twists:swift', 'essences:poison', 'twists:split', 'essences:water', 'twists:bounce', 'essences:dark', 'twists:chain']) assert.ok(BOSS_HINTS[k], k);
});

test('a stub Spellbook round trip: compile, save, rename, clear through the controller', () => {
  const g = world();
  const w = new Weaving(g);
  const draft = { shape: 'throw', essences: ['frost', 'storm'], twists: ['split'] };
  const plan = w.compile(draft);
  assert.ok(Weaving.planOk(plan));
  assert.ok(w.setSlot(1, { ...draft, name: 'Hailstone' }).ok);
  assert.equal(w.slotInfo(1).name, 'Hailstone');
  const locked = w.compile({ shape: 'throw', essences: ['dark'], twists: [] });
  assert.ok(!Weaving.planOk(locked) && /dark/.test(locked.reason));
  assert.ok(w.setSlot(1, null).ok);
  assert.equal(w.weaveAt(1), null);
  assert.equal(w.slotInfo(1).weave, null);
});

// ---------- r13: a click on a hotbar slot is that slot's key ----------

test('a click on a hotbar slot casts it at once and selects nothing (the author: "the skill gets unselected after I hit it")', () => {
  const g = world();
  const w = new Weaving(g);
  const foe = g.addFoe(160, 100);
  w.selected = 0;
  w.clickStart(1, 1);
  step(g, w);
  const s = g.magic.calls.find((x) => x.fn === 'castStart');
  assert.ok(s, 'started on the press');
  assert.equal(s.slot, 1);
  assert.equal(w.castingSlot(), 1, 'the bar can name the slot being cast');
  w.clickEnd(1);
  step(g, w);
  assert.equal(g.magic.released.length, 1, 'cast on the release');
  assert.equal(g.magic.released[0].slot, 1);
  assert.equal(g.magic.released[0].k, 0, 'a quick click is not charged');
  assert.equal(g.magic.released[0].aim.target, foe, 'with the mouse on the slot it aims like a key: the nearest foe');
  assert.equal(w.selected, 0, 'the right button keeps its weave: nothing is selected by a click');
  assert.equal(w.castingSlot(), -1, 'nothing left held');
  assert.equal(w.clicks.size, 0);
});

test('a held click on a slot charges it, and dragging out over the world aims at the mouse', () => {
  const g = world();
  const w = new Weaving(g);
  g.renderer = { cssToWorld: (x, y) => ({ x, y }) };
  g.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  w.clickStart(0, 1);
  step(g, w, 60);
  // The button is held and the mouse is dragged out over the game, up-left of the player.
  g.input._onPointerMove({ pointerType: 'mouse', clientX: 40, clientY: 30, target: g.canvas });
  step(g, w, 60);
  assert.equal(w.aims.length, 1, 'the charge shows its aim');
  assert.ok(w.aims[0].charge > 0.5, `charging ${w.aims[0].charge}`);
  w.clickEnd(1);
  step(g, w);
  const r = g.magic.released[0];
  assert.ok(r.k > 0.5, 'released charged');
  assert.ok(r.aim.x < 100 && r.aim.y < 100, `cast toward the mouse (${r.aim.x}, ${r.aim.y})`);
});

test('a click on a slot while a panel is open casts nothing, and a cancelled press is let go', () => {
  const g = world();
  const w = new Weaving(g);
  g.ui.isModalOpen = () => true;
  w.clickStart(0, 1);
  step(g, w);
  w.clickEnd(1);
  step(g, w);
  assert.equal(g.magic.calls.filter((c) => c.fn === 'castStart').length, 0);
  g.ui.isModalOpen = () => false;
  w.clickStart(1, 2);
  step(g, w, 30);
  w.clickEnd(2, true);
  step(g, w);
  assert.equal(g.magic.released.filter((r) => !r.cancelled).length, 0, 'a pointercancel casts nothing');
});
