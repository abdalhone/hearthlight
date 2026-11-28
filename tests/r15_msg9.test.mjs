import { test } from 'node:test';
import assert from 'node:assert/strict';

import { makeGame, px, put } from './murder_world.mjs';
import { lakeBrain } from '../src/bosses/ai_lake.js';
import { understand } from '../src/ai/social/player_talk.js';
import { StoryDirector } from '../src/story/director.js';
import { TILE } from '../src/core/constants.js';

test('msg9: dead NPCs do not satisfy npc_near:<id> cutscene conditions', () => {
  const g = makeGame();
  const dir = new StoryDirector(g);
  const ave = g.entities.get('aveline');
  put(ave, g.player.x + 20, g.player.y);
  assert.equal(dir.when('npc_near:aveline'), true);
  g.murder.kill(ave, g.player, { silent: true });
  assert.equal(dir.when('npc_near:aveline'), false);
});

test('msg9: Lake Hum shardSpot avoids blocked water tiles and falls back to island', () => {
  const arena = { x: 10 * TILE, y: 10 * TILE, r: 48 };
  const game = {
    isBlockedTile(tx, ty) {
      // Only tiles around (10, 10) are walkable island; (5, 10) is water
      return Math.hypot(tx - 10, ty - 10) > 2;
    },
  };
  const boss = { x: 4 * TILE, y: 10 * TILE, arena, game };
  const spot = lakeBrain.shardSpot(boss);
  const tx = Math.floor(spot.x / TILE);
  const ty = Math.floor(spot.y / TILE);
  assert.equal(game.isBlockedTile(tx, ty), false, 'shard lands on walkable island tile');
});

test('msg9: bed-killed NPC does not snap back to bed when carried, dropped, or reloaded', () => {
  const g = makeGame();
  const hobb = g.entities.get('hobb');
  const bed = hobb.ownBed();
  assert.ok(bed, 'hobb has a bed');
  hobb.getIntoBed(bed);
  const bedX = Math.round(hobb.x);
  const bedY = Math.round(hobb.y);

  const rec = g.murder.kill(hobb, g.player, { silent: true });
  assert.ok(rec);
  assert.equal(hobb.inBed, null);
  assert.ok(Math.hypot(rec.x - bedX, rec.y - bedY) > 0 || Math.hypot(hobb.x - bedX, hobb.y - bedY) > 0);

  // Carry and drop elsewhere
  g.player.x = hobb.x;
  g.player.y = hobb.y;
  g.murder.bodyInteract(hobb, g.player, 'lift');
  assert.equal(g.player.carrying, hobb);
  const dropX = px(82);
  const dropY = px(58);
  g.player.x = dropX;
  g.player.y = dropY;
  g.survival.endCarry(g.player);
  assert.equal(rec.state, 'lying');
  assert.ok(Math.hypot(rec.x - dropX, rec.y - dropY) < TILE * 2, 'dropped coordinates saved, not bed');

  // Save and reload keeps hobb dead at dropped location
  const npcSaved = hobb.serialize();
  const murderSaved = g.murder.serialize();
  const g2 = makeGame();
  const hobb2 = g2.entities.get('hobb');
  hobb2.deserialize(npcSaved);
  g2.murder.deserialize(murderSaved);
  assert.equal(hobb2.dead, true);
  assert.ok(hobb2.absent);
  assert.equal(hobb2.isAlive(), false);
  assert.ok(Math.hypot(hobb2.x - dropX, hobb2.y - dropY) < TILE * 2);
});

test('msg9: "hear me and I\'ll spare you" is understood as threat/ultimatum', () => {
  const u = understand("hear me and I'll spare you");
  assert.equal(u.intents.has('threat'), true);
});
