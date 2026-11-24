import { resolveItemId, itemDef } from '../../entities/items.js';
import { cmd, act, firstMessage, cleanRef, qtyFrom, QTY, jobForItem } from '../behavior/phrases.js';
import { dist, objectName, itemWord, doorIsOpen, doorIsLocked, safe } from '../behavior/util.js';
import { say } from '../behavior/lines.js';
import { resolveJobId } from '../behavior/jobs.js';

// Lyra's hands in the world: doors, pickups, handing items over, eating, using
// objects, going to bed.

const ABSENT = { ok: false, message: "I'm not here right now." };
const TILE = 16;

function body(ctx) {
  return ctx?.behavior || ctx?.companion?.behavior || null;
}

// The door she means: a named/identified one, else the nearest door to her.
function findDoor(ctx, ref) {
  const g = ctx.game;
  const a = ctx.companion;
  if (!g.objects || !a) return null;
  const words = ref ? String(ref).toLowerCase().replace(/\b(the|that|this|a|an)\b/g, ' ').trim() : '';
  if (words) {
    const byId = safe('objects.get', () => g.objects.get(ref));
    if (byId?.objType === 'door') return byId;
    const named = safe('objects.nearest', () =>
      g.objects.nearest((o) => o.objType === 'door' && words !== 'door' && words !== 'gate' && String(o.name || '').toLowerCase().includes(words.replace(/\s*(door|gate)$/, '').trim() || words), a.x, a.y, 60 * TILE),
    );
    if (named) return named;
  }
  const isGate = /gate/.test(words);
  return (
    safe('objects.nearest', () => g.objects.nearest((o) => o.objType === 'door' && (!isGate || /gate/i.test(String(o.name || o.id))), a.x, a.y, 12 * TILE)) ||
    safe('objects.nearest', () => g.objects.nearest('door', a.x, a.y, 12 * TILE))
  );
}

function doorAction(ctx, ref, open) {
  const b = body(ctx);
  if (!b) return ABSENT;
  const door = findDoor(ctx, ref);
  if (!door) return { ok: false, message: say.noDoor() };
  if (doorIsOpen(door) === open) return { ok: true, message: say.doorAlready(open) };
  if (open && doorIsLocked(door) && !ctx.companion.inventory?.has?.(door.state?.keyId)) {
    if (ctx.game.player?.inventory?.has?.(door.state?.keyId)) return { ok: false, message: say.lockedPlayerHasKey(door) };
    return { ok: false, message: say.locked(door) };
  }
  return b.interactWith(door, open ? 'open' : 'close');
}

const answer = (m, ctx, results) => firstMessage(results);

const VAGUE_FOOD = /^(something|anything|food|a snack|snack|some food|a bite)$/i;

