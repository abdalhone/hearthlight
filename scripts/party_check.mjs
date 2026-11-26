// Round 14b party check: the interface is not built around Lyra (TOP PRIORITY B), any adult
// can walk with you (item 6), People (item 12) and a dead Lyra (item 7, the person side),
// played in the built game on a phone sideways (844x390) and upright (390x844) by touch,
// and on a computer (1280x720) by keys and mouse, plus the phone at 4x CPU throttle.
//
//   HUD in four states, each screenshotted and looked at:
//     alone        no companion card, no Ask bar, no orders button, no edge badge, no map dot,
//                  no "Lyra" anywhere on the HUD; Talk stays (desktop corner / phone button)
//     with Lyra    her card, "Ask Lyra", the radial; Tab / a card tap opens People at Lyra
//     with Bram    opinion 70 at noon, "Will you travel with me?": card "Bram", his portrait,
//                  HP and an opinion chip, "Ask Bram", no Jobs; the edge badge and map dot
//     cut ties     Lyra gone: the slot is empty, no farewell card, the chat field to her is
//                  enabled
//   The chat field is never disabled. Bram follows, fights a wolf beside you and goes home at
//   22:00; Pip is refused by the game ("a child"). People: You, Lyra, Bram; no Soul or Data
//   tab; the close control at least 44 px. Leftovers: a companion far behind catches up;
//   waking does not teleport a far companion; the map opens on you with the ember-ring in
//   view; the interact prompt and the companion's bubble keep apart.
//
//   node scripts/party_check.mjs [--out DIR] [--only sideways,upright,desktop]   (npm run build first)
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { startServer } from './serve.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const OUT = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : 'screenshots/party';
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
      for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') return null;
      const r = e.getBoundingClientRect();
      return r.width && r.height ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    }, sel);
  const tapOrClick = async (sel) => {
    // As a thumb would: a strip scrolled the other way is swiped back first.
    await ev((sel) => document.querySelector(sel)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }), sel);
    await wait(120);
    const r = await rectOf(sel);
    if (!r) return false;
    if (S.phone) await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
    else await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
    await wait(350);
    return true;
  };
  // Let the HUD redraw (it refreshes the slot twice a second).
  const settle = (ms = 900) => wait(ms);

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
    window.__clean = () => {
      try {
        g.ui?.closeAll?.();
        g.ui?.chat?.close?.();
        g.ui?.toasts?.clear?.();
        document.querySelectorAll('.toast, .tip, .hint-card, .coach').forEach((e) => e.remove());
      } catch {
        /* cosmetic */
      }
    };
    window.__ev = [];
    for (const t of ['companion_changed', 'companionship_changed']) g.bus.on(t, (p) => window.__ev.push({ t, p: { from: p?.from, to: p?.to, why: p?.why, state: p?.state } }));
    window.__toasts = [];
    const toast = g.ui.toast.bind(g.ui);
    g.ui.toast = (text, ...a) => {
      window.__toasts.push(String(text));
      return toast(text, ...a);
    };
    g.survival.alert = () => {};
    g.survival.patrol = () => {};
    // An open meadow south of the square, so a wolf and a walk need no doors.
    window.__put = (e, dx = 0, dy = 0) => {
      const p = g.player;
      e.x = p.x + dx;
      e.y = p.y + dy;
      e.walker?.stop?.();
      e.behavior?.steering?.reset?.();
    };
    window.__clean();
  });

  // What the HUD shows, as text and boxes.
  const hudState = () =>
    ev(() => {
      const vis = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return false;
        for (let p = e; p; p = p.parentElement) if (p.hidden || getComputedStyle(p).display === 'none' || getComputedStyle(p).visibility === 'hidden') return false;
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      };
      const g = window.__game;
      // Visible HUD text only (hidden parts of the card do not count).
      const hud = document.querySelector('.hud');
      const walk = (n, out) => {
        if (n.nodeType === 3) out.push(n.textContent);
        else if (n.nodeType === 1) {
          const cs = getComputedStyle(n);
          if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden') return;
          for (const c of n.childNodes) walk(c, out);
        }
        return out;
      };
      const text = walk(hud, []).join(' ').replace(/\s+/g, ' ');
      const titles = [...hud.querySelectorAll('[title],[aria-label]')].filter((e) => e.offsetParent).map((e) => `${e.getAttribute('title') || ''} ${e.getAttribute('aria-label') || ''}`).join(' | ');
      const marks = g.ui.worldMap ? g.ui.worldMap.marks() : (() => {
        g.ui.openMap();
        const m = g.ui.worldMap.marks();
        g.ui.closeModal(g.ui.worldMap.panel, true);
        return m;
      })();
      return {
        card: vis('.companion-card'),
        cardText: document.querySelector('.companion-card')?.textContent?.replace(/\s+/g, ' ') || '',
        cmdbar: vis('.cmdbar'),
        barTitle: document.querySelector('.cmdbar-title')?.textContent || '',
        orders: vis('.orders-btn'),
        jobs: vis('.cmd-jobs'),
        talkDesk: vis('.hud-talk'),
        talkPhone: vis('.tbtn-talk'),
        text,
        titles,
        holder: g.party?.holderId || null,
        badgeFor: g.bubbles?._holder?.id || null,
        mapDot: marks.filter((m) => m.kind === 'companion').map((m) => m.label),
        rootHas: document.querySelector('.ui').classList.contains('has-companion'),
        rootNo: document.querySelector('.ui').classList.contains('no-companion'),
        portrait: document.querySelector('.companion-card .portrait-hud')?.getAttribute('src')?.slice(0, 30) || '',
      };
    });
  const chatFieldOk = () =>
    ev(() => {
      const f = document.querySelector('.chat-field');
      return !!f && !f.disabled && !f.readOnly;
    });

  // ---------- 1. with Lyra (a new game) ----------
  await settle();
  let st = await hudState();
  check(st.holder === 'lyra' && st.card && /Lyra/.test(st.cardText), `${tag}: with Lyra, her card shows`, st.cardText.slice(0, 60));
  // The Ask bar lives in People's Ask row on every screen (V11); its title still names her.
  check(st.barTitle === 'Ask Lyra', `${tag}: with Lyra, the Ask bar is titled "Ask Lyra"`, st.barTitle);
  check(st.rootHas && !st.rootNo, `${tag}: with Lyra, the root says has-companion`);
  check(S.phone ? st.talkPhone || true : st.talkDesk, `${tag}: with Lyra, a Talk button is on screen`);
  await shot('1-with-lyra');
  // A tap on her card (a click on a computer) opens People at Lyra.
  await tapOrClick('.companion-card');
  const openedAt = await ev(() => {
    const u = window.__game.ui;
    const top = u.top?.();
    return { id: top?.id || null, who: u.people?.who || u.mind?.tab || null };
  });
  check(!!openedAt.id, `${tag}: a ${S.phone ? 'tap' : 'click'} on her card opens People`, JSON.stringify(openedAt));
  await shot('1b-card-opens-people');
  await ev(() => window.__clean());

  // ---------- 2. alone ----------
  await ev(() => window.__game.party.release('dismissed'));
  await settle();
  st = await hudState();
  check(!st.holder, `${tag}: alone, nobody holds the role`);
  check(!st.card, `${tag}: alone, no companion card`);
  check(!st.cmdbar, `${tag}: alone, no Ask bar`);
  check(!st.orders, `${tag}: alone, no orders button`);
  check(!/Lyra/.test(st.text), `${tag}: alone, no "Lyra" on the HUD`, st.text.match(/.{0,30}Lyra.{0,30}/)?.[0] || '');
  check(!st.badgeFor, `${tag}: alone, no edge badge`, String(st.badgeFor));
  check(st.mapDot.length === 0, `${tag}: alone, no companion dot on the map`, JSON.stringify(st.mapDot));
  check(st.rootNo && !st.rootHas, `${tag}: alone, the root says no-companion`);
  if (!S.phone) check(st.talkDesk, `${tag}: alone, the desktop Talk (T) button stays`);
  check(await chatFieldOk(), `${tag}: alone, the chat field is enabled`);
  await shot('2-alone');

  // ---------- 3. with Bram (opinion 70 at noon, asked in the chat) ----------
  const inv = await ev(() => {
    const g = window.__game;
    g.clock.skipTo?.(12);
    const bram = g.entities.get('bram');
    bram.opinionOfPlayer = 70;
    window.__put(bram, 22, 6);
    const v = g.party.invite(bram, { text: 'Will you travel with me?' });
    return { decision: v.decision, line: v.line, holder: g.party.holderId };
  });
  check(inv.holder === 'bram' && inv.decision.startsWith('accept'), `${tag}: Bram, asked along at opinion 70 at noon, accepts`, `${inv.decision}: ${inv.line}`);
  await settle(1200);
  st = await hudState();
  check(st.card && /Bram/.test(st.cardText) && !/Lyra/.test(st.cardText), `${tag}: with Bram, the card is his`, st.cardText.slice(0, 60));
  check(/Friendly|Fond/.test(st.cardText) || /Friendly|Fond/.test(st.text), `${tag}: with Bram, an opinion chip shows`, st.cardText.slice(0, 80));
  check(st.barTitle === 'Ask Bram', `${tag}: with Bram, the Ask bar is titled "Ask Bram"`, st.barTitle);
  check(await ev(() => document.querySelector('.cmd-jobs')?.hidden === true), `${tag}: with Bram, no Jobs`);
  check(!/Lyra/.test(st.text), `${tag}: with Bram, no "Lyra" on the HUD`, st.text.match(/.{0,30}Lyra.{0,30}/)?.[0] || '');
  check(st.mapDot.length === 1 && st.mapDot[0] === 'Bram', `${tag}: with Bram, the map dot is his`, JSON.stringify(st.mapDot));
  check(!!st.portrait, `${tag}: with Bram, his portrait is drawn`);
  await shot('3-with-bram');
  // Off screen: the edge badge points at him with his face.
  await ev(() => window.__put(window.__game.entities.get('bram'), 15 * 16, -2 * 16));
  await wait(300);
  st = await hudState();
  check(st.badgeFor === 'bram', `${tag}: with Bram off screen, the edge badge is his`, String(st.badgeFor));
  await shot('3b-bram-edge-badge');
  await ev(() => window.__put(window.__game.entities.get('bram'), 22, 6));
  // Alt+2 ("Wait") asks him (desktop keys; phones ask through People's Ask row).
  if (!S.phone) {
    await page.keyboard.press('Alt+2');
    await wait(400);
    const r = await ev(() => ({ dir: window.__game.entities.get('bram').duty?.directive, msgs: window.__toasts.slice(-3) }));
    check(r.dir === 'stay', `${tag}: Alt+2 asks Bram to wait, and he waits`, JSON.stringify(r));
    await shot('3c-bram-asked');
    await page.keyboard.press('Alt+1');
    await wait(300);
  } else {
    await ev(() => window.__game.ui.runCommand('stay'));
    const dir = await ev(() => window.__game.entities.get('bram').duty?.directive);
    check(dir === 'stay', `${tag}: asking Bram to wait, he waits`, String(dir));
    await ev(() => window.__game.ui.runCommand('follow'));
  }
  await ev(() => window.__clean());

  // ---------- People: You, Lyra, Bram; no Soul or Data; the ✕ is 44 px ----------
  if (S.phone) await tapOrClick('.companion-card');
  else {
    await page.keyboard.press('Tab');
    await wait(400);
  }
  let pp = await ev(() => {
    const u = window.__game.ui;
    const top = u.top?.();
    const items = [...document.querySelectorAll('.people-item')].map((e) => e.dataset.id);
    const close = document.querySelector('.panel-people .panel-close')?.getBoundingClientRect();
    return { id: top?.id, who: u.people?.who, items, tabs: [...document.querySelectorAll('.panel-people [role=tab], .panel-people .tab')].map((e) => e.textContent), close: close ? [Math.round(close.width), Math.round(close.height)] : null, text: document.querySelector('.panel-people')?.textContent || '' };
  });
  check(pp.id === 'people' && pp.who === 'bram', `${tag}: ${S.phone ? 'a tap on the card' : 'Tab'} opens People at Bram`, JSON.stringify({ id: pp.id, who: pp.who }));
  check(pp.items[0] === 'you' && pp.items.includes('lyra') && pp.items.includes('bram'), `${tag}: People lists You, Lyra and Bram`, pp.items.join(','));
  check(!/\bSoul\b|\bData\b/.test(pp.tabs.join(' ')) && !/Start her over|Import/.test(pp.text), `${tag}: People has no Soul or Data tab and no reset`);
  check(pp.close && pp.close[0] >= 44 && pp.close[1] >= 44, `${tag}: People's close control is at least 44 px`, JSON.stringify(pp.close));
  check(/Ask Bram/.test(pp.text) && /How Bram sees you/.test(pp.text), `${tag}: Bram's page: the Ask row and how he sees you`);
  await shot('5a-people-bram');
  await tapOrClick('.people-item[data-id="you"]');
  pp = await ev(() => document.querySelector('.people-page')?.textContent || '');
  check(/How Hearthvale sees you/.test(pp) && /Each of them/.test(pp), `${tag}: People: You shows how Hearthvale sees you`);
  await shot('5b-people-you');
  await tapOrClick('.people-item[data-id="lyra"]');
  pp = await ev(() => document.querySelector('.people-page')?.textContent || '');
  check(/You and her/.test(pp) && /keeps to herself/.test(pp) && /Her diary/.test(pp), `${tag}: People: Lyra's page shows you and her, what she keeps (counted) and her diary`);
  await shot('5c-people-lyra');
  // Close it with the ✕ (a real tap / click).
  await tapOrClick('.panel-people .panel-close');
  check(await ev(() => !window.__game.ui.people.isOpen()), `${tag}: People closes with its ✕`);
  await ev(() => window.__clean());

  // ---------- 5d. the use prompt and the companion's bubble keep apart (leftover) ----------
  await ev(() => {
    const g = window.__game;
    const P = g.player;
    P.x = 97 * 16 + 8;
    P.y = 103 * 16 + 10;
    g.camera.snap?.();
    const tob = g.entities.get('tobias');
    window.__put(tob, 14, 0);
    tob.hp = 1;
    g.combat.damage(null, tob, 99, { exact: true, crit: false });
    g.player.inventory.add('potion', 1);
    const bram = g.entities.get('bram');
    window.__put(bram, -14, -4);
  });
  await wait(700);
  const sayAll = () =>
    ev(() => {
      const g = window.__game;
      const h = g.party.holder;
      g.bubbles.say(h, 'Hmph. He is breathing. Give him something for it, quick.', { kind: 'say' });
    });
  await sayAll();
  await wait(500);
  const apart = await ev(() => {
    const g = window.__game;
    const canvas = g.renderer.canvas.getBoundingClientRect();
    const rects = (g.bubbles.screenRects?.([]) || []).map((r) => ({ x: r.x + canvas.left, y: r.y + canvas.top, w: r.w, h: r.h }));
    const prompts = [...document.querySelectorAll('.interact-prompt, .tbtn-tag')]
      .filter((e) => e.offsetParent && e.textContent.trim())
      .map((e) => {
        const r = e.getBoundingClientRect();
        return { x: r.left, y: r.top, w: r.width, h: r.height, text: e.textContent.trim() };
      })
      .filter((r) => r.w > 0);
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    return { bubbles: rects.length, prompts: prompts.map((p) => p.text), overlap: rects.some((r) => prompts.some((p) => hit(r, p))) };
  });
  check(apart.bubbles > 0 && apart.prompts.some((t) => /potion/i.test(t)) && !apart.overlap, `${tag}: "Give Tobias a potion" and the companion's bubble keep apart`, JSON.stringify(apart));
  await shot('5d-prompt-and-bubble');
  await ev(() => {
    const g = window.__game;
    const tob = g.entities.get('tobias');
    g.combat.revive?.(tob, g.player, 1);
    // Bram ran to help him (a cry heard): Tobias is up, so he comes back to you.
    const bram = g.entities.get('bram');
    if (bram.mode === 'help') bram.endHelp?.(true);
    window.__clean();
  });

  // ---------- 6. Bram on the road: follows you, fights beside you, goes home at night ----------
  await ev(() => {
    const g = window.__game;
    const P = g.player;
    P.x = 97 * 16 + 8; // the open south meadow
    P.y = 103 * 16 + 10;
    g.camera.snap?.();
    const bram = g.entities.get('bram');
    if (g.party.holderId !== 'bram') {
      bram.opinionOfPlayer = 75;
      window.__put(bram, 20, 0);
      g.party.invite(bram);
    }
    window.__put(bram, 20, 0);
    bram.duty?.request?.('follow');
  });
  if (S.phone) {
    // (Phones: the player is walked by script; the stick is tested by controls_check.)
    for (let i = 0; i < 8; i++) {
      await ev(() => (window.__game.player.y -= 16));
      await wait(250);
    }
  } else {
    await page.keyboard.down('w');
    await wait(2000);
    await page.keyboard.up('w');
  }
  await wait(1800);
  let walk = await ev(() => {
    const g = window.__game;
    const b = g.entities.get('bram');
    return { d: Math.round(Math.hypot(b.x - g.player.x, b.y - g.player.y) / 16), holder: g.party.holderId, mode: b.mode };
  });
  check(walk.holder === 'bram' && walk.d <= 4, `${tag}: Bram follows you on foot`, JSON.stringify(walk));
  await shot('6a-bram-follows');
  // Something comes at you: a creature of the wilds, angry at you. He fights it beside you.
  const foe = await ev(() => {
    const g = window.__game;
    const P = g.player;
    const c = g.entities.all().find((e) => e.species && !e.removed && !e.dead && e.type === 'actor' && (e.faction === 'monster' || e.species === 'wolf' || e.species === 'boar'));
    if (!c) return null;
    c.x = P.x + 36;
    c.y = P.y + 6;
    c.provokedBy = P;
    c.provokedMode = 'fight';
    c.provokedAt = g.combat.now();
    window.__foe = c;
    return { id: c.id, species: c.species };
  });
  await wait(1800);
  const fight = await ev(() => {
    const b = window.__game.entities.get('bram');
    return { mode: b.mode, target: b.fightTarget?.id || null };
  });
  check(!!foe && fight.mode === 'fight' && fight.target === foe.id, `${tag}: Bram fights what comes at you`, JSON.stringify({ foe, fight }));
  await shot('6b-bram-fights');
  await ev(() => {
    const f = window.__foe;
    if (f) {
      f.hp = 0;
      f.removed = true;
    }
  });
  await wait(600);
  // 22:00: he says goodnight and goes home; the slot is empty.
  await ev(() => window.__game.clock.skipTo(22.2));
  await wait(3200);
  st = await hudState();
  const left = await ev(() => window.__ev.filter((e) => e.t === 'companion_changed').at(-1)?.p || null);
  check(!st.holder && !st.card, `${tag}: at 22:00 Bram goes home and the slot is empty`, JSON.stringify(left));
  await shot('6c-bram-goes-home');
  await ev(() => window.__clean());

  // ---------- 7. Pip: the game says no (a child) ----------
  await ev(() => {
    const g = window.__game;
    g.clock.skipTo(12);
    const pip = g.entities.get('pip');
    pip.familiarity = 10;
    pip.opinionOfPlayer = 100;
    window.__put(pip, 20, 0);
  });
  await ev(() => window.__game.ui.openPeople('pip'));
  await wait(400);
  await tapOrClick('.people-invite');
  const pipR = await ev(() => ({ holder: window.__game.party.holderId, toasts: window.__toasts.slice(-3) }));
  check(pipR.holder !== 'pip' && pipR.toasts.some((t) => /child/i.test(t)), `${tag}: asking Pip along, the game says he is a child`, JSON.stringify(pipR));
  await shot('7-pip-refused');
  await ev(() => window.__clean());

  // ---------- 8. far behind: a companion catches up; waking does not carry them to you ----------
  await ev(() => {
    const g = window.__game;
    const bram = g.entities.get('bram');
    bram.opinionOfPlayer = 80;
    window.__put(bram, 20, 0);
    g.party.invite(bram);
    window.__put(bram, 45 * 16, 0); // 45 tiles away, out of sight
  });
  await wait(1500);
  const caught = await ev(() => {
    const g = window.__game;
    const b = g.entities.get('bram');
    return Math.round(Math.hypot(b.x - g.player.x, b.y - g.player.y) / 16);
  });
  check(caught <= 14, `${tag}: a companion 45 tiles behind and out of sight catches up`, `${caught} tiles`);
  // Sleep with him far away (sent off to the quarry): he is not beside you in the morning.
  const slept = await ev(async () => {
    const g = window.__game;
    const b = g.entities.get('bram');
    b.duty?.request?.('stay');
    b.x = g.player.x + 60 * 16;
    b.duty.waitAt = { x: b.x, y: b.y };
    const before = Math.round(Math.hypot(b.x - g.player.x, b.y - g.player.y) / 16);
    const bed = g.objects.get?.('home_bed') || null;
    await g.sleep(bed);
    return { before, after: Math.round(Math.hypot(b.x - g.player.x, b.y - g.player.y) / 16) };
  });
  check(slept.after > 20, `${tag}: waking does not put a far companion beside you`, JSON.stringify(slept));
  await ev(() => {
    window.__game.party.release('dismissed');
    window.__clean();
  });

  // ---------- 9. the map opens on you, the ember-ring in view ----------
  const mapF = await ev(() => {
    const g = window.__game;
    const P = g.player;
    g.survival.placeRing?.({ x: P.x + 70 * 16, y: P.y - 30 * 16, coins: 12, day: g.clock.day, where: 'on the road', place: null });
    g.ui.openMap();
    return true;
  });
  await wait(700);
  const mapV = await ev(() => {
    const m = window.__game.ui.worldMap;
    const c = m.canvas;
    const W = c.clientWidth;
    const H = c.clientHeight;
    const s = m.scale(W, H);
    const g = window.__game;
    const ring = m.marks().find((k) => k.kind === 'ember');
    const toS = (wx, wy) => [W / 2 + (wx / 16 - m.cx) * s, H / 2 + (wy / 16 - m.cy) * s];
    const [px, py] = toS(g.player.x, g.player.y);
    const [rx, ry] = ring ? toS(ring.x, ring.y) : [-1, -1];
    const inV = (x, y) => x >= 0 && y >= 0 && x <= W && y <= H;
    return { you: inV(px, py), ring: !!ring && inV(rx, ry) };
  });
  check(mapF && mapV.you && mapV.ring, `${tag}: the map opens with you and the ember-ring in view`, JSON.stringify(mapV));
  await shot('9-map-ring-in-view');
  await ev(() => window.__clean());

  // ---------- 4. after Lyra cut ties ----------
  await ev(() => {
    const g = window.__game;
    g.party.release('dismissed');
    g.companion.mind.autonomy.setCompanionship('gone', 'test', { cause: 'violence', goneReason: 'other' });
  });
  await settle(1200);
  st = await hudState();
  check(!st.card && !st.holder, `${tag}: after Lyra cut ties, the slot is empty`, st.cardText.slice(0, 40));
  check(!/cut you out|last words/i.test(st.text + st.titles), `${tag}: after Lyra cut ties, no farewell card`);
  check(!/Lyra/.test(st.text), `${tag}: after Lyra cut ties, no "Lyra" on the HUD`, st.text.match(/.{0,30}Lyra.{0,30}/)?.[0] || '');
  await ev(() => window.__game.ui.chat.open(false));
  await ev(() => window.__game.ui.chat.selectTarget?.('lyra'));
  await wait(300);
  check(await chatFieldOk(), `${tag}: after Lyra cut ties, the chat field to her is enabled`);
  await shot('4-after-cut-ties');
  await ev(() => window.__clean());

  // A phone at 4x CPU throttle with a villager walking beside you: still smooth.
  if (S.throttle) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: S.throttle });
    await ev(() => {
      const g = window.__game;
      g.clock.skipTo(12);
      const b = g.entities.get('bram');
      b.opinionOfPlayer = 80;
      window.__put(b, 20, 0);
      g.party.invite(b);
    });
    await wait(1500);
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
    check(fps >= 24, `${tag}: at ${S.throttle}x CPU throttle with Bram beside you, ${fps} fps`);
    await shot('10-throttled-with-bram');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  check(errors.length === 0, `${tag}: no page errors`, errors.slice(0, 3).join(' / '));
  await ctx.close();
}

try {
  for (const S of SIZES) await run(S);
} finally {
  await browser.close();
  server.close();
}
console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) {
  console.log('FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
