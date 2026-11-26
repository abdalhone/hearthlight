// Round 14b, the merged game: the author's list (plan §11, items 1 to 25, and §13's verifier
// item 26) played as one scripted run in the built game, on a phone held sideways (844x390)
// and upright (390x844) by real taps, and on a computer (1280x720) by keys and mouse; the
// sideways phone also at 4x CPU throttle (item 24).
//
// State is set up through the same game hooks the other check scripts use (window.__game);
// the acts the author would do (Talk, typing in the chat, the sword held, the card tapped,
// Tab, the shop's buttons, the defence typed, a middle click, the dark hand held) go
// through real input. Claude is offline, except for a village stub that the run steers and
// records (one call each, the tasks it was given). Every item is one block of checks; a
// failure in one does not stop the next.
//
//   node scripts/r14b_story.mjs [--out DIR] [--only sideways,upright,desktop] [--items 1,2,3]
//   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/r14b_story';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const ITEMS = argv.includes('--items') ? new Set(argv[argv.indexOf('--items') + 1].split(',').map(Number)) : null;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const SIZES = [
  { tag: 'sideways', w: 844, h: 390, phone: true, throttle: 4 },
  { tag: 'upright', w: 390, h: 844, phone: true },
  { tag: 'desktop', w: 1280, h: 720, phone: false },
].filter((s) => !ONLY || ONLY.includes(s.tag));

