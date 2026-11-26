// Round 14b talk check: TOP PRIORITY A and items 1–5, played in the built game on a phone
// sideways (844x390) and upright (390x844) by real taps, and on a computer (1280x720) by
// keys and mouse; and the sideways phone at 4x CPU throttle.
//   1. Talk controls: a tap or click on a person opens nothing; T (desktop) or the round
//      "Talk to Bram" button (phones) opens the chat to whoever is in front of you.
//   2. Silence after hearing: with Claude answering {say: "", action: "turn_away"}, Bram's
//      reply is a shown act ("Bram hears you. He says nothing…"); the field stays open; the
//      words are in his talk.
//   3. Terror: a killing seen by Elda; Talk facing her: the chat opens To: Elda with "Elda
//      backs away from you…", the field open, fear chips; "I'm sorry, please listen" gets an
//      answer in terror (her words reached her).
//   4. Say aloud: nobody in front: Talk opens "Everyone nearby"; "Good morning, Hearthvale!"
//      is heard and answered by those near (one batched call); bubbles over heads.
//   5. *Acts*: "*bows* Good morning" to Elda (an act row, she warms); "*kisses Pip*": "You
//      don't." and no mind asked.
//   6. Lyra cut off: 10 tiles away she still hears (her chip "cut you off", the field open),
//      answers or shows her silence; 20 tiles: too far.
//   7. Her leaving: setCompanionship('left'): she walks up, speaks, the chat opens to her;
//      an answer; the letter in the bag, read in its paper panel (closed by its ✕).
//   node scripts/talk_check.mjs [--out DIR] [--only sideways,upright,desktop]   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/talk';
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
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
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${info ? `  ${info}` : ''}`);
  if (!ok) failures.push(label);
  return ok;
};

async function run(S) {
  const tag = S.tag;
  const ctx = await browser.newContext({ viewport: { width: S.w, height: S.h }, isMobile: S.phone, hasTouch: S.phone, deviceScaleFactor: 1, userAgent: S.phone ? UA : undefined });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com|net::ERR/.test(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  await page.route(/\/voice\/.+\.mp3$/, (r) => r.abort());
  const wait = (ms) => page.waitForTimeout(ms);
  const shot = (name) => page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const rectOf = (sel) =>
    ev((sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none') return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    }, sel);
  const tap = async (sel) => {
    const r = await rectOf(sel);
    if (!r) return false;
    if (S.phone) await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    else await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    return true;
  };
  // Talk: T on a computer; on a phone the round button (it names the person, or says Talk).
  const talk = async () => {
    if (S.phone) await tap('.tbtn-interact');
    else await page.keyboard.press('t');
    await wait(450);
  };
  // Typing into the chat field: a tap on it (the phone's keyboard), then the keys.
  const say = async (text) => {
    await tap('.chat-field');
    await page.keyboard.type(text, { delay: 5 });
    await page.keyboard.press('Enter');
  };
  const chatState = () =>
    ev(() => {
      const c = window.__game.ui.chat;
      return { open: c.isOpen(), target: c.target, disabled: c.field.disabled, ph: c.field.placeholder, chips: [...document.querySelectorAll('.chat-chips .chip')].map((b) => b.textContent), rows: [...document.querySelectorAll('.chat-log .msg')].map((r) => r.textContent.trim()).slice(-6) };
    });
  // Stand beside someone, facing them; everyone else kept still.
  const standBy = (id, dx = 18) =>
    ev(
      ({ id, dx }) => {
        const g = window.__game;
        const e = id === 'lyra' ? g.companion : g.entities.get(id);
        const P = g.player;
        P.x = e.x + dx;
        P.y = e.y;
        P.facing = { x: dx > 0 ? -1 : 1, y: 0 };
        g.camera.snap?.();
      },
      { id, dx },
    );

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.state === 'title', null, { timeout: 60000 });
  await ev(() => window.__game.newGame());
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 60000 });
  await wait(600);
  await ev(() => {
    const g = window.__game;
    try {
      g.story?.skip?.();
    } catch {
      /* no story */
    }
    g.clock.skipTo?.(12);
    const u = g.ui;
    for (const id of Object.keys(u?.coach?.done || {})) u.coach.done[id] = true;
    u?.coach?.stop?.();
    g.flags.talkHintShown = true;
    g.flags.finisherWarned = true;
    // The square at noon: Bram, Elda, Pip, Tobias and Wys held where they are put.
    const sq = g.locations.get('town_square').center;
    const spots = { bram: [0, 0], elda: [-70, 10], pip: [70, 30], tobias: [-20, 60], wys: [40, -50] };
    for (const [id, [dx, dy]] of Object.entries(spots)) {
      const e = g.entities.get(id);
      e.x = sq.x + dx;
      e.y = sq.y + dy;
      e.think = () => {};
      e.moveIntent = { x: 0, y: 0 };
    }
    // The others well out of the way.
    for (const e of g.entities.all()) if (e.profile && !spots[e.id] && e.id !== 'lyra') {
      e.x = 141 * 16;
      e.y = 101 * 16;
      e.think = () => {};
    }
    g.companion.x = sq.x + 200;
    g.companion.y = sq.y + 120;
    // A Claude for the villagers that the check can steer: silent, or a plain answer.
    window.__vClaude = 'plain';
    window.__vTasks = [];
    const v = g.village;
    v.provider = () => ({ id: 'check' });
    v.askClaude = async (p, rules, task, schema, kind) => {
      window.__vTasks.push({ kind, task: task.slice(0, 4000) });
      if (kind === 'aloud') {
        const ids = [...task.matchAll(/\[(\w+)\]/g)].map((m) => m[1]).filter((x) => g.entities.get(x));
        return { replies: ids.slice(0, 3).map((id, i) => ({ who: id, say: ['Good morning to you too!', 'Hmph. Morning.', 'Morning! Morning!'][i % 3], action: null, mood: 'warm', opinion_delta: 1, memory: null })) };
      }
      if (window.__vClaude === 'silent') return { say: '', silent: null, action: 'turn_away', act: null, mood: 'cold', opinion_delta: -1, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null, commit: null };
      if (window.__vClaude === 'terror') return { say: 'Don’t come near me! Somebody, help!', silent: null, action: 'flee', act: null, mood: 'afraid', opinion_delta: -2, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null, commit: null };
      return { say: 'Well, good day to you.', silent: null, action: null, act: null, mood: 'warm', opinion_delta: 1, learned: [], rumor_told: null, rumor: null, name: null, memory: null, asked: null, commit: null };
    };
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    window.__clean = () => {
      try {
        g.ui?.closeAll?.();
        g.ui?.chat?.close?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    window.__clean();
  });

  // ---------- 1. talk controls ----------
  await standBy('bram');
  await ev(() => window.__game.camera.snap?.());
  await wait(500);
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
  check((await chatState()).open === false, `[${tag}] 1 a tap or click on Pip opens nothing`);
  if (S.phone) {
    const label = await ev(() => document.querySelector('.tbtn-interact')?.getAttribute('aria-label') || '');
    check(/Talk to Bram/.test(label), `[${tag}] 1 the round button names him: "${label}"`);
  }
  await shot('1-beside-bram');
  await talk();
  let st = await chatState();
  check(st.open && st.target === 'bram', `[${tag}] 1 Talk beside Bram opens the chat to Bram`, JSON.stringify({ open: st.open, target: st.target }));
  const trade = await rectOf('.chat-trade');
  check(!!trade && trade.h >= 44, `[${tag}] 1 "Trade · Give · Work" within reach, ${trade ? Math.round(trade.h) : 0} px tall`);

  // ---------- 2. silence after hearing ----------
  await ev(() => {
    window.__vClaude = 'silent';
    window.__game.entities.get('bram').opinionOfPlayer = 8;
  });
  await say('Bram, a word with you');
  await page.waitForFunction(() => (window.__game.village.talks.bram || []).some((t) => t.you === 'Bram, a word with you' && !t.pending), null, { timeout: 15000 }).catch(() => {});
  await wait(500);
  st = await chatState();
  const row = st.rows.find((r) => /^Bram hears you/.test(r)) || '';
  check(/says nothing/.test(row), `[${tag}] 2 silence is a shown act: "${row}"`);
  check(!st.disabled && /Say something to Bram/.test(st.ph), `[${tag}] 2 the field stays open`, st.ph);
  check(await ev(() => (window.__game.village.talks.bram || []).some((t) => t.you === 'Bram, a word with you' && t.silent)), `[${tag}] 2 his talk keeps the words, and that he said nothing`);
  check(!st.rows.some((r) => /catch that|won't talk/.test(r)), `[${tag}] 2 never "didn't catch that"`);
  await shot('2-silence');
  await ev(() => window.__clean());

  // ---------- 3. terror ----------
  await ev(() => {
    const g = window.__game;
    window.__vClaude = 'terror';
    const wys = g.entities.get('wys');
    const elda = g.entities.get('elda');
    // Lyra well away, out of sight of it: this is Elda's terror, not Lyra's leaving.
    g.companion.x = 141 * 16;
    g.companion.y = 104 * 16;
    g.player.x = wys.x - 14;
    g.player.y = wys.y;
    elda.x = wys.x + 50;
    elda.y = wys.y - 10;
    wys.hp = 1;
    g.combat.damage(g.player, wys, 999, { exact: true, crit: false });
    g.murder.kill(wys, g.player);
    elda.think = () => {};
    elda.update = () => {};
  });
  const fear = await ev(() => window.__game.murder.fearOf(window.__game.entities.get('elda')));
  check(fear === 'terror', `[${tag}] 3 Elda saw it: ${fear}`);
  await standBy('elda');
  await wait(300);
  await talk();
  st = await chatState();
  check(st.open && st.target === 'elda', `[${tag}] 3 Talk facing Elda: To Elda`, `${st.target}`);
  check(st.rows.some((r) => /backs away from you/.test(r)), `[${tag}] 3 "Elda backs away from you…"`);
  check(!st.disabled, `[${tag}] 3 the field is open`);
  check(!st.chips.some((c) => /Hello|news/.test(c)) && st.chips.some((c) => /Please/.test(c)), `[${tag}] 3 fear chips: ${st.chips.slice(0, 3).join(' | ')}`);
  await say("I'm sorry, please listen");
  await page.waitForFunction(() => (window.__game.village.talks.elda || []).some((t) => /please listen/.test(t.you) && !t.pending), null, { timeout: 15000 }).catch(() => {});
  await wait(600);
  st = await chatState();
  const ans = await ev(() => (window.__game.village.talks.elda || []).filter((t) => /please listen/.test(t.you)).map((t) => (t.they || []).join(' '))[0] || '');
  check(/Don|help|Stay|Please|Get away/i.test(ans), `[${tag}] 3 she answers in terror: "${ans}"`);
  check(await ev(() => window.__vTasks.some((t) => /terrified/.test(t.task))), `[${tag}] 3 her own mind was asked, told she is terrified`);
  await shot('3-terror');
  await ev(() => {
    const g = window.__game;
    const e = g.entities.get('elda');
    e.terror = null;
    window.__clean();
  });

  // ---------- 4. say aloud ----------
  await ev(() => {
    const g = window.__game;
    window.__vClaude = 'plain';
    const sq = g.locations.get('town_square').center;
    const spots = { bram: [30, 0], tobias: [-30, 10], pip: [0, 35], elda: [-10, -36] };
    for (const [id, [dx, dy]] of Object.entries(spots)) {
      const e = g.entities.get(id);
      e.x = sq.x + dx;
      e.y = sq.y + dy;
      e.terror = null;
      e.mode = 'routine';
    }
    g.player.x = sq.x;
    g.player.y = sq.y;
    g.player.facing = { x: 0, y: -1 };
    // Lyra (walking with you) a little way behind: she is someone near too.
    g.companion.x = sq.x - 40;
    g.companion.y = sq.y + 60;
    window.__vTasks.length = 0;
    // Nobody within three tiles in front: Talk is saying it aloud.
    for (const id of Object.keys(spots)) {
      const e = g.entities.get(id);
      const d = Math.hypot(e.x - g.player.x, e.y - g.player.y);
      if (d < 48 && (e.y - g.player.y) < 0) e.y = g.player.y + 50;
    }
    g.camera.snap?.();
  });
  await wait(400);
  await ev(() => {
    const g = window.__game;
    // Facing an empty patch of the square: the nearest in front is nobody.
    for (const id of ['bram', 'tobias', 'pip', 'elda']) {
      const e = g.entities.get(id);
      e.x = g.player.x + (e.x - g.player.x) * 2.4;
      e.y = g.player.y + Math.abs(e.y - g.player.y) * 1.6 + 30;
    }
  });
  await talk();
  st = await chatState();
  check(st.open && st.target === '@near', `[${tag}] 4 nobody in front: Talk says it aloud ("Everyone nearby")`, st.target);
  await say('Good morning, Hearthvale!');
  await page.waitForFunction(() => document.querySelectorAll('.chat-log .chat-npc-line').length >= 1, null, { timeout: 15000 }).catch(() => {});
  await wait(1800);
  st = await chatState();
  const aloudCalls = await ev(() => window.__vTasks.filter((t) => t.kind === 'aloud').length);
  check(aloudCalls === 1, `[${tag}] 4 one batched call for everyone who heard (${aloudCalls})`);
  check(st.rows.some((r) => /Good morning to you too|Morning/.test(r)), `[${tag}] 4 they answer: ${st.rows.slice(-3).join(' | ')}`);
  await ev(() => window.__game.ui.chat.close());
  await wait(500);
  await shot('4-aloud-bubbles');

  // ---------- 5. *acts* ----------
  // Hobb, who saw nothing today, in a quiet corner of the square.
  await ev(() => {
    window.__clean();
    const g = window.__game;
    const hobb = g.entities.get('hobb');
    const sq = g.locations.get('town_square').center;
    hobb.x = sq.x + 120;
    hobb.y = sq.y - 70;
    hobb.think = () => {};
    hobb.moveIntent = { x: 0, y: 0 };
    hobb.opinionOfPlayer = 50;
  });
  await standBy('hobb');
  await wait(300);
  const op0 = await ev(() => window.__game.entities.get('hobb').opinionOfPlayer);
  await talk();
  await say('*bows* Good morning');
  await page.waitForFunction(() => [...document.querySelectorAll('.chat-log .msg-act')].length >= 1, null, { timeout: 15000 }).catch(() => {});
  await wait(500);
  st = await chatState();
  const op1 = await ev(() => window.__game.entities.get('hobb').opinionOfPlayer);
  check(st.rows.some((r) => /^You bow/.test(r)), `[${tag}] 5 the act row: ${st.rows.find((r) => /^You bow/.test(r)) || st.rows.slice(-2).join(' | ')}`);
  check(op1 > op0, `[${tag}] 5 a bow warms him (${op0} -> ${op1})`);
  await shot('5-bow');
  await ev(() => window.__clean());
  await standBy('pip');
  await wait(300);
  const tasksBefore = await ev(() => window.__vTasks.length);
  await talk();
  await say('*kisses Pip*');
  await wait(900);
  st = await chatState();
  check(st.rows.some((r) => r === "You don't."), `[${tag}] 5 "*kisses Pip*": "You don't."`, st.rows.slice(-2).join(' | '));
  check((await ev(() => window.__vTasks.length)) === tasksBefore, `[${tag}] 5 and no mind was asked`);
  await ev(() => window.__clean());

  // ---------- 6. Lyra cut off ----------
  await ev(() => {
    const g = window.__game;
    const L = g.companion;
    L.mind.autonomy.setCompanionship('gone', 'You hurt me.', { cause: 'downed', goneReason: 'downed', silent: true, noParting: true });
    g.player.x = L.x - 10 * 16;
    g.player.y = L.y;
    g.camera.snap?.();
  });
  await wait(400);
  await ev(() => {
    const g = window.__game;
    g.ui.chat.open(false);
    g.ui.chat.refreshPeople(true);
  });
  await wait(300);
  const chip = await ev(() => document.querySelector('.chat-to-chip[data-id="lyra"]')?.textContent || '');
  check(/Lyra/.test(chip), `[${tag}] 6 ten tiles from her, her chip is there: "${chip}"`);
  await tap('.chat-to-chip[data-id="lyra"]');
  await wait(300);
  st = await chatState();
  check(st.target === 'lyra' && !st.disabled, `[${tag}] 6 the field to her is open`, st.ph);
  const nBefore = await ev(() => window.__game.ui.chat.messages.length);
  await say('please');
  await page.waitForFunction((n) => window.__game.ui.chat.messages.length >= n + 2, nBefore, { timeout: 15000 }).catch(() => {});
  await wait(400);
  const lyraRow = await ev((n) => window.__game.ui.chat.messages.slice(n).filter((m) => m.from !== 'player').map((m) => m.text), nBefore);
  check(lyraRow.length >= 1 && !lyraRow.some((t) => /catch that|won't talk/.test(t)), `[${tag}] 6 she answers, or shows her silence: ${lyraRow.join(' | ')}`);
  check(await ev(() => window.__game.companion.mind.conversation.some((c) => c.role === 'player' && /\bplease\b/.test(c.text))), `[${tag}] 6 her record has the word`);
  await shot('6-lyra-gone');
  await ev(() => {
    const g = window.__game;
    g.player.x = g.companion.x - 20 * 16;
  });
  await say('can you hear me?');
  await wait(500);
  const far = await ev(() => window.__game.ui.chat.messages.slice(-1)[0]?.text || '');
  check(/too far away to hear you/.test(far), `[${tag}] 6 twenty tiles off: "${far.slice(0, 60)}"`);
  await ev(() => window.__clean());

  // ---------- 7. her leaving: the scene and the letter ----------
  // She is with you again (for this check: her state set back by hand), then she leaves.
  const fresh = await ev(() => {
    const g = window.__game;
    const L = g.companion;
    const a = L.mind.autonomy;
    a.companionship = 'together';
    delete g.flags.lyra_gone;
    // (and the killing she heard of earlier is days behind her)
    a.ledger = a.ledger.filter((e) => e.deed !== 'murdered_villager' && e.deed !== 'downed_lyra');
    a.parting.st = null;
    a._direct('together', 'gone');
    const sq = g.locations.get('town_square').center;
    g.player.x = sq.x;
    g.player.y = sq.y + 90;
    L.x = g.player.x + 6 * 16;
    L.y = g.player.y;
    g.camera.snap?.();
    a.setCompanionship('left', 'You hurt Pip.', { cause: 'villager', lineKey: 'to_left_villager' });
    window.__partingInfo = { st: a.companionship, active: a.parting.active, ledger: a.ledger.slice(-4).map((e) => e.deed), fear: a.stats().fear, target: !!a.behavior()?.currentTarget };
    return true;
  });
  check(fresh && (await ev(() => window.__game.companion.mind.autonomy.parting.active)), `[${tag}] 7 her leaving is a scene`, JSON.stringify(await ev(() => window.__partingInfo)));
  await page.waitForFunction(() => window.__game.ui.chat.isOpen() && window.__game.ui.chat.target === 'lyra', null, { timeout: 30000 }).catch(() => {});
  st = await chatState();
  check(st.open && st.target === 'lyra' && !st.disabled, `[${tag}] 7 she walked up and spoke; the chat is open to her`);
  await wait(1500);
  await shot('7a-parting');
  await say("I'm sorry. Please don't go.");
  await page.waitForFunction(() => !window.__game.companion.mind.autonomy.parting.active, null, { timeout: 30000 }).catch(() => {});
  const letter = await ev(() => window.__game.player.inventory.count('lyra_letter'));
  check(letter === 1, `[${tag}] 7 her letter is in the bag`);
  await ev(() => {
    window.__game.ui.chat.close();
    window.__game.ui.openLetter('lyra_letter');
  });
  await wait(400);
  const panel = await rectOf('.panel-letter .panel-close');
  check(!!panel && panel.w >= 44 && panel.h >= 44, `[${tag}] 7 the letter's panel closes with a ${panel ? Math.round(panel.w) : 0} px ✕`);
  await shot('7b-letter');
  await tap('.panel-letter .panel-close');
  await wait(300);
  check(!(await rectOf('.panel-letter')), `[${tag}] 7 and it closed`);

  // ---------- a slow phone keeps its frame rate with the chat open ----------
  if (S.throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.throttle });
    await ev(() => window.__game.ui.talkToNearest());
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
    await shot('8-throttled');
    check(fps >= 20, `[${tag}] at ${S.throttle}x CPU throttle, chat open, ${fps} fps`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }

  const scroll = await ev(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!scroll, `[${tag}] no sideways scroll`);
  check(errors.length === 0, `[${tag}] no page errors`, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

try {
  for (const S of SIZES) await run(S);
} catch (err) {
  failures.push(`crashed: ${err.stack || err}`);
  console.error(err);
}
await browser.close();
server.close();
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