export const worldPlugin = {
  id: 'world',
  name: 'World interaction',
  description: 'Doors, picking things up, giving items, eating, using objects, sleeping.',

  actions: {
    open_door: {
      description: 'Walk to a door and open it (default: the nearest door).',
      params: { target: 'door reference (default nearest)' },
      run(args, ctx) {
        return doorAction(ctx, args.target, true);
      },
    },
    close_door: {
      description: 'Walk to a door and close it (default: the nearest door).',
      params: { target: 'door reference (default nearest)' },
      run(args, ctx) {
        return doorAction(ctx, args.target, false);
      },
    },
    pick_up: {
      description: 'Collect nearby items lying on the ground (optionally only one kind). She keeps them.',
      params: { target: 'item name (optional)' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        return b.pickUp(cleanRef(args.target || args.value));
      },
    },
    give_item: {
      description: 'Walk over and hand items from her pack to someone (default: the player).',
      params: { target: 'who receives it (default the player)', value: 'item name or id ("everything" for her whole pack)', amount: 'how many (default 1)' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        return b.giveItem(args.target || 'player', args.value, args.amount ?? 1);
      },
    },
    use_item: {
      description: 'Eat or drink something from her pack (default: the most sensible food).',
      params: { value: 'item name (optional)' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        return b.eat(args.value || args.target || null);
      },
    },
    interact: {
      description: 'Walk to an object (or person) and use it: doors, chests (stores her materials), beds, campfires (sits), signs (reads), trees and rocks (harvests one).',
      params: { target: 'object reference (e.g. "chest", "campfire", an object id)' },
      run(args, ctx) {
        const b = body(ctx);
        if (!b) return ABSENT;
        if (!args.target) return { ok: false, message: 'Use what? Point me at something.' };
        return b.interactWith(args.target);
      },
    },
    sleep: {
      description: 'Go to her bed and sleep (only at night).',
      params: {},
      run(args, ctx) {
        const b = body(ctx);
        return b ? b.goToSleep() : ABSENT;
      },
    },
  },

  intents: [
    {
      id: 'world.open_door',
      patterns: [
        cmd(String.raw`(?:open|unlock|get)\s+(?:the\s+|that\s+|this\s+|a\s+)?(?<door>(?:[\w'-]+\s){0,3}?(?:door|gate))`),
        cmd(String.raw`(?:get|hold) (?:the|that) door(?: for me)?`),
      ],
      command: true,
      confidence: 0.9,
      actions: (m) => [act('open_door', cleanDoor(m.groups?.door))],
      answer,
    },
    {
      id: 'world.close_door',
      patterns: [cmd(String.raw`(?:close|shut|lock)\s+(?:the\s+|that\s+|this\s+|a\s+)?(?<door>(?:[\w'-]+\s){0,3}?(?:door|gate))(?:\s+behind (?:us|you|me))?`)],
      command: true,
      confidence: 0.9,
      actions: (m) => [act('close_door', cleanDoor(m.groups?.door))],
      answer,
    },
    {
      id: 'world.pick_up',
      patterns: [
        cmd(String.raw`pick\s+(?<what>that|it|this|those|them|these|everything|all|the [\w' -]+?|[\w' -]+?)\s+up`),
        cmd(String.raw`(?:pick up|grab|collect|fetch|get|take)\s+(?<what>that|it|this|those|them|these)`),
        cmd(String.raw`pick up\s+(?<what>(?:the |that |those |some |all the )?[\w' -]{1,30}?)`),
      ],
      command: true,
      confidence: 0.88,
      actions: (m) => [act('pick_up', cleanRef(m.groups?.what))],
      answer,
    },
    {
      id: 'world.bring_me',
      // "bring me wood": hand it over if she has it, otherwise go and get some.
      patterns: [cmd(String.raw`(?:bring|fetch|get|find)\s+(?:me|us)\s+` + QTY + String.raw`(?<item>[a-z][\w' -]{1,30}?)`)],
      command: true,
      confidence: 0.86,
      actions: (m, ctx) => {
        const itemId = resolveItemId(m.groups?.item);
        const qty = qtyFrom(m);
        const have = itemId ? ctx.companion?.inventory?.count?.(itemId) || 0 : 0;
        if (itemId && have >= (qty || 1)) return [act('give_item', 'player', itemId, qty || 1)];
        const job = itemId ? jobForItem(itemId) : resolveJobId(m.groups?.item)?.id;
        if (job) return [act('start_job', 'player', job, qty)];
        return [act('give_item', 'player', m.groups?.item || null, qty || 1)];
      },
      answer,
    },
    {
      id: 'world.give_me',
      patterns: [
        cmd(String.raw`(?:give|hand|pass|toss|throw|lend)\s+me\s+(?:(?<all>all(?: of)?(?: your| the)?|everything(?: you have)?|your)\s+)?` + QTY + String.raw`(?:the\s+|your\s+)?(?<item>[a-z][\w' -]{1,30}?)`),
        cmd(String.raw`(?:can|could|may) i (?:have|get|borrow)\s+(?:(?<all>all(?: of)?(?: your| the)?|your)\s+)?` + QTY + String.raw`(?:the\s+|your\s+)?(?<item>[a-z][\w' -]{1,30}?)`),
      ],
      command: true,
      confidence: 0.86,
      actions: (m) => {
        const item = m.groups?.item;
        const everything = /^(everything|it all|all|stuff|things|everything you have|all your stuff)$/i.test(item || '');
        const qty = m.groups?.all ? 9999 : qtyFrom(m) || 1;
        return [act('give_item', 'player', everything ? 'everything' : item, qty)];
      },
      answer(m, ctx, results) {
        const r = results?.[0];
        if (r && !r.ok) {
          const itemId = resolveItemId(m.groups?.item);
          const job = itemId && jobForItem(itemId);
          if (job && /don't have any/.test(r.message || '')) return `${r.message} I could go get some, if you like.`;
        }
        return firstMessage(results);
      },
    },
    {
      id: 'world.give_to',
      patterns: [
        cmd(String.raw`(?:give|hand|bring|take)\s+` + QTY + String.raw`(?:the\s+|your\s+|my\s+)?(?<item>[a-z][\w' -]{1,30}?)\s+to\s+(?!me\b)(?<who>[a-z][\w' -]{1,30}?)`),
        cmd(String.raw`(?:give|hand)\s+(?!me\b|us\b)(?<who>[a-z][\w'-]*(?: [a-z][\w'-]*)?)\s+` + QTY + String.raw`(?:the\s+|your\s+|a\s+)?(?<item>[a-z][\w' -]{1,30}?)`),
      ],
      command: true,
      confidence: 0.84,
      actions: (m) => [act('give_item', cleanRef(m.groups?.who), m.groups?.item, qtyFrom(m) || 1)],
      answer,
    },
    {
      id: 'world.eat',
      patterns: [
        cmd(String.raw`(?:eat|have|grab|get)\s+(?:something|anything|a snack|some food|a bite)(?:\s+to eat)?`),
        cmd(String.raw`(?:have|get|take) (?:a bite|a snack|some food|something to eat)`),
        cmd(String.raw`(?:heal (?:yourself|up)|patch yourself up|drink a potion|use a potion|drink (?:a |your )?healing potion|use (?:a |your )?healing potion)`),
        cmd(String.raw`(?:eat|drink|consume|quaff|munch(?: on)?|snack on)\s+(?:a |an |the |one |some |your )?(?<item>[a-z][\w' -]{1,30}?)`),
        cmd(String.raw`(?:you should|go|you need to)\s+eat(?:\s+something)?`),
      ],
      command: true,
      confidence: 0.87,
      actions: (m) => {
        let item = m.groups?.item || null;
        if (!item && /potion|heal|patch/i.test(m[0])) item = 'potion';
        if (item && VAGUE_FOOD.test(item)) item = null;
        return [act('use_item', null, item)];
      },
      answer,
    },
    {
      id: 'world.sleep',
      patterns: [
        cmd(String.raw`(?:go to (?:sleep|bed)|go (?:get|catch) some (?:sleep|rest|shut-?eye)|get some (?:sleep|shut-?eye)|time (?:for|to go to) bed|go to your bed|(?:go )?sleep|turn in|hit the (?:hay|sack)|bedtime|off to bed|get to bed|you should sleep)`),
      ],
      command: true,
      confidence: 0.88,
      actions: () => [act('sleep')],
      answer,
    },
    {
      id: 'world.interact',
      patterns: [cmd(String.raw`(?:use|open|check|look in|inspect|read|pet|ring|light|sit at|warm up (?:at|by))\s+(?:the |that |this |a |your |my )?(?<obj>[a-z][\w' -]{1,30}?)`)],
      command: true,
      confidence: 0.82,
      actions: (m) => [act('interact', cleanRef(m.groups?.obj))],
      answer,
    },
  ],

  promptContext(ctx) {
    const g = ctx.game;
    const a = ctx.companion;
    if (!a || !g.objects?.inRadius) return '';
    const near = safe('objects.inRadius', () => g.objects.inRadius(a.x, a.y, 7 * TILE, (o) => USEFUL.has(o.objType)), []) || [];
    near.sort((p, q) => dist(a.x, a.y, p.x, p.y) - dist(a.x, a.y, q.x, q.y));
    const parts = near.slice(0, 7).map((o) => {
      let s = `${objectName(o).replace(/^the /, '')} (id ${o.id}`;
      if (o.objType === 'door') s += doorIsOpen(o) ? ', open' : doorIsLocked(o) ? ', locked' : ', closed';
      return `${s})`;
    });
    const pickups = [];
    for (const e of g.entities?.list || []) {
      if (e.type !== 'pickup' || e.removed || dist(a.x, a.y, e.x, e.y) > 8 * TILE) continue;
      pickups.push(e.qty > 1 ? `${e.qty} ${itemWord(e.itemId, e.qty)}` : itemWord(e.itemId, 1));
      if (pickups.length >= 5) break;
    }
    const lines = [];
    if (parts.length) lines.push(`Close by: ${parts.join(', ')}.`);
    if (pickups.length) lines.push(`On the ground nearby: ${pickups.join(', ')} (pick_up).`);
    const food = (a.inventory?.list?.() || []).filter((i) => itemDef(i.id)?.heal).map((i) => i.id);
    if (food.length) lines.push(`Food/potions she carries: ${food.join(', ')}.`);
    return lines.join('\n').slice(0, 880);
  },
};

const USEFUL = new Set(['door', 'chest', 'bed', 'campfire', 'hearth', 'well', 'sign', 'notice_board', 'altar', 'journal', 'fishing_spot', 'tree', 'rock', 'ore', 'herb', 'moonpetal', 'berry_bush', 'crop', 'crystal']);

function cleanDoor(s) {
  const t = cleanRef(s);
  if (!t) return null;
  return /^(door|gate)$/i.test(t.trim()) ? null : t;
}