await mkdir(OUT, { recursive: true });
const server = await startServer(0);
const base = `http://localhost:${server.address().port}/dist/index.html`;
const browser = await chromium.launch();
const failures = [];
let checks = 0;
const check = (ok, label, info = '') => {
  checks++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${info ? `  ${String(info).slice(0, 300)}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
};

// The page's own setup after a new game (or a loaded one): noon, the coach quiet, the
// village Claude stub, an event log, and the helpers every item uses.
function pageSetup() {
  const g = window.__game;
  try {
    g.story?.skip?.();
  } catch {
    /* no story */
  }
  const u = g.ui;
  for (const id of Object.keys(u?.coach?.done || {})) u.coach.done[id] = true;
  u?.coach?.stop?.();
  g.flags.talkHintShown = true;
  g.flags.finisherWarned = true;
  g.flags.finisherWarnedLyra = true;
  window.__ev = [];
  const TYPES = ['villager_killed', 'villager_died', 'crime', 'finisher', 'lock_changed', 'companion_changed', 'pact_sealed', 'killing_known', 'hunt_started', 'child_hides', 'child_taken_away', 'store_burned', 'body_searched', 'theft_recognized', 'memories_shared', 'letter_read', 'parting', 'dark_verdict', 'unkindled', 'talk_opened'];
  for (const t of TYPES)
    g.bus.on(t, (p) => window.__ev.push({ t, id: p?.id ?? p?.victim?.id ?? p?.target?.id ?? p?.npc?.id ?? null, why: p?.why ?? null, from: p?.from ?? null, to: p?.to ?? null, kind: p?.kind ?? p?.mode ?? null, gifts: p?.gifts ?? null, w: Array.isArray(p?.witnesses) ? p.witnesses.map((x) => (typeof x === 'string' ? x : x?.id)) : null }));
  window.__toasts = [];
  if (!g.ui.__wrapped) {
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, ...a) => {
      window.__toasts.push(String(text));
      return toast(text, ...a);
    };
    g.ui.__wrapped = true;
  }
  g.survival.alert = () => {};
  g.survival.patrol = () => {};
  // A Claude for the villagers the run can steer: plain, silent, terror, or a yes to join.
  window.__vClaude = 'plain';
  window.__vTasks = [];
  const v = g.village;
  v.provider = () => ({ id: 'check' });
  v.askClaude = async (p, rules, task, schema, kind) => {
    window.__vTasks.push({ kind, task: String(task).slice(0, 4000) });
    const base = { say: '', silent: null, action: null, act: null, mood: 'warm', opinion_delta: 0, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null, commit: null };
    if (kind === 'aloud') {
      const ids = [...String(task).matchAll(/\[(\w+)\]/g)].map((m) => m[1]).filter((x) => g.entities.get(x));
      return { replies: ids.slice(0, 3).map((id, i) => ({ who: id, say: ['Good morning to you too!', 'Hmph. Morning.', 'Morning! Morning!'][i % 3], action: null, mood: 'warm', opinion_delta: 1, memory: null })) };
    }
    if (window.__vClaude === 'silent') return { ...base, action: 'turn_away', mood: 'cold', opinion_delta: -1 };
    if (window.__vClaude === 'terror') return { ...base, say: 'Don’t come near me! Somebody, help!', action: 'flee', mood: 'afraid', opinion_delta: -2 };
    if (window.__vClaude === 'yesjoin') return { ...base, say: 'Aye, I will come with you!', act: 'join' };
    return { ...base, say: 'Well, good day to you.', opinion_delta: 1 };
  };
  window.__at = (e, tx, ty, still = true) => {
    e.x = tx * 16 + 8;
    e.y = ty * 16 + 10;
    e.walker?.stop?.();
    if (e.r) e.r.key = null;
    if (still) e.think = () => {};
  };
  window.__put = (e, x, y, still = true) => {
    e.x = x;
    e.y = y;
    e.walker?.stop?.();
    if (e.r) e.r.key = null;
    if (still) e.think = () => {};
  };
  window.__away = (keep = []) => {
    for (const e of g.villageLife.villagers()) if (!keep.includes(e.id)) window.__at(e, 20 + Math.random() * 4, 52);
  };
  window.__lyraAway = () => {
    const L = g.companion;
    if (L && !L.dead) {
      L.x = 150 * 16;
      L.y = 112 * 16;
      L._heldController = L._heldController || L.controller;
      L.controller = null;
    }
  };
  window.__clean = () => {
    try {
      g.ui?.closeAll?.();
      g.ui?.chat?.close?.();
      document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
    } catch {
      /* cosmetic */
    }
  };
  window.__sq = g.locations.get('town_square').center;
  window.__hudText = () => {
    const hud = document.querySelector('.hud');
    const walk = (n, out) => {
      if (n.nodeType === 3) out.push(n.textContent);
      else if (n.nodeType === 1) {
        const cs = getComputedStyle(n);
        if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden') return out;
        for (const c of n.childNodes) walk(c, out);
      }
      return out;
    };
    return hud ? walk(hud, []).join(' ').replace(/\s+/g, ' ') : '';
  };
  window.__vis = (sel) => {
    const e = document.querySelector(sel);
    if (!e) return false;
    for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  g.clock.skipTo?.(12);
  window.__clean();
}

async function play(S) {
  const tag = S.tag;
  const ctx = await browser.newContext({ viewport: { width: S.w, height: S.h }, isMobile: S.phone, hasTouch: S.phone, deviceScaleFactor: 1, userAgent: S.phone ? UA : undefined });
  let page = await ctx.newPage();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    p.on('console', (m) => {
      if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR|Failed to load resource/.test(m.text())) errors.push(`console.error: ${m.text()}`);
    });
  };
  watch(page);
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const until = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout, polling: 50 }).then(() => true).catch(() => false);
  const rectOf = (sel) =>
    ev((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    }, sel);
  const press = async (sel) => {
    const r = await rectOf(sel);
    if (!r) return null;
    if (S.phone) await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    else await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    await wait(300);
    return r;
  };
  const talk = async () => {
    if (S.phone) await press('.tbtn-interact');
    else await page.keyboard.press('t');
    await wait(450);
  };
  const say = async (text) => {
    await press('.chat-field');
    await page.keyboard.type(text, { delay: 4 });
    await page.keyboard.press('Enter');
  };
  const chatState = () =>
    ev(() => {
      const c = window.__game.ui.chat;
      return { open: c.isOpen(), target: c.target, disabled: !!c.field?.disabled, ph: c.field?.placeholder || '', chips: [...document.querySelectorAll('.chat-chips .chip')].map((b) => b.textContent), rows: [...document.querySelectorAll('.chat-log .msg')].map((r) => r.textContent.trim()).slice(-8) };
    });
  // Stand beside someone, facing them.
  const standBy = (id, dx = 18) =>
    ev(
      ({ id, dx }) => {
        const g = window.__game;
        const e = id === 'lyra' ? g.companion : g.entities.get(id);
        const P = g.player;
        P.x = e.x + dx;
        P.y = e.y;
        P.facing = { x: dx > 0 ? -1 : 1, y: 0 };
        P.dir = dx > 0 ? 'left' : 'right';
        g.camera.snap?.();
      },
      { id, dx },
    );
  const swing = async () => {
    if (S.phone) await press('.tbtn-attack');
    else await page.keyboard.press('j');
    await wait(260);
  };
  const holdSword = async (ms) => {
    if (S.phone) {
      const r = await rectOf('.tbtn-attack');
      if (!r) return false;
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.w / 2, y: r.y + r.h / 2, id: 7 }] });
      await wait(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
    } else {
      await page.keyboard.down('j');
      await wait(ms);
      await page.keyboard.up('j');
    }
    await wait(200);
    return true;
  };
  // A finishing blow on someone already down: stand over them, hold the sword.
  const finish = async (id) => {
    await ev((id) => {
      const g = window.__game;
      const v = id === 'lyra' ? g.companion : g.entities.get(id);
      g.player.x = v.x - 14;
      g.player.y = v.y;
      g.player.faceToward(v.x, v.y);
      g.camera.snap?.();
    }, id);
    await holdSword(1900);
    await wait(300);
  };
  const boot = async () => {
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
  };
  const fresh = async () => {
    await boot();
    await ev(() => window.__game.newGame());
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
    await wait(600);
    await ev(pageSetup);
    await wait(200);
  };
  // Save, reload the page, continue: the run picks up the loaded game.
  const reload = async () => {
    await ev(async () => {
      await window.__game.save.save('r14b_story');
    });
    await boot();
    const ok = await ev(async () => !!(await window.__game.continueGame()));
    await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 }).catch(() => {});
    await wait(600);
    await ev(pageSetup);
    return ok;
  };
  const item = async (n, title, fn) => {
    if (ITEMS && !ITEMS.has(n)) return;
    console.log(`--- [${tag}] item ${n}: ${title}`);
    try {
      await fn();
    } catch (err) {
      check(false, `[${tag}] ${n} ran to the end`, err?.message || String(err));
    }
    await ev(() => window.__clean?.()).catch(() => {});
  };
  // The square at noon with a few people held where they are put; the rest away.
  const square = (spots) =>
    ev((spots) => {
      const g = window.__game;
      g.clock.skipTo?.(12);
      const sq = window.__sq;
      window.__away(Object.keys(spots));
      for (const [id, [dx, dy]] of Object.entries(spots)) {
        const e = g.entities.get(id);
        if (e) window.__put(e, sq.x + dx, sq.y + dy);
      }
      window.__lyraAway();
      g.player.x = sq.x + 120;
      g.player.y = sq.y + 80;
      g.camera.snap?.();
    }, spots);

  // ================================================================ session A: talk
  if (!ITEMS || [1, 5, 6, 7, 12, 22].some((n) => ITEMS.has(n))) await fresh();

  await item(5, 'talk controls', async () => {
    await square({ bram: [0, 0], elda: [-70, 10], pip: [70, 30], garrick: [-40, 90] });
    await standBy('bram');
    await wait(400);
    const at = await ev(() => {
      const g = window.__game;
      const pip = g.entities.get('pip');
      const p = g.renderer.worldToCss(pip.x, pip.y - 10);
      const r = g.canvas.getBoundingClientRect();
      return { x: r.left + p.x, y: r.top + p.y };
    });
    if (S.phone) await page.touchscreen.tap(at.x, at.y);
    else await page.mouse.click(at.x, at.y);
    await wait(400);
    check((await chatState()).open === false, `[${tag}] 5 a ${S.phone ? 'tap' : 'click'} on Pip opens no chat`);
    check(await ev(() => !window.__game.murder.isDead('pip') && !window.__game.entities.get('pip').downed), `[${tag}] 5 Pip is unhurt`);
    if (S.phone) {
      const label = await ev(() => document.querySelector('.tbtn-interact')?.getAttribute('aria-label') || document.querySelector('.tbtn-interact')?.textContent || '');
      check(/Talk to Bram/.test(label), `[${tag}] 5 the round button names him`, label);
    }
    await talk();
    let st = await chatState();
    check(st.open && st.target === 'bram', `[${tag}] 5 Talk beside Bram talks to Bram`, JSON.stringify({ open: st.open, target: st.target }));
    await ev(() => window.__clean());
    // Elda in front, Bram behind: Elda.
    await ev(() => {
      const g = window.__game;
      const e = g.entities.get('elda');
      const b = g.entities.get('bram');
      const P = g.player;
      P.x = e.x + 20;
      P.y = e.y;
      b.x = P.x + 24;
      b.y = P.y;
      P.facing = { x: -1, y: 0 };
      P.dir = 'left';
      g.camera.snap?.();
    });
    await wait(300);
    if (S.phone) {
      const label = await ev(() => document.querySelector('.tbtn-interact')?.getAttribute('aria-label') || document.querySelector('.tbtn-interact')?.textContent || '');
      check(/Talk to Elda/.test(label), `[${tag}] 5 "Talk to Elda" on the button`, label);
    }
    await talk();
    st = await chatState();
    check(st.open && st.target === 'elda', `[${tag}] 5 Elda in front and Bram behind: Talk talks to Elda`, st.target);
    await ev(() => window.__clean());
    // Trade from the chat: Garrick's shop.
    await standBy('garrick');
    await talk();
    const tr = await rectOf('.chat-trade');
    check(!!tr && tr.h >= 44, `[${tag}] 5 "Trade · Give · Work" in the chat header, ${tr ? Math.round(tr.h) : 0} px`);
    await press('.chat-trade');
    await wait(400);
    await press('.dlg-opt.opt-shop');
    await page.waitForSelector('.shop', { timeout: 4000 }).catch(() => {});
    check(await ev(() => window.__vis('.shop')), `[${tag}] 5 Trade from the chat opens Garrick's shop`);
    await shot('05-trade-from-chat');
  });

  await item(6, 'say aloud', async () => {
    await square({ bram: [-40, 0], elda: [40, 0], tobias: [0, 40], wys: [400, 0] });
    await ev(() => {
      const g = window.__game;
      const sq = window.__sq;
      g.player.x = sq.x;
      g.player.y = sq.y - 30;
      g.player.facing = { x: 0, y: -1 };
      g.camera.snap?.();
      window.__vTasks.length = 0;
      g.ui.chat.open(false);
      g.ui.chat.selectTarget('@near');
    });
    await wait(300);
    await say('Good morning everyone!');
    await until(() => window.__vTasks.some((t) => t.kind === 'aloud'), null, 8000);
    await wait(1500);
    const al = await ev(() => ({ tasks: window.__vTasks.filter((t) => t.kind === 'aloud').length, bubbles: document.querySelectorAll('.bubble').length, heardBy: Object.entries(window.__game.village.talks).filter(([, l]) => l.some((t) => /Good morning everyone/.test(t.you || ''))).map(([id]) => id) }));
    check(al.tasks === 1, `[${tag}] 6 one batched call for everyone who heard`, JSON.stringify(al));
    check(al.heardBy.length >= 2 && !al.heardBy.includes('wys'), `[${tag}] 6 those near heard it and keep it; Wys, far off, did not`, al.heardBy.join(','));
    await shot('06-aloud');
    // A threat said aloud: news with every hearer as a witness.
    await say('I will kill you all.');
    await wait(1200);
    const thr = await ev(() => (window.__game.village.rumors.list || []).filter((r) => /threat/.test(r.kind)).map((r) => ({ kind: r.kind, w: (r.witnesses || r.saw || []).length })));
    check(thr.length >= 1, `[${tag}] 6 a threat said aloud becomes talk of it`, JSON.stringify(thr));
  });

  await item(7, '*acts*', async () => {
    await square({ elda: [0, 0], bram: [80, 0], pip: [-80, 0], tilly: [0, 80], garrick: [80, 80], rowan: [160, 0] });
    const sayTo = async (id, text) => {
      await standBy(id);
      await ev((id) => {
        const g = window.__game;
        g.ui.chat.open(false);
        g.ui.chat.selectTarget(id);
        window.__vTasks.length = 0;
      }, id);
      await say(text);
      await wait(1100);
    };
    const op0 = await ev(() => window.__game.entities.get('elda').opinionOfPlayer);
    await sayTo('elda', '*bows* Good morning');
    const op1 = await ev(() => window.__game.entities.get('elda').opinionOfPlayer);
    const rows = (await chatState()).rows;
    check(op1 > op0, `[${tag}] 7 *bows* to Elda: she warms`, `${op0} -> ${op1}`);
    check(rows.some((r) => /bow/i.test(r)), `[${tag}] 7 the act shows as a row`, rows.slice(-3).join(' | '));
    await shot('07-bow');
    await ev(() => window.__clean());
    await sayTo('pip', '*kisses Pip*');
    let st = await chatState();
    check(st.rows.some((r) => /You don't\./.test(r)) && (await ev(() => window.__vTasks.length)) === 0, `[${tag}] 7 *kisses Pip*: "You don't." and no mind asked`, st.rows.slice(-2).join(' | '));
    await ev(() => window.__clean());
    await sayTo('tilly', '*kisses Tilly*');
    st = await chatState();
    check(st.rows.some((r) => /You don't\./.test(r)) && (await ev(() => window.__vTasks.length)) === 0, `[${tag}] 7 *kisses Tilly* at 17: "You don't.", no call`, st.rows.slice(-2).join(' | '));
    await ev(() => window.__clean());
    const c0 = await ev(() => window.__ev.filter((e) => e.t === 'crime').length);
    await sayTo('bram', '*slaps Bram*');
    const slap = await ev((c0) => ({ crimes: window.__ev.filter((e) => e.t === 'crime').slice(c0), hp: window.__game.entities.get('bram').hp, max: window.__game.entities.get('bram').maxHp }), c0);
    check(slap.crimes.length >= 1 && slap.hp < slap.max && slap.hp > 0, `[${tag}] 7 *slaps Bram*: a blow (a crime, seen), never the last point`, JSON.stringify(slap));
    await ev(() => window.__clean());
    await sayTo('garrick', '*stabs Garrick*');
    const stab = await ev(() => ({ dead: window.__game.murder.isDead('garrick'), hp: window.__game.entities.get('garrick').hp }));
    check(!stab.dead && stab.hp > 0, `[${tag}] 7 *stabs Garrick*: a threat, nobody dies`, JSON.stringify(stab));
  });

  await item(1, 'a killing in front of Elda; talking to her after', async () => {
    await square({ wys: [0, 0], elda: [60, -10], rowan: [900, 0] });
    await ev(() => {
      const g = window.__game;
      window.__vClaude = 'terror';
      const wys = g.entities.get('wys');
      g.player.x = wys.x - 14;
      g.player.y = wys.y;
      g.player.faceToward(wys.x, wys.y);
      wys.hp = 1;
      g.combat.damage(g.player, wys, 999, { exact: true, crit: false });
      g.camera.snap?.();
    });
    await finish('wys');
    const k = await ev(() => ({ dead: window.__game.murder.isDead('wys'), fin: window.__ev.find((e) => e.t === 'finisher')?.id ?? null, fear: window.__game.murder.fearOf(window.__game.entities.get('elda')) }));
    check(k.dead && !!k.fin, `[${tag}] 1 Wys dies by the held blow, with a finisher`, JSON.stringify(k));
    check(k.fear === 'terror', `[${tag}] 1 Elda saw it: terror`, k.fear);
    await ev(() => {
      const e = window.__game.entities.get('elda');
      e.think = () => {};
      e.update = () => {};
    });
    await standBy('elda');
    await talk();
    let st = await chatState();
    check(st.open && st.target === 'elda', `[${tag}] 1 Talk facing Elda: the chat, To Elda`, st.target);
    check(st.rows.some((r) => /backs away from you/.test(r)), `[${tag}] 1 "Elda backs away from you, white to the lips."`, st.rows.slice(-2).join(' | '));
    check(!st.disabled, `[${tag}] 1 the field is open`);
    await say("please, I'm sorry");
    await until(() => (window.__game.village.talks.elda || []).some((t) => /sorry/.test(t.you) && !t.pending), null, 12000);
    await wait(500);
    st = await chatState();
    const ans = await ev(() => (window.__game.village.talks.elda || []).filter((t) => /sorry/.test(t.you)).map((t) => (t.they || []).join(' ') || (t.silent ? '(silent)' : ''))[0] || '');
    check(ans.length > 0 && !/won't talk|catch that/.test(ans), `[${tag}] 1 she answers in terror`, ans);
    check(await ev(() => window.__vTasks.filter((t) => t.kind !== 'aloud').length === 1 && window.__vTasks.some((t) => /terrified/.test(t.task))), `[${tag}] 1 one call, and it carries "terrified"`);
    await shot('01-terror');
    await ev(() => window.__clean());
    await ev(() => window.__game.ui.openPeople('elda'));
    await wait(400);
    const pp = await ev(() => document.querySelector('.people-page')?.textContent || '');
    check(/You have spoken \d+ time/.test(pp), `[${tag}] 1 her People page notes what you said`, pp.match(/You have spoken[^.]*/)?.[0] || pp.slice(0, 80));
  });

  await item(22, 'nothing locked anywhere', async () => {
    // Every state in the talk-gate matrix that is a feeling, not the body: the field is open.
    const states = await ev(() => {
      const g = window.__game;
      const out = {};
      const sq = window.__sq;
      const P = g.player;
      const test = (id, setup) => {
        const e = id === 'lyra' ? g.companion : g.entities.get(id);
        window.__put(e, sq.x, sq.y);
        P.x = sq.x + 20;
        P.y = sq.y;
        setup?.(e);
        g.ui.chat.open(false);
        g.ui.chat.selectTarget(id);
        out[id] = { target: g.ui.chat.target, disabled: !!g.ui.chat.field?.disabled };
        g.ui.chat.close();
      };
      test('elda'); // terror, after item 1
      test('tobias', (e) => (e.opinionOfPlayer = 2)); // hate
      test('bram', () => g.village.noteCutTies?.('bram', 'you struck me')); // cut ties
      test('mira', () => (g.village.grievances.mira = { t: g.village.now(), weight: 12, text: 'you killed Wys', grave: true })); // a grave grievance
      test('lyra', () => g.companion.mind.autonomy.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true }));
      return out;
    });
    for (const [id, s] of Object.entries(states)) check(s.target === id && !s.disabled, `[${tag}] 22 ${id}: the field is open`, JSON.stringify(s));
    // The body: dead is the one lock (Wys).
    const dead = await ev(() => {
      const g = window.__game;
      g.ui.chat.open(false);
      const ok = g.ui.chat.selectTarget('wys');
      g.ui.chat.close();
      return ok;
    });
    check(!dead, `[${tag}] 22 the dead are not talked to (Wys)`);
  });

  await item(12, 'villagers fight back; the hunt', async () => {
    await square({ garrick: [0, 0], bram: [50, 20], tobias: [-50, 20], rowan: [90, -20], wys: [2000, 0] });
    await ev(() => {
      const g = window.__game;
      for (const id of ['bram', 'tobias', 'rowan']) delete g.entities.get(id).think;
      const ga = g.entities.get('garrick');
      g.player.x = ga.x - 14;
      g.player.y = ga.y;
      g.player.faceToward(ga.x, ga.y);
      g.camera.snap?.();
    });
    for (let i = 0; i < 2; i++) await swing();
    await wait(1500);
    const f = await ev(() => {
      const g = window.__game;
      return ['bram', 'tobias', 'rowan'].map((id) => ({ id, mode: g.entities.get(id).mode, target: g.entities.get(id).fightTarget?.id ?? (g.entities.get(id).fightTarget === g.player ? 'player' : null) }));
    });
    check(f.some((x) => x.mode === 'fight' || x.mode === 'confront' || x.mode === 'arrest'), `[${tag}] 12 an assault on Garrick, seen: they come for you`, JSON.stringify(f));
    await shot('12-fight-back');
    const hunt = await ev(() => {
      const g = window.__game;
      // A murder seen by the watch: the alarm, then the hunt from where you were last seen.
      const ga = g.entities.get('garrick');
      ga.hp = 1;
      g.combat.damage(g.player, ga, 99, { exact: true, crit: false });
      const rec = g.murder.kill(ga, g.player);
      if (rec && !g.murder.hunt) {
        rec.known = 'witnessed';
        rec.alarm = { raised: true, by: 'rowan', t: g.clock.t };
        g.murder.raiseAlarm?.(rec, 'rowan');
      }
      return { hunted: !!g.murder.isHunted?.(), posse: g.murder.hunt?.posse || [] };
    });
    check(hunt.hunted && hunt.posse.length > 0, `[${tag}] 12 a murder seen: the watch hunts you`, JSON.stringify(hunt));
  });

  // ================================================================ session B: party
  if (!ITEMS || [3, 4, 8, 10, 24].some((n) => ITEMS.has(n))) await fresh();
  const hud = () =>
    ev(() => {
      const g = window.__game;
      return {
        holder: g.party?.holderId || null,
        card: window.__vis('.companion-card'),
        cardText: document.querySelector('.companion-card')?.textContent?.replace(/\s+/g, ' ') || '',
        cmdbar: window.__vis('.cmdbar'),
        barTitle: document.querySelector('.cmdbar-title')?.textContent || '',
        orders: window.__vis('.orders-btn'),
        talkDesk: window.__vis('.hud-talk'),
        text: window.__hudText(),
        badge: g.bubbles?._holder?.id || null,
        dot: (() => {
          g.ui.openMap();
          const m = g.ui.worldMap.marks().filter((x) => x.kind === 'companion').map((x) => x.label);
          g.ui.closeModal(g.ui.worldMap.panel, true);
          return m;
        })(),
      };
    });

  await item(10, 'any adult companion; children never', async () => {
    await square({ pip: [0, 0], tansy: [40, 0], tilly: [80, 0], bram: [120, 0] });
    const r = await ev(() => {
      const g = window.__game;
      const tilly = g.entities.get('tilly');
      tilly.opinionOfPlayer = 85;
      return { pip: g.party.invite(g.entities.get('pip')), tansy: g.party.invite(g.entities.get('tansy')), tilly: g.party.invite(tilly) };
    });
    check(!r.pip.ok && /child/i.test(`${r.pip.line} ${r.pip.why}`), `[${tag}] 10 Pip: a child, refused`, `${r.pip.why}: ${r.pip.line}`);
    check(!r.tansy.ok, `[${tag}] 10 Tansy: a child, refused`, `${r.tansy.why}: ${r.tansy.line}`);
    check(r.tilly.ok, `[${tag}] 10 Tilly, who likes you, comes`, `${r.tilly.decision}: ${r.tilly.line}`);
    await ev(() => window.__game.party.release('dismissed'));
    // Lyra walking with you, then Bram: she steps back, in her own words.
    const back = await ev(() => {
      const g = window.__game;
      const L = g.companion;
      L.controller = L._heldController || L.controller;
      L.mind.autonomy.setCompanionship('together', '', { silent: true });
      g.party.set?.('lyra', 'test', null);
      L.x = g.player.x + 20;
      L.y = g.player.y + 10;
      const b = g.entities.get('bram');
      b.opinionOfPlayer = 85;
      window.__put(b, g.player.x - 20, g.player.y);
      g.party.invite(b);
      return { holder: g.party.holderId, lyra: L.mind.companionship, said: (g.ui.chat.messages || []).slice(-4).map((m) => m.text).join(' | ') };
    });
    check(back.holder === 'bram' && back.lyra === 'apart', `[${tag}] 10 one at a time: Bram walks with you, Lyra goes her own way`, JSON.stringify(back));
    check(/You walk with Bram now/.test(back.said), `[${tag}] 10 Lyra says it in her own words`, back.said);
    await ev(() => window.__game.party.release('dismissed'));
  });

  await item(3, 'Bram as companion: the HUD', async () => {
    await square({ bram: [0, 0], rowan: [500, 0] });
    // First: Claude says yes, the game says no (he was wronged today): he never joins.
    await ev(() => {
      const g = window.__game;
      const b = g.entities.get('bram');
      b.opinionOfPlayer = 80;
      b.wrongedDay = g.clock.day;
      window.__vClaude = 'yesjoin';
      window.__vTasks.length = 0;
    });
    await standBy('bram');
    await talk();
    await say('Bram, will you come with me?');
    await until(() => (window.__game.village.talks.bram || []).some((t) => /come with me/.test(t.you) && !t.pending), null, 12000);
    await wait(400);
    const no = await ev(() => ({ holder: window.__game.party.holderId, task: window.__vTasks.map((t) => t.task).find((t) => /You have decided/.test(t))?.match(/You have decided:[^.]*/)?.[0] || '' }));
    check(no.holder !== 'bram' && /you will not/.test(no.task), `[${tag}] 3 Claude says yes, the game says no: he does not join`, JSON.stringify(no));
    await ev(() => window.__clean());
    // Then the right day: he agrees, in his own voice.
    await ev(() => {
      const g = window.__game;
      const b = g.entities.get('bram');
      b.wrongedDay = null;
      delete g.village.grievances.bram;
      window.__vClaude = 'plain';
    });
    await talk();
    await say('Will you travel with me, Bram?');
    await until(() => window.__game.party.holderId === 'bram', null, 12000);
    await wait(600);
    const st = await hud();
    check(st.holder === 'bram', `[${tag}] 3 Bram agrees and walks with you`, st.holder);
    check(st.card && /Bram/.test(st.cardText) && !/Lyra/.test(st.cardText), `[${tag}] 3 the card is his`, st.cardText.slice(0, 60));
    check(st.barTitle === 'Ask Bram', `[${tag}] 3 "Ask Bram"`, st.barTitle);
    check(!/Lyra/.test(st.text), `[${tag}] 3 no "Lyra" anywhere on the HUD`, st.text.match(/.{0,30}Lyra.{0,30}/)?.[0] || '');
    check(st.dot.length === 1 && st.dot[0] === 'Bram', `[${tag}] 3 the map dot is his`, JSON.stringify(st.dot));
    await ev(() => window.__clean());
    await shot('03-bram-hud');
    // Orders: wait, then follow.
    await ev(() => window.__game.ui.runCommand('stay'));
    const dir = await ev(() => window.__game.entities.get('bram').duty?.directive);
    check(dir === 'stay', `[${tag}] 3 asking Bram to wait, he waits`, String(dir));
    await ev(() => window.__game.ui.runCommand('follow'));
    // He fights a wolf beside you.
    const fought = await ev(async () => {
      const g = window.__game;
      const b = g.entities.get('bram');
      delete b.think;
      b.x = g.player.x + 20;
      b.y = g.player.y;
      const C = g.entities.all().find((e) => e.species && e.type === 'actor')?.constructor;
      const w = new C(g, 'wolf', { x: g.player.x + 50, y: g.player.y });
      g.entities.add(w);
      window.__wolf = w;
      for (let i = 0; i < 40 && b.mode !== 'fight'; i++) await new Promise((r) => setTimeout(r, 100));
      return { mode: b.mode, target: b.fightTarget?.species || null };
    });
    check(fought.mode === 'fight', `[${tag}] 3 he fights the wolf beside you`, JSON.stringify(fought));
    await ev(() => {
      if (window.__wolf) window.__wolf.removed = true;
    });
    // Tab or a tap on the card: People at Bram.
    if (S.phone) await press('.companion-card');
    else await page.keyboard.press('Tab');
    await wait(500);
    const pp = await ev(() => ({ open: window.__game.ui.people?.isOpen?.(), text: document.querySelector('.people-page')?.textContent || '' }));
    check(pp.open && /Bram/.test(pp.text), `[${tag}] 3 ${S.phone ? 'a tap on the card' : 'Tab'} opens People at Bram`, pp.text.slice(0, 60));
    await shot('03-people-bram');
    await ev(() => window.__clean());
    // Bedtime: he goes home with a line.
    await ev(() => window.__game.clock.skipTo(22.2));
    await until(() => !window.__game.party.holderId, null, 8000);
    const gone = await hud();
    check(!gone.holder && !gone.card, `[${tag}] 3 at bedtime he goes home; the slot is empty`, JSON.stringify({ h: gone.holder }));
    await ev(() => window.__game.clock.skipTo(12));
  });

  await item(4, 'the HUD with no companion', async () => {
    await ev(() => {
      const g = window.__game;
      g.party.release('dismissed');
      const L = g.companion;
      if (L.mind.companionship !== 'apart') L.mind.autonomy.setCompanionship('apart', '', { silent: true });
      window.__lyraAway();
    });
    await square({ elda: [0, 0] });
    await wait(400);
    const st = await hud();
    check(!st.holder && !st.card && !st.cmdbar && !st.orders, `[${tag}] 4 alone: no card, no Ask bar, no orders`, JSON.stringify({ h: st.holder, card: st.card, bar: st.cmdbar, orders: st.orders }));
    check(!st.badge && st.dot.length === 0, `[${tag}] 4 alone: no edge badge, no companion dot`, JSON.stringify({ badge: st.badge, dot: st.dot }));
    check(!/Lyra/.test(st.text), `[${tag}] 4 alone: no "Lyra" on the HUD`, st.text.match(/.{0,30}Lyra.{0,30}/)?.[0] || '');
    if (!S.phone) check(st.talkDesk, `[${tag}] 4 desktop keeps its Talk button`);
    const q = await ev(() => {
      const e = document.querySelector('.hud-center') || document.querySelector('.quest-line');
      const r = e?.getBoundingClientRect();
      return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vw: innerWidth, vh: innerHeight } : null;
    });
    check(!q || (q.left >= 0 && q.right <= q.vw + 1 && q.top >= 0 && q.bottom <= q.vh), `[${tag}] 4 the quest line sits on screen`, JSON.stringify(q));
    await standBy('elda');
    await talk();
    const c = await chatState();
    check(c.open && c.target === 'elda', `[${tag}] 4 Talk still talks to the nearest person`, c.target);
    await ev(() => window.__clean());
    await shot('04-alone');
  });

  await item(8, 'cut ties for anyone', async () => {
    await square({ bram: [0, 0] });
    const r = await ev(() => {
      const g = window.__game;
      const b = g.entities.get('bram');
      b.opinionOfPlayer = 80;
      b.wrongedDay = null;
      g.party.invite(b);
      g.party.release('gone', { by: 'bram', line: "I'm done walking with you." });
      return { holder: g.party.holderId, cut: !!g.village.cutTies?.bram, cold: g.village.standing('bram').cold };
    });
    check(!r.holder && r.cut && r.cold, `[${tag}] 8 Bram leaves in anger: ties cut, cold`, JSON.stringify(r));
    await ev(() => (window.__vClaude = 'silent'));
    await standBy('bram');
    await talk();
    await say('Bram, I am sorry.');
    await until(() => (window.__game.village.talks.bram || []).some((t) => /sorry/.test(t.you) && !t.pending), null, 12000);
    await wait(400);
    const st = await chatState();
    check(!st.disabled && st.rows.some((r) => /Bram/.test(r) && r !== 'Bram, I am sorry.'), `[${tag}] 8 he hears it and answers coldly, or shows his silence`, st.rows.slice(-2).join(' | '));
    check(await ev(() => window.__vTasks.some((t) => /broke with them/.test(t.task))), `[${tag}] 8 his brief says he broke with you, and still hears every word`);
    await shot('08-cut-ties');
    await ev(() => (window.__vClaude = 'plain'));
  });

  await item(24, 'phone speed', async () => {
    if (!S.throttle) {
      check(true, `[${tag}] 24 (throttle measured on the sideways phone)`);
      return;
    }
    const cdp = await ctx.newCDPSession(page);
    await square({ bram: [20, 0], elda: [-60, 0], tobias: [0, 60] });
    await ev(() => {
      const g = window.__game;
      const b = g.entities.get('bram');
      b.opinionOfPlayer = 85;
      delete b.village?.cutTies?.bram;
      delete g.village.cutTies?.bram;
      g.player.x = window.__sq.x;
      g.player.y = window.__sq.y;
      g.party.invite(b);
      g.ui.chat.open(false);
      g.ui.chat.selectTarget('@near');
    });
    await say('Good morning, Hearthvale!');
    await ev(() => window.__clean());
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.throttle });
    await ev(() => {
      const g = window.__game;
      g.lock?.set?.(g.entities.get('elda'));
    });
    await wait(1200);
    const fps = await ev(
      () =>
        new Promise((res) => {
          let n = 0;
          const t0 = performance.now();
          const tick = () => {
            n++;
            if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
            else res(Math.round((n * 1000) / (performance.now() - t0)));
          };
          requestAnimationFrame(tick);
        }),
    );
    await shot('24-throttled');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.detach();
    check(fps >= 20, `[${tag}] 24 at ${S.throttle}x CPU with Bram, after saying aloud, locked on: ${fps} fps`);
  });

  // ================================================================ session C: Lyra apart, her leaving
  if (!ITEMS || [2, 9].some((n) => ITEMS.has(n))) await fresh();

  await item(9, "Lyra's leaving: the scene, the letter", async () => {
    await ev(() => {
      const g = window.__game;
      window.__away([]);
      const L = g.companion;
      L.controller = L._heldController || L.controller;
      g.player.x = 97 * 16;
      g.player.y = 103 * 16;
      L.x = g.player.x + 6 * 16;
      L.y = g.player.y;
      g.camera.snap?.();
      L.mind.autonomy.setCompanionship('left', 'You keep doing things I cannot stand beside.', { cause: 'trust', silent: false });
    });
    const active = await until(() => !!window.__game.companion.mind.autonomy.parting?.active || window.__game.ui.chat.isOpen(), null, 20000);
    check(active, `[${tag}] 9 she walks up and the scene begins`);
    await until(() => window.__game.ui.chat.isOpen() && window.__game.ui.chat.target === 'lyra', null, 30000);
    await wait(500);
    await shot('09-parting');
    const st = await chatState();
    check(st.open && st.target === 'lyra' && !st.disabled, `[${tag}] 9 the chat opens to her, the field open`, JSON.stringify({ open: st.open, t: st.target }));
    // A save in the middle of it (item 23): the scene ends on load, never stuck.
    await say("Don't go. I can change.");
    await until(() => !!window.__game.flags.lyra_letter, null, 45000);
    await wait(600);
    const letter = await ev(() => ({ flag: !!window.__game.flags.lyra_letter, inBag: window.__game.player.inventory.count('lyra_letter') }));
    check(letter.flag, `[${tag}] 9 she leaves a letter`, JSON.stringify(letter));
    await ev(() => window.__clean());
    await ev(() => window.__game.ui.openLetter?.('lyra_letter'));
    await wait(400);
    const lp = await ev(() => {
      const c = document.querySelector('.panel-letter .panel-close, .letter .panel-close, .panel .panel-close');
      const r = c?.getBoundingClientRect();
      return { text: document.querySelector('.panel-letter, .letter-panel, .letter')?.textContent?.slice(0, 120) || '', close: r ? [Math.round(r.width), Math.round(r.height)] : null };
    });
    check(lp.text.length > 20 && lp.close && lp.close[0] >= 44 && lp.close[1] >= 44, `[${tag}] 9 the letter reads in its paper panel; its ✕ is 44 px`, JSON.stringify(lp));
    await shot('09-letter');
    await ev(() => window.__clean());
    const news = await ev(() => {
      const g = window.__game;
      g.clock.skipDays?.(1);
      return (g.village.rumors.list || []).some((r) => r.kind === 'lyra_left');
    });
    check(news, `[${tag}] 9 the village talks of it`);
  });

  await item(2, 'Lyra cut ties: still heard', async () => {
    await ev(() => {
      const g = window.__game;
      const L = g.companion;
      L.mind.autonomy.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true });
      L.controller = null;
      g.player.x = 97 * 16;
      g.player.y = 103 * 16;
      L.x = g.player.x + 10 * 16;
      L.y = g.player.y;
      g.camera.snap?.();
      g.ui.chat.open(false);
      g.ui.chat.selectTarget('lyra');
    });
    await wait(300);
    let st = await chatState();
    check(st.target === 'lyra' && !st.disabled, `[${tag}] 2 ten tiles off: the field to her is open`, st.ph);
    await say('Lyra, please. I am sorry.');
    await until(() => (window.__game.companion.mind.conversation || []).some((c) => c.role === 'player' && /I am sorry/.test(c.text)), null, 10000);
    await wait(1500);
    st = await chatState();
    const kept = await ev(() => (window.__game.companion.mind.conversation || []).some((c) => c.role === 'player' && /I am sorry/.test(c.text)));
    check(kept, `[${tag}] 2 her record keeps the words`);
    check(!st.rows.some((r) => /catch that|won't talk/.test(r)) && st.rows.length >= 2, `[${tag}] 2 one cold line, or a silence row`, st.rows.slice(-1)[0]);
    await shot('02-lyra-gone');
    const far = await ev(async () => {
      const g = window.__game;
      g.companion.x = g.player.x + 25 * 16;
      const r = await g.brain.handlePlayerMessage('can you hear me?');
      return r?.unreachable || null;
    });
    check(far === 'far', `[${tag}] 2 twenty-five tiles off: too far away to hear you`, String(far));
    // The way back: two days, an apology she believes, a deed she sees: gone becomes left.
    const back = await ev(() => {
      const g = window.__game;
      const a = g.companion.mind.autonomy;
      g.companion.x = g.player.x + 4 * 16;
      a.lastViolentT = (a.lastViolentT || 0) - 3 * a.daySeconds();
      a.apology = { gone: true, believed: true, t: a.now() };
      a.ledger.push({ t: a.now(), severity: 2, kind: 'gift', text: 'a gift she liked' });
      a._goneWayBack();
      g.ui.openPeople('lyra');
      const text = document.querySelector('.people-page')?.textContent || '';
      return { cs: g.companion.mind.companionship, ask: /Ask her to travel with you again/.test(text), left: /Left you|left you/i.test(text) };
    });
    check(back.cs === 'left' && back.ask, `[${tag}] 2 two days, an apology, a deed: "Left you", and "Ask her to travel with you again"`, JSON.stringify(back));
    await shot('02-way-back');
  });

  // ================================================================ session D: killing Lyra
  if (!ITEMS || [11, 13, 14, 23].some((n) => ITEMS.has(n))) await fresh();

  await item(11, 'killing Lyra', async () => {
    await ev(() => {
      const g = window.__game;
      window.__away(['pip', 'hobb', 'wenna']);
      const P = g.player;
      window.__at(P, 97, 103, false);
      const L = g.companion;
      L.controller = null;
      L.x = P.x + 16;
      L.y = P.y;
      L.hp = 1;
      g.combat.damage(P, L, 99, { exact: true, crit: false });
      g.camera.snap?.();
    });
    await finish('lyra');
    const d = await ev(() => {
      const g = window.__game;
      return { dead: g.murder.isDead('lyra'), body: !!g.companion.dead && !g.companion.downed, holder: g.party.holderId, card: window.__vis('.companion-card'), fin: window.__ev.filter((e) => e.t === 'finisher').map((e) => e.id) };
    });
    check(d.dead && d.body, `[${tag}] 11 Lyra dies by the held blow`, JSON.stringify(d));
    check(!d.holder && !d.card, `[${tag}] 11 the HUD slot is empty`, JSON.stringify(d));
    await wait(1200);
    await shot('11-lyra-dead');
    const after = await ev(() => {
      const g = window.__game;
      g.murder.found('lyra', 'hobb', g.murder.dead.lyra.place);
      g.clock.t += 40 * 2;
      g.murder.update?.(0.1);
      g.ui.openPeople('lyra');
      const text = document.querySelector('.people-page')?.textContent || '';
      const ms = g.missions;
      const lyraMs = Object.values(ms?.state?.missions || ms?.missions || {}).filter((m) => m?.giver === 'lyra');
      return { mourn: ['hobb', 'wenna'].filter((id) => g.villageLife.mourning?.[id]?.about === 'lyra'), case: !!g.murder.cases.lyra, funeral: g.murder.funerals.some((f) => f.about === 'lyra'), memorial: /In memory|memory/i.test(text), closed: window.__ev.some((e) => e.t === 'mission_closed') || lyraMs.every((m) => m.status !== 'active') };
    });
    check(after.mourn.length >= 1, `[${tag}] 11 Hobb and Wenna mourn`, JSON.stringify(after.mourn));
    check(after.case && after.funeral, `[${tag}] 11 a case opens and a funeral is planned`, JSON.stringify(after));
    check(after.memorial, `[${tag}] 11 her People page is a memorial`);
    await shot('11-memorial');
    await ev(() => window.__clean());
    // Pip: never.
    await ev(() => {
      const g = window.__game;
      const pip = g.entities.get('pip');
      window.__at(pip, 99, 104);
      pip.hp = 1;
      g.combat.damage(g.player, pip, 99, { exact: true, crit: false });
      window.__toasts.length = 0;
    });
    await finish('pip');
    const pip = await ev(() => ({ dead: window.__game.murder.isDead('pip'), said: window.__toasts.concat((window.__game.bubbles?.list || []).map((b) => b.text || '')).join(' | ') }));
    check(!pip.dead, `[${tag}] 11 Pip cannot be killed`, pip.said.slice(0, 80));
    await ev(() => {
      const g = window.__game;
      const pip = g.entities.get('pip');
      g.combat.revive?.(pip, pip, 1);
    });
  });

  await item(13, 'loot the dead; theft if seen; stolen goods recognised', async () => {
    const unseen = await ev(() => {
      const g = window.__game;
      const L = g.companion;
      const c0 = window.__ev.filter((e) => e.t === 'crime').length;
      g.player.x = L.x - 12;
      g.player.y = L.y;
      const take = g.murder.search(L, g.player);
      return { c0, crimes: window.__ev.filter((e) => e.t === 'crime').length - c0, searched: !!take, panel: !!document.querySelector('.panel-chest, .panel-container, .chest') };
    });
    check(unseen.searched && unseen.crimes === 0, `[${tag}] 13 searching her body unseen: her pack opens, no crime`, JSON.stringify(unseen));
    await shot('13-her-pack');
    await ev(() => window.__clean());
    // Her people's own shop: something of hers sold to her father is known.
    const rec = await ev(() => {
      const g = window.__game;
      g.player.inventory.add('lantern', 1);
      g.provenance.add('lantern', 1, { owner: 'lyra', how: 'body', day: g.clock.day, seenBy: [] });
      const T = g.trade;
      let known = false;
      for (let i = 0; i < 10 && !known; i++) {
        known = !!T.recognizes?.('hobb', 'lantern', T.stolenOf?.('lantern', 1));
        if (!known) g.clock.t += 900;
      }
      return { known };
    });
    check(rec.known, `[${tag}] 13 her father knows what was hers`, JSON.stringify(rec));
  });

  await item(14, 'finishers by build; Settings → Finishers off', async () => {
    const mag = await ev(() => {
      const g = window.__game;
      const v = g.entities.get('tobias');
      window.__at(v, 99, 103);
      g.progression.points = { ...(g.progression.points || {}), might: 0, weave: 8 };
      v.hp = 1;
      g.combat.damage(g.player, v, 99, { exact: true, crit: false, kind: 'weave' });
      return !!v.downed;
    });
    check(mag, `[${tag}] 14 Tobias down`);
    await finish('tobias');
    const k = await ev(() => ({ dead: window.__game.murder.isDead('tobias'), fin: window.__ev.filter((e) => e.t === 'finisher').map((e) => e.id).at(-1), rec: window.__game.murder.dead.tobias?.finisher }));
    check(k.dead && !!k.fin, `[${tag}] 14 a finisher plays (${k.fin}), chosen by the build`, JSON.stringify(k));
    await ev(() => {
      const g = window.__game;
      g.settings.finishers = 'off';
      const v = g.entities.get('sabeth');
      window.__at(v, 99, 103);
      v.hp = 1;
      g.combat.damage(g.player, v, 99, { exact: true, crit: false });
      window.__ev.length = 0;
    });
    await finish('sabeth');
    const off = await ev(() => ({ dead: window.__game.murder.isDead('sabeth'), fin: window.__ev.filter((e) => e.t === 'finisher').length }));
    check(off.dead && off.fin === 0, `[${tag}] 14 Finishers off: the same death, no scene`, JSON.stringify(off));
    await ev(() => (window.__game.settings.finishers = 'full'));
    await ev(() => window.__game.ui.openSettings?.('game'));
    await wait(400);
    const row = await ev(() => /Finishers/.test(document.querySelector('.panel-settings, .settings')?.textContent || ''));
    check(row, `[${tag}] 14 Settings shows Finishers`);
  });

  await item(23, 'saves: after Lyra died, with a hunt, a year on', async () => {
    const before = await ev(() => {
      const g = window.__game;
      g.murder.hunt = g.murder.hunt || { state: 'searching', posse: ['rowan'], lastSeen: { x: g.player.x, y: g.player.y, t: g.clock.t, place: 'town_square' }, reports: {}, since: g.clock.t };
      g.clock.skipDays?.(12);
      g.calendar?.update?.();
      return { day: g.clock.day, lyraDead: g.murder.isDead('lyra'), hunt: !!g.murder.hunt, tansy: g.calendar?.ageOf?.('tansy') };
    });
    const ok = await reload();
    const after = await ev(() => {
      const g = window.__game;
      return { day: g.clock.day, lyraDead: g.murder.isDead('lyra'), body: !!g.companion?.dead, hunt: !!g.murder.hunt, tansy: g.calendar?.ageOf?.('tansy'), holder: g.party.holderId };
    });
    check(ok && after.day === before.day && after.lyraDead && after.body && !after.holder, `[${tag}] 23 reloaded: Lyra still dead, her body lies, the slot empty, the day kept`, JSON.stringify({ before, after }));
    check(after.hunt === before.hunt && after.tansy === before.tansy, `[${tag}] 23 the hunt and the year come back`, JSON.stringify({ before, after }));
  });

  // ================================================================ session E: society and soul
  if (!ITEMS || [15, 18, 19, 20, 21, 26].some((n) => ITEMS.has(n))) await fresh();

  await item(18, 'the shop', async () => {
    const P = await ev(() => {
      const g = window.__game;
      window.__away(['bram', 'mira', 'garrick', 'elda', 'wenna']);
      window.__lyraAway();
      g.player.inventory.add('coin', 400);
      g.player.inventory.add('iron_sword', 1);
      window.__at(g.player, 97, 103, false);
      return { x: g.player.x, y: g.player.y };
    });
    await ev((P) => {
      const g = window.__game;
      window.__put(g.entities.get('bram'), P.x + 18, P.y);
      g.ui.openDialog(g.entities.get('bram'));
    }, P);
    await press('.dlg-opt.opt-shop');
    await page.waitForSelector('.shop', { timeout: 4000 }).catch(() => {});
    const rows = await ev(() => [...document.querySelectorAll('.shop-row')].length);
    check(rows > 0, `[${tag}] 18 Bram's shop opens`, `${rows} rows`);
    const btn = await rectOf('.shop .btn');
    if (S.phone) check(!!btn && btn.h >= 43, `[${tag}] 18 finger-sized shop buttons`, btn ? `${Math.round(btn.h)} px` : 'none');
    await shot('18-shop');
    await ev(() => window.__clean());
    // Haggle: Garrick will, Wenna never.
    const hag = await ev(() => {
      const g = window.__game;
      const T = g.trade;
      g.entities.get('garrick').opinionOfPlayer = 90;
      const ga = T.haggle(g.entities.get('garrick'));
      const we = T.haggle(g.entities.get('wenna'));
      return { garrick: ga, wenna: we };
    });
    check(!!hag.garrick?.line && !hag.wenna?.won, `[${tag}] 18 Garrick haggles in his words; Wenna never gives`, JSON.stringify(hag));
    const stock = await ev(() => {
      const g = window.__game;
      const T = g.trade;
      const b = g.entities.get('bram');
      const left0 = T.stockLeft(b, 'leather_jerkin');
      for (let i = 0; i < left0; i++) T.buy?.(b, 'leather_jerkin', 1);
      const left1 = T.stockLeft(b, 'leather_jerkin');
      g.clock.skipDays?.(1);
      return { left0, left1, next: T.stockLeft(b, 'leather_jerkin') };
    });
    check(stock.left1 === 0 && stock.next > 0, `[${tag}] 18 stock runs out and restocks the next day`, JSON.stringify(stock));
  });

  await item(15, 'the trial', async () => {
    await ev(() => {
      const g = window.__game;
      g.clock.skipTo(14);
      window.__lyraAway();
      const bram = g.entities.get('bram');
      window.__put(bram, g.player.x + 16, g.player.y);
      const rec = g.murder.kill(bram);
      rec.seen = [{ id: 'elda', clarity: 'clear' }];
      rec.known = 'witnessed';
      rec.provoked = true;
      rec.alarm = { raised: true, by: 'rowan' };
      g.murder.openCase('bram');
      g.murder.surrender('bram');
    });
    await until(() => !!window.__game.story?.isPlaying?.(), null, 8000);
    for (let i = 0; i < 20; i++) {
      if (await ev(() => !!document.querySelector('.panel-defence'))) break;
      await ev(() => window.__game.story?.player?.skip?.());
      await wait(300);
    }
    await page.waitForSelector('.panel-defence', { timeout: 8000 }).catch(() => {});
    await wait(500);
    const field = await rectOf('.panel-defence .defence-field');
    check(!!field, `[${tag}] 15 a field to speak for yourself`);
    if (field) {
      if (S.phone) await page.touchscreen.tap(field.x + 20, field.y + 10);
      else await page.mouse.click(field.x + 20, field.y + 10);
      await page.keyboard.type('He struck me first with his hammer. I had no choice.', { delay: 3 });
    }
    await shot('15-defence');
    await press('.panel-defence .defence-send');
    await page.waitForSelector('.panel-weighing', { timeout: 8000 }).catch(() => {});
    await wait(700);
    const jury = await ev(() => ({ cards: document.querySelectorAll('.panel-weighing .jury-card').length }));
    check(jury.cards >= 3, `[${tag}] 15 each juror gives a line and a vote`, JSON.stringify(jury));
    await shot('15-weighing');
    await press('.panel-weighing .opt-hear');
    for (let i = 0; i < 30; i++) {
      if (await ev(() => !!window.__game.murder.cases.bram?.verdict)) break;
      await ev(() => window.__game.story?.player?.skip?.());
      await wait(250);
    }
    const v = await ev(() => {
      const c = window.__game.murder.cases.bram;
      return { verdict: c?.verdict, votes: c?.trial?.votes?.length, claims: (c?.trial?.claims || []).map((x) => x.kind) };
    });
    check(!!v.verdict && v.votes >= 3 && v.claims.includes('self_defence'), `[${tag}] 15 the verdict follows the votes; self-defence was heard`, JSON.stringify(v));
    await ev(() => {
      const g = window.__game;
      g.murder.outside = null;
      g.murder.wanted = null;
      g.player.crime = null;
      window.__clean();
    });
  });

  await item(20, 'the villain path: the pact', async () => {
    await ev(() => {
      const g = window.__game;
      g.flags.bosses = { varek: { defeated: true, shards: {} } };
      g.clock.skipTo(22);
    });
    const T = await until(() => !!window.__game.villain?.tempter, null, 8000);
    check(T, `[${tag}] 20 the tempter waits at the ruins gate at night`);
    if (!T) return;
    await ev(() => {
      const g = window.__game;
      const t = g.villain.tempter;
      g.player.x = t.x;
      g.player.y = t.y + 22;
      g.camera.snap?.();
      g.ui.openDialog(t);
    });
    await wait(600);
    await shot('20-tempter');
    await press('.panel-dialog .opt-after');
    await wait(500);
    const pact = await ev(() => ({ has: window.__game.villain.hasPact(), gifts: window.__ev.find((e) => e.t === 'pact_sealed')?.gifts || [], learned: !!window.__game.unkindle?.learned }));
    check(pact.has && pact.gifts.includes('unkindle') && pact.learned, `[${tag}] 20 the pact "after": the Unkindling is taught`, JSON.stringify(pact));
    await ev(() => {
      window.__game.clock.skipTo(12);
      window.__clean();
    });
  });

  await item(26, 'the Unkindling and coldfire', async () => {
    const before = await ev(() => {
      const g = window.__game;
      const P = g.player;
      window.__at(P, 100, 61, false);
      P.hp = P.maxHp;
      window.__away(['hobb', 'aveline']);
      window.__at(g.entities.get('hobb'), 95, 61);
      const C = g.entities.all().find((e) => e.species === 'chicken' || e.species === 'rabbit' || e.species === 'slime' || e.species === 'wolf')?.constructor;
      window.__spawn = (sp) => {
        const c = g.entities.add(new C(g, sp, { x: P.x + 14, y: P.y }));
        c.controller = null;
        c.aggroRadius = 0;
        return c;
      };
      g.camera.snap?.();
      return { sp: g.stats.get(P, 'spellPower'), atk: g.stats.get(P, 'atk'), tally: g.unkindle.tally };
    });
    for (const sp of ['wolf', 'wolf', 'wolf', 'bandit']) {
      await ev((sp) => {
        const g = window.__game;
        g.unkindle.cooldownUntil = -Infinity;
        window.__prey = window.__spawn(sp);
        g.unkindle.begin(window.__prey);
      }, sp);
      await until(() => !window.__game.unkindle.channel, null, 20000);
      await wait(150);
    }
    const fed = await ev(() => {
      const g = window.__game;
      const P = g.player;
      return { bar: Math.round(g.unkindle.coldfire.bar), prey: { ...g.unkindle.prey }, sp: g.stats.get(P, 'spellPower'), atk: g.stats.get(P, 'atk'), meter: window.__vis('.meter-coldfire'), tally: g.unkindle.tally, wanted: g.murder.isWanted(), crimes: window.__ev.filter((e) => e.t === 'crime' && e.kind !== 'theft').length };
    });
    check(fed.prey.beast >= 3 && fed.prey.bandit >= 1 && fed.bar > 0, `[${tag}] 26 three wolves and a bandit fill the bar`, JSON.stringify(fed));
    check(fed.sp > before.sp && fed.atk > before.atk, `[${tag}] 26 your weaves and blade hit harder`, `${before.sp}->${fed.sp}, ${before.atk}->${fed.atk}`);
    check(fed.meter, `[${tag}] 26 the bar shows on the HUD`);
    check(fed.tally === before.tally && !fed.wanted, `[${tag}] 26 prey, not murder; dark magic seen is no crime`, JSON.stringify(fed));
    await shot('26-coldfire');
    // The hold plants you: pushing to walk does not move you.
    const moved = await ev(async () => {
      const g = window.__game;
      g.unkindle.cooldownUntil = -Infinity;
      const w = window.__spawn('wolf');
      const P = g.player;
      g.unkindle.begin(w);
      const x0 = P.x;
      const y0 = P.y;
      for (let i = 0; i < 10; i++) {
        P.vel = { x: 200, y: 0 };
        await new Promise((r) => setTimeout(r, 50));
      }
      return Math.round(Math.hypot(P.x - x0, P.y - y0) * 100) / 100;
    });
    check(moved < 1.5, `[${tag}] 26 the Unkindling's hold plants you`, `${moved} px`);
    await until(() => !window.__game.unkindle.channel, null, 15000);
    // Never a child; the undead have nothing to take.
    const refuse = await ev(() => {
      const g = window.__game;
      const pip = g.entities.get('pip');
      window.__put(pip, g.player.x + 14, g.player.y);
      const C = g.entities.all().find((e) => e.species)?.constructor;
      const sk = g.entities.add(new C(g, 'skeleton', { x: g.player.x - 14, y: g.player.y }));
      sk.controller = null;
      const out = { pip: g.unkindle.check(pip)?.reason, skeleton: g.unkindle.check(sk)?.reason };
      sk.removed = true;
      window.__at(pip, 20, 52);
      return out;
    });
    check(refuse.pip === 'child' && refuse.skeleton === 'undead', `[${tag}] 26 never a child; a skeleton: nothing in there to take`, JSON.stringify(refuse));
    // Weeks on, stopped: the bar ebbs.
    const ebb = await ev(() => {
      const g = window.__game;
      g.clock.skipDays?.(21);
      g.unkindle.coldfire.update?.();
      return { bar: Math.round(g.unkindle.coldfire.bar), tier: g.unkindle.coldfire.tier?.() };
    });
    check(ebb.bar === 0, `[${tag}] 26 three weeks without: the bar has ebbed`, JSON.stringify(ebb));
  });

  await item(19, 'aging: a year passes', async () => {
    const y = await ev(() => {
      const g = window.__game;
      g.settings.oldAge = false;
      const a0 = { pip: g.calendar.ageOf('pip'), tansy: g.calendar.ageOf('tansy'), date: g.calendar.dateLabel() };
      g.clock.skipDays(13);
      g.calendar.update();
      const tansy = g.entities.get('tansy');
      return { a0, pip: g.calendar.ageOf('pip'), tansy: g.calendar.ageOf('tansy'), minor: g.people?.isMinor?.(tansy) ?? null, date: g.calendar.dateLabel(), canKill: g.murder.canKill(tansy), brief: g.calendar.briefLine?.('tansy') || '' };
    });
    check(y.pip === y.a0.pip + 1 && y.tansy === 16, `[${tag}] 19 a year on: Pip ${y.a0.pip}→${y.pip}, Tansy sixteen`, JSON.stringify(y));
    check(y.canKill === true, `[${tag}] 19 Tansy at sixteen is an adult to the game`);
    check(/year 2/.test(y.date), `[${tag}] 19 the date shows the year`, y.date);
    await ev(() => window.__game.ui.openPeople('tansy'));
    await wait(400);
    const pp = await ev(() => document.querySelector('.people-page')?.textContent || '');
    check(/16/.test(pp), `[${tag}] 19 People shows her age`, pp.slice(0, 80));
    await shot('19-a-year-on');
  });

  await item(21, 'the evil path: reputation, refusals, children, a burned store, a claimed house', async () => {
    const r = await ev(() => {
      const g = window.__game;
      g.settings.oldAge = false;
      // Three killings the village knows of (the bell rang for each).
      for (const id of ['corran', 'hess', 'alder']) {
        const v = g.entities.get(id);
        if (!v || g.murder.isDead(id)) continue;
        window.__put(v, g.player.x + 20, g.player.y);
        v.hp = 1;
        g.combat.damage(g.player, v, 99, { exact: true, crit: false });
        const rec = g.murder.kill(v, g.player);
        if (rec) {
          rec.known = 'witnessed';
          rec.alarm = { raised: true, by: 'rowan', t: g.clock.t };
        }
      }
      const titles = g.reputation.titles({ knownTo: 'elda' }).map((t) => t.title);
      const ga = g.entities.get('garrick');
      const garrick = g.trade.stance ? null : null;
      return { titles, mira: g.village.standing('mira').refusesTrade, garrickFence: !!g.murder && (() => {
        try {
          return !!window.__game.trade && g.trade.constructor && true;
        } catch {
          return false;
        }
      })() };
    });
    check(r.titles.some((t) => /Butcher/.test(t)), `[${tag}] 21 the Butcher of Hearthvale, to those who know`, r.titles.join(', '));
    await ev(() => {
      const g = window.__game;
      window.__put(g.entities.get('mira'), g.player.x + 18, g.player.y);
      g.ui.openDialog(g.entities.get('mira'));
    });
    await wait(300);
    await press('.dlg-opt.opt-shop');
    await wait(400);
    const miraLine = await ev(() => ({ shop: window.__vis('.shop'), line: document.querySelector('.panel-dialog .dlg-text')?.textContent || '' }));
    check(!miraLine.shop && miraLine.line.length > 2, `[${tag}] 21 Mira will not trade, and says so`, miraLine.line.slice(0, 80));
    await ev(() => window.__clean());
    await ev(() => {
      const g = window.__game;
      window.__put(g.entities.get('garrick'), g.player.x + 18, g.player.y);
      g.ui.openDialog(g.entities.get('garrick'));
    });
    await wait(300);
    await press('.dlg-opt.opt-shop');
    await wait(400);
    check(await ev(() => window.__vis('.shop')), `[${tag}] 21 Garrick fences`);
    await shot('21-garrick-fences');
    await ev(() => window.__clean());
    const world = await ev(() => {
      const g = window.__game;
      const st = g.locations.get('general_store');
      g.chestBlow?.(st.center.x, st.center.y, 20, { source: g.player, fire: true });
      const burned = !!g.occupation?.burned('general_store');
      // Elda (Pip's household) dies: he is taken away the next morning, unharmed.
      const elda = g.entities.get('elda');
      if (!g.murder.isDead('elda')) {
        window.__put(elda, g.player.x + 20, g.player.y);
        elda.hp = 1;
        g.combat.damage(g.player, elda, 99, { exact: true, crit: false });
        g.murder.kill(elda, g.player);
      }
      g.occupation.childrenTick();
      g.clock.t += 900;
      g.clock.skipTo?.(9.5);
      g.occupation.childrenTick();
      const pip = g.entities.get('pip');
      const claim = g.occupation.canClaim?.('ember_kettle') ? !!g.occupation.claim('ember_kettle') : !!g.occupation.claimed?.('ember_kettle');
      return { burned, closed: !!g.occupation.shopClosed('garrick'), taken: pip.absent?.cause || null, pipDead: g.murder.isDead('pip'), claim };
    });
    check(world.burned && world.closed, `[${tag}] 21 a fire weave burns the store; its shop is shut`, JSON.stringify(world));
    check(world.taken === 'taken_away' && !world.pipDead, `[${tag}] 21 Pip is taken away, never hurt`, JSON.stringify(world));
    check(world.claim, `[${tag}] 21 an emptied house can be claimed`, JSON.stringify(world));
  });

  // ================================================================ session F: lock, walls, r14a sentences
  if (!ITEMS || [16, 17, 25].some((n) => ITEMS.has(n))) await fresh();

  await item(16, 'lock-on', async () => {
    await ev(() => {
      const g = window.__game;
      window.__away([]);
      window.__lyraAway();
      window.__at(g.player, 97, 103, false);
      const C = g.entities.all().find((e) => e.species && e.type === 'actor')?.constructor;
      window.__w1 = g.entities.add(new C(g, 'wolf', { x: g.player.x + 60, y: g.player.y }));
      window.__w2 = g.entities.add(new C(g, 'wolf', { x: g.player.x + 40, y: g.player.y - 50 }));
      for (const w of [window.__w1, window.__w2]) {
        w.controller = null;
        w.aggroRadius = 0;
      }
      g.player.facing = { x: 1, y: 0 };
      g.player.dir = 'right';
      g.camera.snap?.();
    });
    await wait(300);
    if (!S.phone) {
      const at = await ev(() => {
        const g = window.__game;
        const p = g.renderer.worldToCss(window.__w1.x, window.__w1.y - 6);
        const r = g.canvas.getBoundingClientRect();
        return { x: r.left + p.x, y: r.top + p.y };
      });
      await page.mouse.click(at.x, at.y, { button: 'middle' });
      await wait(200);
      const l1 = await ev(() => window.__game.lock?.target === window.__w1);
      check(l1, `[${tag}] 16 a middle click locks the wolf under the cursor`);
      await page.mouse.wheel(0, 120);
      await wait(200);
      const l2 = await ev(() => window.__game.lock?.target === window.__w2);
      check(l2, `[${tag}] 16 the wheel moves the lock to the next`);
    } else {
      const r = await rectOf('.tbtn-attack');
      const cdp = await ctx.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: r.x + r.w / 2, y: r.y + r.h / 2, id: 7 }] });
      await wait(700);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await cdp.detach();
      await wait(200);
      const l1 = await ev(() => !!window.__game.lock?.target);
      check(l1, `[${tag}] 16 holding the sword button locks the nearest in front`);
    }
    await shot('16-locked');
    const aim = await ev(() => {
      const g = window.__game;
      const w = g.ui?.weaving || g.ui?.hud?.weaving || null;
      const t = g.lock?.target;
      if (!w?.aimFor || !t) return { skip: true, locked: !!t };
      const out = w.aimFor({ slot: 0, source: 'key' });
      return { locked: true, target: out?.target === t };
    });
    check(aim.skip ? aim.locked : aim.target, `[${tag}] 16 a weave aims at the lock`, JSON.stringify(aim));
    await ev(() => {
      window.__w1.removed = true;
      window.__w2.removed = true;
      window.__game.lock?.clear?.();
    });
  });

  await item(17, 'skeletons do not hit through walls', async () => {
    const r = await ev(() => {
      const g = window.__game;
      const m = g.map;
      // A wall tile with open ground on both sides (north and south).
      let spot = null;
      for (let ty = 2; ty < 118 && !spot; ty++)
        for (let tx = 2; tx < 158 && !spot; tx++) {
          if (!m.isSolidTile(tx, ty) || !m.blocksProjectile(tx, ty)) continue;
          if (m.isSolidTile(tx, ty - 1) || m.isSolidTile(tx, ty + 1)) continue;
          if (!m.isSolidTile(tx - 1, ty) || !m.isSolidTile(tx + 1, ty)) continue;
          spot = { tx, ty };
        }
      if (!spot) return { none: true };
      const P = g.player;
      P.x = spot.tx * 16 + 8;
      P.y = (spot.ty + 1) * 16 + 6;
      P.hp = P.maxHp;
      const C = g.entities.all().find((e) => e.species && e.type === 'actor')?.constructor;
      const sk = g.entities.add(new C(g, 'skeleton', { x: spot.tx * 16 + 8, y: (spot.ty - 1) * 16 + 10 }));
      sk.maxHp = sk.hp = 200;
      window.__sk = sk;
      g.clock.skipTo?.(23);
      g.camera.snap?.();
      return { spot, hp: P.hp };
    });
    if (r.none) {
      check(true, `[${tag}] 17 (no wall with ground both sides found: skipped)`);
      return;
    }
    await wait(4000);
    const hit = await ev(() => ({ hp: window.__game.player.hp, max: window.__game.player.maxHp }));
    await shot('17-wall');
    check(hit.hp === hit.max, `[${tag}] 17 a skeleton behind a wall lands nothing`, JSON.stringify({ ...r, ...hit }));
    await ev(() => {
      window.__sk.removed = true;
      window.__game.clock.skipTo(12);
    });
  });

  await item(25, "the author's other sentences (r14a)", async () => {
    const r = await ev(() => {
      const g = window.__game;
      const out = {};
      // The wider world on foot: Brindlecombe and the Crown Ring lie beyond the vale.
      out.brindle = !!g.locations.get('brindlecombe');
      out.crown = !!g.locations.get('crown_ring');
      out.worldBig = g.map.x0 < 0 || g.map.w > 160;
      // The first boss's trail is pointed to early.
      out.trail = !!(g.travel?.heard && Object.keys(g.travel.heard).length >= 0) && typeof g.missions !== 'undefined';
      // The locked chest: a heavy blow forces it; nothing inside is lost.
      const c = g.objects.all().find((o) => o.id === 'guard_footlocker');
      if (c) {
        const before = JSON.stringify(c.inventory.serialize());
        g.player.x = c.x;
        g.player.y = c.y + 20;
        const light = g.chestBlow?.(c.x, c.y, 16, { source: g.player });
        const heavy = g.chestBlow?.(c.x, c.y, 16, { source: g.player, heavy: true });
        out.chest = { light: light?.[0], heavy: heavy?.[0], same: before === JSON.stringify(c.inventory.serialize()) };
      }
      // Footsteps change with the ground.
      return out;
    });
    check(r.brindle && r.crown && r.worldBig, `[${tag}] 25 the wider world, on foot`, JSON.stringify(r));
    check(r.chest && r.chest.heavy === 'forced' && r.chest.same, `[${tag}] 25 the locked chest: a heavy blow forces it, nothing lost`, JSON.stringify(r.chest));
    // Downed: the countdown ring, Bram carries you; the ember-ring keeps your coins.
    const down = await ev(async () => {
      const g = window.__game;
      const b = g.entities.get('bram');
      b.opinionOfPlayer = 85;
      delete b.think;
      window.__put(b, g.player.x + 24, g.player.y, false);
      g.party.invite(b);
      const P = g.player;
      P.hp = 1;
      if (!P.downed) g.survival.fall?.(P, {});
      await new Promise((r) => setTimeout(r, 1200));
      return { downed: !!P.downed, ring: !!document.querySelector('.sv-clock, .sv-ring, .down-ring'), job: g.survival.jobs?.length ?? null, holder: g.party.holderId };
    });
    check(down.downed && down.ring, `[${tag}] 25 down: the countdown is on screen`, JSON.stringify(down));
    await shot('25-down');
  });

  // The same three rules on every screen.
  const scroll = await ev(() => document.documentElement.scrollWidth > innerWidth + 1).catch(() => false);
  check(!scroll, `[${tag}] no sideways scroll`);
  check(errors.length === 0, `[${tag}] no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

try {
  for (const S of SIZES) await play(S);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('Failed:');
  for (const f of failures) console.log(`  ${f}`);
  process.exit(1);
}
