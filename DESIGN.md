# Hearthlight — design and module contracts

Hearthlight is an original top-down pixel-art RPG that runs in any browser (desktop and phone).
You play a traveler who has just settled in the village of Hearthvale. Your companion is
**Lyra**, an arcane ranger with her own mind: a soul (identity, values, history), feelings,
needs, memories, opinions and relationships with every person she meets. She can be driven by
Claude (through claude.ai when the game is published as an Artifact, or through the player's
own API key) or by a built-in offline mind. Either way the same action system moves her body.

This document is the contract between modules. **If you own a module, implement exactly the
interface described here.** Other modules are being written at the same time against the same
text, so a renamed method or a changed payload breaks someone else's code.

---

## 0. Quality bar

- It should feel like a polished, modern pixel game: crisp 16 px tiles, detailed shaded
  sprites with dark outlines, smooth animation, juicy feedback (hit flash, hit-stop, screen
  shake, particles, damage numbers), warm dynamic lighting at night, weather, ambient life.
- Lyra must feel like a person: she reacts to events in her own voice, remembers, holds
  opinions, has moods and needs, refuses things that go against her values, and keeps
  standing orders (attack mode, follow, stay, jobs) without asking permission each time.
- **Lyra lives for herself (§16 — this overrides anything earlier that reads otherwise).**
  She is not there to answer, serve, save or help the player. She travels with them by her
  own choice, while it is good for her. Every order is a request she weighs. If she judges
  the player's choices wrong, fears them, stops trusting them, or fears for her life, she
  refuses, stops them, runs, or leaves.
- **The game is 2D pixel art.** Mood borrowed from low-res "lost console game" reels: cool
  blue nights with one or two warm glowing practical lights per scene, bloom, fog, a faint
  ordered dither and vignette, smooth shaded surfaces rather than flat blocky textures (§18).
- Everything works offline and without Claude. Claude makes her deeper, never required.
- No external assets: all art is generated in code at boot into canvases; all sound is
  synthesized with WebAudio. No network calls except the optional Claude paths and Google Fonts.
- Mobile: touch joystick + buttons, a usable chat, readable panels at 390 px wide.
- Performance: 60 fps on a mid-range phone. Avoid per-frame allocations in hot loops,
  cache rendered sprites, cull to the view.
- Plain modern JavaScript (ES2020 modules), no frameworks, no runtime dependencies.

## 1. How to work

- Source lives in `src/`. `npm run build` bundles to `dist/index.html` (standalone) and
  `dist/artifact.html` (claude.ai Artifact content). `npm run dev` serves the source at
  http://localhost:5173/. `npm test` runs `tests/*.test.mjs` with `node --test`.
  `node scripts/smoke.mjs [--src] [--mobile]` runs the game headless in Chromium and fails on
  any page error. Screenshots land in `screenshots/` (git-ignored).
- **Ownership:** each agent owns the files listed for it in §15. Do not edit files you do
  not own. If you need something from another module that is not in this contract, code
  defensively (`game.x?.y?.()`) and mention it in your final report.
- Files you do not own may still be stubs while you work. Code against the contract, not
  against the stub's behavior.
- Unit tests must not need a browser: **no module may touch `document`, `window`,
  `localStorage` or `navigator` at import time** (only inside functions/constructors that run
  in the browser), so logic modules import cleanly under `node --test`. Art modules may use
  `document` inside their functions.
- Every agent works in its own git worktree on its own branch (`agent/<name>`) and commits
  there. Before finishing: `npm test`, `npm run build`, `node scripts/smoke.mjs` must pass in
  your worktree (other modules may still be stubs there — that is expected).
- Comments explain why, not what. Keep functions small and named for what they do.

## 2. Architecture

`src/core/game.js` builds every system and runs one fixed 60 Hz step:

```
input.update → clock → entities (actors run controllers: player input, Lyra's behavior,
NPC schedules, creature AI) → objects → map → combat → spawner → plugins → brain →
lighting → particles → weather → bubbles → camera → save → audio → ui → input.endFrame
```

Rendering happens once per animation frame (`renderer.render`). Everything reaches other
systems through the `game` object:

| field | type | owner |
|---|---|---|
| `game.bus` | EventBus | core |
| `game.rng` | RNG (seeded) | core |
| `game.time` | real seconds since boot (animation clock) | core |
| `game.clock` | GameClock: day/night, weather | core |
| `game.settings`, `game.setSetting(k,v)`, `game.apiKey` | settings | core |
| `game.state` | 'boot' \| 'title' \| 'playing' \| 'sleeping' | core |
| `game.paused` | true while a pause/settings menu is open (world frozen) | ui sets |
| `game.flags` | story flags object (saved) | anyone |
| `game.atlas` | sprite registry | core + art |
| `game.map`, `game.objects`, `game.locations`, `game.pathfinder`, `game.spawns` | world | world |
| `game.entities` | EntityManager | core |
| `game.player`, `game.companion` | actors | combat/behavior |
| `game.combat`, `game.spawner` | | combat / characters |
| `game.interactions` | interaction finder | core |
| `game.camera`, `game.renderer`, `game.lighting`, `game.particles`, `game.bubbles`, `game.weather` | | render |
| `game.actions` | ActionRegistry | core |
| `game.plugins` | PluginRegistry | core |
| `game.brain` | Brain | brain |
| `game.runtime` | ClaudeRuntime (claude.ai capabilities) | core |
| `game.ui`, `game.input`, `game.audio`, `game.save` | | ui |
| `game.sleep(bed)` | sleep until 7 AM, reflection, autosave | core |
| `game.isBlockedTile(tx, ty, actor)` | map + objects collision | core |
| `window.__game` | the game, for tests and debugging | core |

A world is built once per page load (`newGame()` / `continueGame()` from the title). "Quit to
title" reloads the page, so modules do not need teardown code.

## 3. Space, time, constants

- `TILE = 16` world pixels. World is `WORLD_W × WORLD_H = 160 × 120` tiles.
- Entity `x, y` = the point between the feet, in world pixels. Sprites are drawn anchored
  there. `sortY = y` for depth sorting. `z` lifts the sprite (hops, bats).
- The renderer draws the world into a low-res buffer (about 240 px on the short side, integer
  upscale) and composites lighting, text and UI at full device resolution.
- `GameClock`: `t` (game seconds), `hour` (0–24 float), `day`, `phase`
  ('dawn' 5–7, 'day' 7–18, 'dusk' 18–20.5, 'night'), `daylight` (0..1), `isNight`,
  `weather {type: 'clear'|'cloudy'|'rain'|'fog', intensity 0..1}`, `timeString()`,
  `fullString()`, `skipTo(hour)`, `setWeather(type)`. One day = 900 real seconds.

## 4. Event bus

`game.bus.on(type, fn) → off`, `bus.on('*', (type, payload) => …)`, `bus.emit(type, payload)`.
Entities in payloads are live objects (never serialize them). **Payload shapes:**

| type | payload | emitted by |
|---|---|---|
| `booted` | `{}` | game |
| `game_start` | `{loaded}` | game |
| `settings_changed` | `{key, value}` | game |
| `entity_added` / `entity_removed` | `{entity}` | entities |
| `time_of_day` | `{phase, day, hour}` | clock |
| `new_day` | `{day}` | clock |
| `time_skip` | `{hours, day, hour}` | clock |
| `weather` | `{type}` | clock |
| `damage` | `{source, target, amount, kind: 'melee'|'bolt'|'arrow'|'bite'|'magic'|'fall', crit}` | combat |
| `death` | `{entity, killer}` | combat |
| `downed` | `{entity, by}` (player or Lyra knocked out) | combat |
| `revived` | `{entity, by}` | combat |
| `heal` | `{source, target, amount}` | combat |
| `attack` | `{attacker, kind, target}` (an attack started) | combat |
| `level_up` | `{entity, level}` | combat |
| `item_gained` | `{actor, itemId, qty, from}` (from: 'pickup'|'job'|'gift'|'loot'|'chest'|'trade'|'quest') | anyone giving items |
| `item_given` | `{from, to, itemId, qty}` (one actor handing items to another) | anyone |
| `item_used` | `{actor, itemId}` (ate, drank) | combat (useItem) |
| `door` | `{door, actor, open}` | objects |
| `interact` | `{actor, target}` | interactions |
| `harvest` | `{actor, object, itemId, qty}` (chop/mine/pick/fish catch) | objects/jobs |
| `enter_location` / `leave_location` | `{actor, location}` (player and Lyra only) | world (map/objects update) |
| `player_message` | `{text}` (the player spoke to Lyra) | brain |
| `speech` | `{speaker, text, target, kind: 'say'|'bark'|'shout'|'whisper'}` (anyone spoke aloud) | brain, npcs |
| `thought` | `{owner, text}` | mind |
| `emotion` | `{owner, name, intensity, cause}` (a notable emotion spike) | mind |
| `memory_added` | `{owner, memory}` | mind |
| `relationship_changed` | `{owner, personId, changes, reason}` | mind |
| `npc_meet` | `{a, b}` (two actors met for the first time) | mind (social) |
| `conversation` | `{a, b, lines: [{speaker, text}]}` (Lyra chatted with someone) | social plugin |
| `companion_action` | `{name, args, source, ok, message, t}` | actions |
| `directive_changed` | `{directive, previous}` | behavior |
| `stance_changed` | `{stance, previous}` | behavior |
| `job_started` / `job_progress` / `job_done` / `job_failed` | `{actor, job, progress?, result?, reason?}` | behavior |
| `quest` | `{id, stage, title, text}` | quest plugin |
| `npc_topic` | `{npc, topic, player}` (the player asked a villager about a topic) | npc |
| `trade` | `{npc, itemId, qty, price, bought: bool}` | ui |
| `hit_stop` | — (combat sets `game.hitStop = max(game.hitStop, seconds)` directly; the world freezes, rendering continues) | — |
| `player_sleep` / `player_wake` | `{bed}` / `{day, reflection}` | game |
| `ui_open` / `ui_close` | `{panel}` | ui |

## 5. Art and the atlas

`src/art/atlas.js` (`game.atlas`): `add(name, frames, {ox, oy, fps})`, `get(name)`,
`has(name)`, `frame(name, i)`, `draw(ctx, name, i, x, y, {flip, alpha, flash})`,
`drawAnim(ctx, name, time, x, y, opts)`, `setMeta/getMeta`. `(ox, oy)` is the anchor
(feet / base) inside the frame. Shared tools: `src/art/pixel.js` (canvas helpers, outline,
dither, flip, recolor, silhouette) and `src/art/palette.js` (the master palette — use it).

Style: 16 px tiles, characters about 16 × 24 px inside a 32 × 32 frame, 1 px dark outline
(`OUTLINE`), light from the upper left, 3–5 tone ramps, selective dithering, no pure black.

Sprite names (each art module registers its own; others draw by these names):

- Tiles (world agent): drawn by `map.drawGround`; names are internal to the world agent.
- Props (world agent): `prop:<objType>[:variant]`, e.g. `prop:tree_oak`, `prop:tree_pine`,
  `prop:stump`, `prop:rock`, `prop:ore_iron`, `prop:crystal`, `prop:herb`, `prop:moonpetal`,
  `prop:berry_bush`, `prop:crop:<stage>`, `prop:door:<open|closed>`, `prop:chest:<open|closed>`,
  `prop:bed`, `prop:campfire`, `prop:lamp`, `prop:sign`, `prop:well`, `prop:anvil`, `prop:forge`,
  `prop:table`, `prop:barrel`, `prop:crate`, `prop:fence`, `prop:journal`, `prop:altar`, ...
- Characters (characters agent): drawn only through `drawCharacter(ctx, atlas, key, anim, dir,
  time, x, y, opts)` from `src/art/characters_art.js`. Keys: `player`, `lyra`, every NPC id, and
  every species `spriteKey`. Anims: `idle walk attack cast hurt down work sit sleep`.
  Dirs: `down up left right`. `portrait(atlas, key, expression = 'neutral') → canvas`
  (48 × 48 head-and-shoulders, more detail than the walking sprite) for the UI; expressions
  `neutral happy sad angry surprised worried love sleepy` (at least Lyra has all of them;
  others may return neutral).
- Items (combat agent): `icon:<itemId>` 16 × 16 for every item in `entities/items.js`, plus
  `icon:unknown`. `itemIcon(atlas, id) → canvas` for the DOM UI.
- FX (render agent): `fx:slash`, `fx:bolt`, `fx:arrow`, `fx:spark`, `fx:heal`, icons for
  bubbles (`fx:icon:!`, `fx:icon:?`, `fx:icon:heart`, `fx:icon:zzz`, `fx:icon:anger`,
  `fx:icon:note`, `fx:icon:sweat`, `fx:icon:...`).

## 6. World

### Map (`src/world/map.js`, class `TileMap`)
`w, h, ground, deco, buildings`, `inBounds`, `tileAt`, `set`, `isSolidTile(tx, ty, actor)`
(walls, water, void; flyers ignore water), `isWater(tx, ty)`, `blocksProjectile(tx, ty)`,
`buildingAt(tx, ty) → building | null`, `isIndoors(px, py)`,
`drawGround(ctx, ox, oy, vw, vh, time)`, `drawRoofs(ctx, ox, oy, vw, vh, time, viewer)`
(the roof of the building the viewer stands in fades out), `update(dt)`.
Building: `{ id (= its location id), name, x, y, w, h (tiles), doorTiles: [{tx, ty}] }`.

### Objects (`src/world/objects.js`)
`WorldObject` fields: `id, objType, name, tx, ty, x, y` (anchor: bottom-center of base tile),
`solid, state, sortY`; methods `blocksTile(tx, ty, actor)`, `update(dt)`,
`draw(ctx, ox, oy, time)`, `getLight(time)`, `canInteract(actor)`, `interactLabel(actor)`,
`interact(actor)`, `serialize()`, `deserialize(d)`.

Harvestable objects also implement the **work API** used by Lyra's jobs and by the player:
`canWork(actor) → bool`, `work(actor, dt) → { done: bool, progress: 0..1, items?: [{id, qty}] }`
(call every step while working; returns items once when done), `workSeconds`.

`ObjectManager`: `add, remove, get(id), all(), update(dt), isBlockingTile(tx, ty, actor),
doorAt(tx, ty), inRadius(x, y, r, filter), nearest(typeOrFilter, x, y, r),
findByWord(word, x, y), inView(x, y, w, h, margin), serialize(), deserialize(list)`.

Object types (`objType`) and behavior:

| objType | notes |
|---|---|
| `door` | `open(actor) → bool`, `close(actor)`, `isOpen`, `locked`, `state.keyId`. Unlocks if the actor carries the key. Emits `door`. |
| `tree` | variants oak/pine. Work 3 s → 2–3 `wood`, becomes a stump, regrows after ~1 in-game day. |
| `rock` | → `stone`. `ore` (iron) → `iron_ore`. `crystal` → `crystal` (ruins only). Regrow slowly. |
| `herb` | → `herb`. `moonpetal` → `moonpetal`, only pickable at night (glows). `berry_bush` → `berries`. Regrow. |
| `crop` | Tobias's field. stages 0–3; stage 3 harvest → `turnip` or `wheat`; replants to 0; grows over time. |
| `chest` | `inventory` (an `Inventory`); interact opens the storage UI (`game.ui.openChest(chest)`). `home_chest`, `bandit_chest`. |
| `bed` | interact → `game.sleep(bed)`. `home_bed` (player), `lyra_bed`. |
| `campfire` / `hearth` | light source; cooking spot. `inn_hearth`, `camp_campfire`, `lake_campfire`. |
| `lamp` | light at night (auto-lit from dusk). Street lamps around the village. |
| `sign` | interact shows its text (`game.ui.toast` or a small dialog). `notice_board` gives hints. |
| `well`, `anvil`, `forge`, `table`, `chair`, `barrel`, `crate`, `fence`, `altar`, `shelf`, `tent`, `ruin_pillar`, `statue` | decor; some solid; forge/altar give light. |
| `journal` | `maren_journal` in the deepest ruins room. Interact → player gets item `maren_journal`; emits `item_gained` and sets `game.flags.journal_found = true`. |
| `fishing_spot` | an invisible marker on the dock: preferred place for the `fish` job. |
| `window` | glows warm at night (light source), on building walls. |

### Locations (`src/world/locations.js`, already implemented)
`LocationIndex`: `all(), get(id), at(px, py), find(text), describe(loc)`. Location fields:
`{id, name, kind, bounds (tiles), center (px, walkable), description, danger 0..3, indoor,
aliases, parent}`. **Required ids** (other modules reference them):

| id | name | kind | where / notes |
|---|---|---|---|
| `hearthvale` | Hearthvale | village | center of the map |
| `town_square` | Town Square | square | well, notice board, lamps |
| `player_home` | Your Cottage | home (indoor) | `home_bed`, `lyra_bed`, `home_chest`, table |
| `ember_kettle` | The Ember Kettle | building (indoor) | inn of Elda; `inn_hearth`; aliases inn, tavern, kettle |
| `smithy` | Ironhand Smithy | building (indoor) | Bram; anvil, forge |
| `general_store` | Gale's Goods | building (indoor) | Garrick; aliases shop, store, market |
| `chapel` | Chapel of the Hearth | building (indoor) | Sister Aveline; altar, candles |
| `herbalist` | Fennick's Herbs | building (indoor) | Mira |
| `guardhouse` | Guardhouse | building (indoor) | Captain Rowan |
| `farmhouse` | Reed Farmhouse | building (indoor) | Tobias |
| `reed_farm` | Reed Farm | field | crops |
| `whisperwood` | Whisperwood | forest | north; trees, herbs, moonpetals, berries; wolves, boars, deer, rabbits |
| `stonecut_quarry` | Stonecut Quarry | field | northwest; rocks, iron ore; slimes |
| `bandit_camp` | Bandit Camp | camp | northeast; tents, `camp_campfire`, `bandit_chest` (holds `ruins_key`, coins, a potion) |
| `mirror_lake` | Mirror Lake | lake | east; dock with `fishing_spot`, `lake_campfire`; slimes on the shore |
| `sunken_ruins` | Sunken Ruins | ruins | southwest; walled; one entrance `ruins_gate` (door, locked, keyId `ruins_key`); skeletons, bats at night, crystals, `maren_journal` deepest inside |
| `south_meadow` | South Meadow | field | south; flowers, rabbits, slimes |
| `kings_road` | King's Road | road | roads linking everything |

### Pathfinding (`src/world/pathfind.js`)
`new Pathfinder(game)`; `find(sx, sy, gx, gy, {maxNodes = 6000, allowDoors = true, actor})`
→ `[{x, y}]` pixel waypoints (tile centers, last = goal) or `null`. Closed unlocked doors are
passable (with extra cost); locked doors are passable only when `actor` holds the key. 8-way
with no corner cutting, then smoothed with line-of-walk checks. Must finish in < 4 ms for a
cross-map path; cache per tile pair for a second if needed.

### Worldgen (`src/world/worldgen.js`)
`generateWorld(game, seed) → { map, objects, locations, spawns }` with
`spawns = { player: {x, y}, companion: {x, y}, npcs: [{id, x, y}], creatures: [{species, x, y, opts}],
spawnZones: [{ id, locationId, species: [names], max, night: bool|undefined, rect: {x, y, w, h} (tiles) }] }`.
The player and Lyra start on the road just outside their cottage door at 8 AM. Deterministic
for a seed. Hand-shaped layout (not random noise soup): roads, fences, gardens, flower beds,
a stream with a bridge, forest edges with undergrowth, lily pads, ruins with broken walls.

## 7. Entities

`src/entities/entity.js` (implemented): `Entity` and `Actor`. Actor fields used everywhere:
`id, name, kind, faction, hp, maxHp, atk, def, speed, level, xp, dir, facing {x,y}, state,
stateTime, animTime, lockTime, moveIntent {x,y}, speedMul, knock, invuln, flash, attackCd,
downed, inventory, controller, spriteKey, perceptionRadius, lastAttacker, lastAttackedAt,
flying, light`; methods `isAlive(), setState(state, lockSeconds), faceToward(x, y), faceDir(d),
getLight(), draw(), serialize(), deserialize()`. States: `idle walk attack cast hurt downed dead
work sit sleep`. Controllers set `moveIntent` (length ≤ 1); the base class moves with collision.
`FACTION_RELATIONS` / `factionRelation(a, b)` → 'ally' | 'neutral' | 'hostile'.

### Player (`src/entities/player.js`)
`new Player(game, {x, y})`, id `player`. Controls: move, `attack` (sword swing, short combo),
`dodge` (quick roll with i-frames, 0.8 s cooldown), `interact`. Walks over pickups to collect
them. When downed: fade, wake in the cottage bed at 50% HP, lose 10% of coins; emits `downed`.
`player.gold` is a number mirrored with the `coin` item (use the inventory's `coin` count as
the source of truth; `gold` is a getter).

### Companion (`src/entities/companion.js`)
`new Companion(game, {x, y})`, id `lyra`, faction `player`, `mind = new Mind(game, this)`,
`behavior = new Behavior(game, this)` (also her controller). Interact → opens the chat
(or revives her when downed). Ranged arcane bolts (glowing light), dagger when close,
heal spell. Never dies: at 0 HP she is `downed`; the player revives her by interacting;
after 60 s she gets up alone at 15% HP.

### NPCs (`src/entities/npc.js`, `src/entities/npc_data.js`)
`new NPC(game, profile, {x, y})`. Required villagers:

| id | name | role | personality sketch |
|---|---|---|---|
| `bram` | Bram Ironhand | blacksmith | gruff, kind, widower; secretly writes poetry |
| `elda` | Elda Thornbury | innkeeper | warm, motherly, loves gossip; looks after Pip |
| `pip` | Pip | orphan child | curious, brave, adores Lyra's magic, follows the stray cat |
| `rowan` | Captain Rowan Vale | guard captain (faction `guard`, fights) | stern, dutiful, worried about the bandits |
| `mira` | Mira Fennick | herbalist | gentle, shy, sweet on Rowan |
| `tobias` | Tobias Reed | farmer | anxious, kind, fights boars off his turnips |
| `aveline` | Sister Aveline | keeper of the chapel | calm, wise; knew Maren and saw her head for the ruins |
| `garrick` | Garrick "Gale" Hale | merchant | cheerful haggler, knows the roads |

Profile schema (`NPC_PROFILES` entries):
```js
{ id, name, role, faction, appearance: {skin, hair, hairStyle, outfit, ...},
  personality: 'two sentences', traits: ['gruff', ...], age, voice: 'how they talk',
  home: 'smithy', work: 'smithy',
  schedule: [{ from: 6, to: 18, activity: 'work'|'wander'|'eat'|'sleep'|'socialize'|'patrol'|'pray'|'farm', at: 'locationId' }],
  facts: [{ id, text: 'something Lyra can learn', minFamiliarity: 0..100, topic: 'family'|'work'|'secret'|'village'|'maren'|... }],
  likes: ['iron_ore', ...], dislikes: [...], greetings: [...], lines: { day: [...], night: [...], rain: [...] },
  knows: { otherNpcId: 'what they think of them' }, shop?: { sells: [{id, price}], buys: {itemId: price} } }
```
`npc.profile`, `npc.role`, `npc.activity` (current schedule activity), `npc.opinionOfPlayer`
(0..100), `getDialogue(player) → { lines: [string], options: [{id, label}] }`,
`chooseOption(id, player) → { lines, options?, close?, open?: 'gift'|'shop' }`
(options include talk, give a gift, trade for shops, ask about Lyra / Maren / the village,
goodbye; asking about a topic emits `npc_topic {npc, topic, player}` — e.g. topic `maren`),
`receiveGift(itemId, giver) → { lines, liked: -1|0|1 }` (the UI removed the item already),
`say(text, {kind})` (bubble + `speech` event), `hears(speaker, text)` (optional reaction).
Shops: `profile.shop = { sells: [{id, price}], buys: { itemId: price } }`; the UI performs
trades with the `coin` item and emits `item_gained`. NPCs follow schedules with the
pathfinder, open doors, sleep at night, flee from monsters (guards fight), greet the player,
and react to Lyra.

### Creatures (`src/entities/monsters.js`, `src/entities/spawner.js`)
`SPECIES` table and `spawnCreature(game, species, x, y, opts) → Creature` (`.species`).
Species: `slime` (monster), `wolf` (monster, packs, more at night), `boar` (wildlife, charges
when hurt), `deer`, `rabbit` (wildlife, flee), `chicken`, `cat` (village, the stray Pip
follows; `cat` is never hostile), `bat` (monster, flying, ruins/night), `skeleton` (undead,
ruins), `bandit` (bandit, sword), `bandit_archer` (bandit, arrows), `bandit_chief` (bandit,
tougher, at the camp). Each: hp, atk, def, speed, xp, drops `[[itemId, chance, qty?]]`,
aggro radius, AI: idle/wander → notice → chase/attack (or flee) → leash back home.
Every creature instance exposes `creature.drops` (that list) and `creature.xpValue`, which
`combat.kill` uses for loot and experience, plus `creature.species`, `creature.home {x, y}`,
`creature.aggroRadius`, and `creature.threat` (0..3, how dangerous it is, for Lyra's targeting).
`Spawner(game, zones)` keeps zones populated (out of the player's view, respecting `night`).

### Combat (`src/entities/combat.js`)
```
isHostile(a, b)                     faction-based hostility (FACTION_RELATIONS)
melee(attacker, {target?, arc, range, damageMul}) → bool     swing in facing direction
shoot(attacker, tx, ty, kind = 'bolt'|'arrow', {damageMul, target}) → Projectile|null
castHeal(caster, target) → amount   (Lyra's spell: green particles, light flash, sound)
heal(source, target, amount) → amount
damage(source, target, amount, {kind, knockback, crit}) → dealt
kill(target, killer)                 death, xp to killer, loot drops, emits death
down(target, by) / revive(target, by, hpFraction)
useItem(actor, itemId) → bool        eat/drink: heals by item.heal, emits item_used
giveXp(actor, amount)                level ups (+maxHp, +atk), emits level_up
```
Damage feedback: flash, knockback, hit-stop (brief time freeze ≈ 50 ms on big hits),
`bubbles.number`, particles `hit`, camera shake when the player is hit, sounds.

### Items (`src/entities/items.js`, implemented)
`ITEMS`, `itemDef`, `itemName`, `resolveItemId(text)`, `Inventory` (`count has add remove
transfer list isEmpty describe serialize deserialize`). Item ids are a contract; the combat
agent may add items (`turnip`, `wheat` are needed by crops/cooking) but never renames.
Pickups: `dropItem(game, itemId, qty, x, y)` (`src/entities/pickups.js`).

## 8. Rendering (`src/render/*`, `src/core/camera.js`)

- `Renderer(game, canvas)`: `resize()`, `render(alpha, frameDt)`, `scale`, `dpr`,
  `buffer` (low-res canvas), `bufferToCss(bx, by)`, `worldToCss(wx, wy)` (for DOM overlays).
  Draw order: ground → shadows → y-sorted objects + entities (+ projectiles/pickups) → roofs →
  particles → upscale (with sub-pixel camera smoothing) → lighting (ambient by `clock.daylight`,
  warm point lights, additive glow) → weather overlay → bubbles/numbers/name tags (full res) →
  vignette. Title state: an animated scene behind the title UI.
- `Camera`: `x, y` (top-left, world px), `vw, vh`, `follow(e)`, `snap()`, `shake(s, t)`,
  `update(dt)`, `worldToScreen`, `screenToWorld`.
- `Lighting`: lights are **collected each frame** from entities/objects near the view through
  `getLight(time)`; `flash({x, y, r, color, intensity, duration})` for transient light.
- `Particles`: `emit(type, x, y, opts)`, `update(dt)`, `draw(ctx, ox, oy)`.
- `Bubbles`: `say(entity, text, {kind, duration})`, `thought(entity, text)`,
  `icon(entity, name)`, `number(x, y, text, color)`, `clear(entity)`, `update`, `draw`.
  Speech types out at `settings.textSpeed`; wraps to ≈ 26 characters; never overlaps the
  screen edge; Lyra's bubble is tinted with her arcane color.
- `Weather`: rain (streaks + splashes + darker ambient), fog layers, fireflies at night in the
  forest and meadow, falling leaves in the forest.

## 9. Lyra's mind (`src/ai/mind/*`)

`new Mind(game, owner)`; `owner.mind`. Public interface:

```
soul                 identity (see below); editable by the player in the Soul tab
emotions             { joy, sadness, fear, anger, trust, surprise, affection, curiosity, pride, embarrassment } 0..1, decaying
needs                { energy, hunger, social, fun, safety } 0..1 (1 = satisfied), drifting
memory               Memory store (below)
relationships        Relationships store (below)
goals                [{ id, text, priority 0..1, source: 'soul'|'player'|'self'|'quest', done }]
thoughts             [{ text, t, source }] newest last, capped (≈ 80)
diary                [{ day, text, t }] written at sleep
conversation         [{ role: 'player'|'lyra', text, t }] recent chat, capped (≈ 40)
knowledge            facts about places/things: [{ subject, text, t, source }]

update(dt)                         drift needs, decay emotions, periodic idle thoughts
perceive(event)                    (internal) bus events → appraisal → emotions/memories/relationships
addThought(text, source)           emits `thought`
feel(name, amount, cause)          bump an emotion (emits `emotion` when ≥ 0.25)
mood() → { label, valence -1..1, arousal 0..1, emoji }
remember(text, { importance 1..10, about: [ids], tags, type: 'event'|'fact'|'conversation'|'reflection', location }) → memory
recall(query, { limit = 6, about }) → memories (scored by relevance + importance + recency)
learn(subject, text, source)       add knowledge
addGoal(text, priority, source) / completeGoal(id)
describeState() → short paragraph: mood, needs, what she's doing, where (for prompts)
summary() → compact object for the UI header
serialize() / deserialize(d)       must stay under ≈ 150 KB (prune low-importance memories)
```

**Soul** (`soul.js`, default for Lyra; editable): `name, fullName, age, pronouns ('she/her'),
origin, backstory, appearance, personality (Big Five 0..1: openness, conscientiousness,
extraversion, agreeableness, neuroticism), values [], likes [], dislikes [], fears [], dreams [],
quirks [], speechStyle, secrets [{text, revealAtBond}]`. Lyra: 24, arcane ranger from the
Glasswater Isles; came to Hearthvale following her mentor **Maren Ashgrove**, who vanished near
the Sunken Ruins three months ago. Warm, witty, teasing, brave, fiercely loyal once trust is
earned; protects the defenseless; hates cruelty, lies and bandits; loves moonpetals, honey
cakes, stargazing, old books, rain on roofs; afraid of deep water and of losing people; dreams
of finding Maren and teaching magic to kids like Pip. Secret: she could not save her little
brother Cal from a fever. She met the player two days ago on the King's Road when wolves
attacked and the player stood beside her; she owes them, and is curious about them.

**Memory**: episodic entries `{ id, t (game time), day, text, type, importance, about [ids],
location, tags, emotion, uses }`. Retrieval scoring = keyword overlap + entity match +
importance + recency (exponential decay by game days). Consolidation at sleep: prune
low-importance old entries, keep the important ones forever. Seeded with first memories.

**Relationships** (`relationships.js`, the data store behind the relationships plugin):
```
get(idOrName) → rel | null      ensure(entityOrId, {name, kind}) → rel
all() → rel[] (sorted by bond)  adjust(id, { affinity, trust, respect, familiarity, fear }, reason)
addNote(id, text, source)       setTag(id, tag, on = true)   setOpinion(id, text)
isFriend(entity) → bool         isEnemy(entity) → bool        bond(id) → { level 0..5, label, score }
```
`rel = { id, name, kind, role, affinity -100..100, trust 0..100, respect 0..100,
familiarity 0..100, fear 0..100, tags: ['friend'|'enemy'|'family'|'rival'|'crush'|'mentor'|...],
notes: [{ text, source: 'observed'|'told'|'player'|'self', t }], opinion: 'her own words',
firstMet, lastSeen, interactions, history: [short strings] }`.
Bond labels by score: Stranger, Acquaintance, Companion, Friend, Close friend, Kindred spirit.
**isFriend(e)** is the attack-mode filter: true for the player and Lyra; for anyone tagged
`friend`; for anyone with affinity ≥ 30; for villagers and guards unless tagged `enemy`;
false for anyone tagged `enemy`. Animals she has named or adopted (tag `pet`) are friends.
**isEnemy(e)**: tagged `enemy`, or affinity ≤ −40, or hostile faction.

**Perception**: the mind subscribes to the bus and appraises events: being hit (fear/anger,
attacker becomes enemy), the player being hit (anger, protectiveness), kills, heals given or
received (trust and affinity), gifts (likes/dislikes from soul), new people (npc_meet, first
impression memory), entering places (curiosity, place knowledge), night/rain (mood shifts),
doors, jobs done (pride), being revived ("you came back for me": large trust gain, importance 9).
Throttle: a burst of identical events makes one memory, not ten.

**Spontaneous thoughts**: every ≈ 25–45 s of play the mind may produce a thought from what is
around her (place, weather, people, needs, goals, a recalled memory). It is stored in
`thoughts`, emitted as `thought`, and — only when `settings.showThoughts` is on and no speech
bubble is showing — displayed with `game.bubbles.thought(owner, text)` at most once per ≈ 30 s.

**Quest arc (quest plugin).** Stages of quest id `maren`, each emitting
`quest {id: 'maren', stage, title, text}` and exposing `questPlugin.objective(ctx) → string`:
0 `settle` "Settle into Hearthvale — meet the villagers." → after Lyra has met 3 villagers or
day 2 begins, Lyra asks for help: 1 `ask_aveline` "Ask Sister Aveline about Maren." (done on
`npc_topic {npc: aveline, topic: 'maren'}` or Lyra talking to Aveline about Maren) →
2 `find_key` "The ruins gate is locked. The bandits northeast may have the key." (done on
`item_gained ruins_key` by the player or Lyra) → 3 `enter_ruins` "Search the Sunken Ruins."
(done on `enter_location sunken_ruins`) → 4 `find_journal` "Find a sign of Maren deep in the
ruins." (done on `item_gained maren_journal`) → 5 `read_journal` "Let Lyra read the journal."
(the `read_journal` action, or automatically when the player gives it to her) → 6 `waygate`
"Maren went north through the old waygate. To be continued…" (quest complete; Lyra's goals
update; a big emotional memory, importance 10).

## 10. Behavior (`src/ai/behavior/*`, `src/entities/companion.js`)

`new Behavior(game, actor)`; it is Lyra's controller (`update(actor, dt)`). Public interface:

```
directive            { type, ...params }  (current standing order)
stance               'attack' | 'defend' | 'passive'
setDirective(d) → { ok, message }   types:
   follow  { target: 'player'|id, distance: 'close'|'normal'|'far' }
   stay    { x, y } (hold position; default here)
   wait    { seconds, then: previousDirective }   (pause, then resume)
   goto    { target: ref (entity|location|object|'x,y'), then: 'stay'|'follow'|'return' }
   job     { job: jobId, amount, deliverTo: 'player'|'chest'|'keep', targetRef? }
   guard   { x, y, radius }  or { target: id }   (defend an area or a person)
   patrol  { points: [{x,y}] } or { location: id }
   explore { location: id }
   free    {}   (her own free will: wanders near you, gathers, chats, rests)
setStance(mode) → { ok, message }
focus(entityOrRef) → { ok, message }    attack a specific target now (refuses friends, see §12)
clearFocus()
retreat()                               disengage and regroup with the player
emote(name)                             wave | laugh | bow | dance | hug | think | sit | cheer | shrug | cry | angry
interactWith(objectOrEntity)            walk there and use it (doors, chests, beds, campfire)
status() → string                       "following you", "chopping wood (3/5)", "holding position"...
currentTarget → entity | null           who she is fighting
serialize() / deserialize(d)
```

Behavior runs a priority list every step: (1) downed/incapacitated, (2) survival (low HP:
drink a potion if she has one, heal herself, or fall back to the player), (3) support (heal
the player under 50% HP, 12 s cooldown), (4) combat per stance, (5) the directive,
(6) idle life (look around, comment, sit by fires, pick a flower). Movement uses the
pathfinder with door opening (she opens closed doors on her path and closes them behind her
indoors), stuck detection and re-pathing, and teleports to the player only when far away and
off-screen (> 30 tiles) while following.

**Stances.**
- `attack` (attack mode): engages **every creature that is not a friend** within ≈ 150 px of
  her (or of the guard point): hostile factions, bandits, wild animals, and anyone tagged
  `enemy`. Never targets anyone for whom `mind.relationships.isFriend(e)` is true. Keeps
  going until nothing is left, then resumes the directive. No permission asked.
- `defend` (default): fights hostiles that attack or approach the player or her (≈ 90 px),
  plus anything the player is fighting.
- `passive`: never attacks; keeps distance from threats; still heals.

**Combat AI**: prefers range (arcane bolt, 1.1 s cooldown, damage ≈ atk) at 40–110 px, kites
away from melee enemies, uses the dagger when cornered, picks targets by threat (attacking
the player > attacking her > closest), leads moving targets a little, shouts short barks.

**Jobs** (`jobs.js`): `chop_wood`, `gather_herbs` (herbs; moonpetals at night), `forage`
(berries + herbs), `mine_ore` (ore and stone; crystals in the ruins), `fish` (dock or any
shore), `farm` (help Tobias: harvest ripe crops), `cook` (at a campfire/hearth: raw_fish →
cooked_fish, 2 turnip → stew, 2 wheat → bread), `collect_loot` (pick up nearby pickups),
`patrol`, `guard`. Each job: find the nearest valid object (pathfinder), walk, work with the
work API and the `work` animation, repeat until `amount`, then deliver (`player`: walk to the
player and hand over with `item_given`; `chest`: put into `home_chest`; `keep`). Jobs emit
`job_started/progress/done/failed` and keep working through stance combat interruptions.
A job fails politely (reason in words) when nothing valid is reachable.

## 11. Plugins (`src/ai/plugins/*`)

Interface: see the header of `src/ai/plugins/registry.js`. Registered in
`src/ai/plugins/index.js` (fixed file names and export names):

| file | export | owner | provides |
|---|---|---|---|
| `core_commands.js` | `coreCommandsPlugin` | behavior | follow, stay, wait, goto, come_here, set_combat_mode, attack, retreat, guard, patrol, explore, free_will, emote, sit |
| `world_plugin.js` | `worldPlugin` | behavior | open_door, close_door, pick_up, give_item, use_item, interact, sleep |
| `jobs_plugin.js` | `jobsPlugin` | behavior | start_job, stop_job |
| `relationships_plugin.js` | `relationshipsPlugin` | mind | set_relationship, note_about |
| `memory_plugin.js` | `memoryPlugin` | mind | remember, forget |
| `feelings_plugin.js` | `feelingsPlugin` | mind | set_goal, complete_goal, express (an emotion, with bubble icon) |
| `social_plugin.js` | `socialPlugin` | mind | talk_to (walk to a person and converse; learns facts) |
| `quest_plugin.js` | `questPlugin` | mind | read_journal (Maren arc), quest stage tracking, objective text |

Each plugin also supplies `intents` for the offline brain and `promptContext` for Claude
(e.g. relationships: who is nearby and what she thinks of them; memory: recalled memories for
the player's message; quest: current objective). Keep every `promptContext` under ≈ 900 chars.

**Intent shape** (read by the brain's offline NLU, which tries plugin intents in registration
order on each clause of the player's message, then its own built-in intents):
```js
{
  id: 'rel.opinion',                                   // unique, '<plugin>.<name>'
  patterns: [/\bwhat do you think (?:of|about) (?<who>[\w' -]+)/i],
  command: false,       // true = an order (runs at once, before Claude is asked)
  confidence: 0.85,     // 0..1, default 0.85
  actions(m, ctx) { return [{ name: 'follow', args: { target: 'player', value: null, amount: null } }]; },  // optional
  answer(m, ctx, results) { return "Bram? Gruff as a bear, kind as one too."; },                           // optional
}
```
`m` is the RegExp match (named groups encouraged). `results` = the `{ ok, message }` list from
the actions just run (so the answer can report a refusal). `answer` returns Lyra's line in her
voice, or `null` to let the brain compose one. Patterns must be specific enough not to fire on
unrelated chat.

## 12. Action catalogue

All actions take `{ target, value, amount }` (strings / number / null). The registry
normalizes args. `run()` returns `{ ok, message }`; `message` is in Lyra's voice when it
explains a refusal or a problem ("I can't reach the ruins gate — it's locked.").

| action | target | value | amount | effect |
|---|---|---|---|---|
| `follow` | who (default player) | 'close'/'normal'/'far' | | directive follow |
| `stay` | place ref (optional) | | | hold position here (or go there and hold) |
| `wait` | | | seconds (default 30) | pause, then resume previous directive |
| `come_here` | | | | walk to the player, then follow |
| `goto` | place/person/object ref | then: 'stay'/'follow'/'return' | | travel there |
| `set_combat_mode` | | 'attack'/'defend'/'passive' | | stance |
| `attack` | who | | | focus a target now; **refuses** if `isFriend(target)` (says why). Every action requested by the player first passes her consent gate (§16.4) |
| `retreat` | | | | disengage, regroup with the player |
| `guard` | place/person (default here) | | radius px | guard directive |
| `patrol` | location (default current) | | | patrol directive |
| `explore` | location | | | explore directive |
| `free_will` | | | | directive free |
| `emote` | | emote name | | play an emote |
| `sit` | | | | sit down (or by the nearest fire/bench) |
| `open_door` / `close_door` | door ref (default nearest) | | | |
| `pick_up` | item name (optional) | | | collect nearby pickups |
| `give_item` | who | item | qty | walk over and hand items from her inventory |
| `use_item` | | item | | eat/drink from her inventory |
| `interact` | object ref | | | walk to an object and use it |
| `sleep` | | | | go to her bed and sleep (night) |
| `start_job` | deliver_to: 'player'/'chest'/'keep' | job id | amount | start a job |
| `stop_job` | | | | stop the current job |
| `talk_to` | who | topic | | walk over and converse (social plugin) |
| `set_relationship` | who | tag ('friend','enemy','rival','crush','family','pet', or '-tag' to remove) | affinity delta (−20..20) | relationship change |
| `note_about` | who | note text | | add a note about a person |
| `remember` | about who (optional) | text | importance 1..10 | store a memory |
| `forget` | | text to match | | drop a matching memory (she may refuse for important ones) |
| `set_goal` | | goal text | priority 0..1 | add a personal goal |
| `complete_goal` | | goal text/id | | mark done |
| `express` | | emotion name | intensity 0..1 | feel and show an emotion |
| `read_journal` | | | | read Maren's journal (if carried) |

## 13. Brain (`src/ai/brain/*`, `src/platform/claude_runtime.js`)

`game.brain`:
```
init()                                  pick a provider from settings and runtime
update(dt)                              barks (rate-limited), pending replies
handlePlayerMessage(text) → Promise<{ say, thought, actions, provider }>
reflect(reason = 'sleep') → Promise<{ diary, summary } | null>     end-of-day reflection
generateConversation(npc, topic) → Promise<{ lines: [{speaker:'lyra'|'npc', text}], learned: [string], affinity } | null>
llmAvailable() → bool
status() → { provider: 'claude.ai'|'api'|'local', label, busy, lastError }
serialize() / deserialize(d)
```

**Message flow.** Echo the player's line in the chat; emit `player_message`; Lyra faces the
player with a `…` thinking icon. The **offline NLU** runs first: if the message is a clear
command (confidence ≥ 0.8: "follow me", "attack mode", "stay here", "chop some wood"), the
actions run immediately and a short acknowledgement bark shows, so the game never waits on a
network call. If Claude is available, the message (plus what already ran) goes to Claude for
the real reply and any further actions; otherwise the offline mind composes the reply.

**Providers.**
1. `claude.ai` — `game.runtime.sample` (Artifact `sample` capability):
   `sample.json(prompt, { modelTier: settings.modelTier, cache: false, signal })`. Only ever
   called in response to a player action (a message, a sleep, a "talk to" order). Errors:
   `not_granted` / `sampling_disabled` / `not_declared` / `capability_*` → disable for the
   visit (`runtime.disable('sample')`) and say so once in the chat; `rate_limited` → offline
   reply plus a note; `refused` → in-character deflection; `invalid_json` → use `e.text` as
   plain speech if it looks like speech, else offline reply; `upstream_error` → offline reply.
   Never retry from a loop.
2. `api` — the player's own key (self-hosted copies only; claude.ai blocks the network):
   load the official SDK lazily from `https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.6.0/+esm`
   with `await import(url)` where `url` is a variable (so esbuild does not try to bundle it).
   `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })`, then
   `client.beta.messages.create({ model: settings.apiModel (default 'claude-opus-5-5'),
   max_tokens: 2048, system: [{ type: 'text', text: STABLE_SYSTEM, cache_control: { type: 'ephemeral' } }],
   messages: [{ role: 'user', content: contextAndMessage }],
   output_config: { effort: 'low', format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
   betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })`.
   Do not send `temperature`/`top_p`/`top_k` or `thinking: {type:'disabled'}` (400 on current
   models). Check `stop_reason === 'refusal'` before reading content; parse the first text
   block with `JSON.parse`. Errors by class: `Anthropic.AuthenticationError` (bad key → tell
   the player), `Anthropic.RateLimitError`, `Anthropic.APIConnectionError`, `Anthropic.APIError`.
   Keep the system prompt byte-stable (no timestamps) so it caches.
3. `local` — the offline mind: NLU + templated, personality- and mood-aware speech.

**Prompt** (`prompt.js`). Stable part: who Lyra is (soul), how she speaks, her values and
limits, the game world in brief, the action catalogue (`game.actions.catalogText()`), and the
output format. Dynamic part: time/weather/place, her state (`mind.describeState()`), HP of
both, current directive/stance/job, nearby people and creatures with ids, faction and her
relationship summary, her inventory, plugin `promptSections(message)` (recalled memories,
relationships, quest), the last ≈ 12 conversation turns, actions already executed, and the
player's message. Total under ≈ 12 KB. Lyra speaks in first person, 1–3 short sentences
(longer only when the player asks for a story), never mentions being an AI, a model, a game or
JSON, and keeps content PG-13 (romance, if the player pursues it and the bond is high, stays
tender and tasteful).

**Response JSON** (same for both Claude providers; validate and coerce everything):
```json
{
  "thought": "private inner monologue, 1-2 sentences",
  "say": "what she says aloud (may be empty)",
  "emotion": { "name": "joy|sadness|fear|anger|trust|surprise|affection|curiosity|pride|embarrassment|calm", "intensity": 0.0 },
  "actions": [ { "name": "set_combat_mode", "target": null, "value": "attack", "amount": null } ],
  "memories": [ { "text": "...", "importance": 5, "about": ["player"] } ],
  "relationships": [ { "person": "player", "affinity": 2, "trust": 1, "respect": 0, "note": "...", "tag": null, "opinion": null } ],
  "goal": null
}
```
(`RESPONSE_SCHEMA` for structured outputs: every object has `additionalProperties: false` and
lists all properties in `required`, using `null` types for optional values; numbers clamped
after parsing.)

**Offline mind.** `nlu.js`: normalize text, split multi-clause commands ("follow me and
attack anything"), match plugin intents + built-in patterns, extract targets (names, "me",
"that wolf", places, items, numbers, "5 wood"). Questions it answers from data: feelings
(emotions/needs), opinions ("what do you think of Bram?" → relationship opinion/notes),
memories ("do you remember…", "what happened today"), knowledge ("who is Aveline?", "where
is the smithy?"), status ("what are you doing?"), inventory, the time, her past (soul),
the quest. Small talk with variety (greetings, thanks, compliments, jokes, flirting handled
in character, insults handled in character with relationship effects). `speech_gen.js`:
templates with slots and variants keyed by personality, mood and bond, avoiding repeats.
**Barks**: short contextual lines on events (combat start, low HP, kills, new place, night,
rain, seeing a friend, finding loot, idle musings that reference real memories/goals); at most
one every ≈ 20 s, never over a chat reply.

**Reflection** (sleep): Claude (tier `default`) or the offline mind writes a diary entry
(first person, ≈ 80–150 words) from the day's most important memories, updates her opinion of
people she spent time with, consolidates memories, and may add a goal. The UI shows it.

**Voice.** If `settings.voice` is on: `runtime.tts.speak(text, { voice: settings.voiceName })`
for her chat replies (catch every rejection; `not_granted` → turn the setting off). When `tts`
is null, fall back to `speechSynthesis` with a female-sounding voice if available.

## 14. UI, input, audio, saving (`src/ui/*`, `src/core/input.js|audio.js|save.js`, `src/styles.css`)

**Visual identity.** Deep twilight indigo panels with warm ember light; arcane violet for
Lyra; healing green; danger coral. Display font "Pixelify Sans" (headings, HUD numbers,
buttons), body font "Alegreya Sans" (chat, diary, panels) with fallbacks
(`ui-rounded, system-ui, sans-serif`). Pixel-crisp 2 px borders, small shadows, no generic
rounded-card look. CSS tokens on `:root`; the game commits to a single dark look
(`color-scheme: dark`, explicit backgrounds). Respect `prefers-reduced-motion`.
Safe areas: HUD offsets use `env(safe-area-inset-*)`. Never use `alert/confirm/prompt`
(blocked in Artifacts): build confirmations into the UI.

**Screens and panels.**
- Title: game name, an animated scene behind, "Continue" (when a save exists), "New game",
  "Settings", "How to play"; a line showing which mind Lyra uses.
- HUD: player HP/XP, coins; Lyra's portrait with HP, mood emoji, current stance badge and
  status text ("following you · attack mode"); place name + clock + weather icon; the
  interact prompt ("E · Talk to Bram"); the quest objective; toasts.
- Command bar (always visible, also on mobile): Follow, Stay, Attack mode, Defend, Passive,
  Jobs ▾ (chop wood, gather herbs, fish, mine, forage, cook, collect loot), Talk. These call
  `game.actions.run(name, args, 'player')` and Lyra barks an acknowledgement.
- Chat (`ui.chat`: `open() close() toggle() isOpen() addMessage({from: 'player'|'lyra'|'system'|'npc', text, name}) setThinking(on)`):
  message log, text field, Send, mic button (dictation, see below), quick-reply chips.
  Opening it must not pause the world. Typing disables game keys (`input.enabled = false`).
- Lyra's Mind panel (`ui.openMind(tab)`): tabs **Now** (mood, emotions bars, needs, current
  thought stream, directive/stance/job), **People** (every relationship: portrait, bond label
  and bars, tags, opinion in her words, notes she knows; buttons to mark friend/enemy),
  **Memories** (searchable, importance stars, by day), **Diary**, **Goals**, **Soul**
  (identity fields, editable, with "restore default"), **Data** (export her mind as JSON via the
  `downloads` capability or copy to clipboard; import from a file; reset). This is "the place
  where she stores her information".
- NPC dialog (`ui.openDialog(npc)` / `closeDialog()`): portrait, name, role, lines, options.
  Shop trade view for Garrick/Elda/Bram.
- Inventory (`ui.openInventory()`): grid with icons, use/eat, give to Lyra (emits
  `item_given` from player to Lyra; she reacts), drop. Lyra's inventory side-by-side with
  "take" / "give".
- Chest (`ui.openChest(chest)`): move items between the player and the chest.
- Settings (`ui.openSettings()`): mind (auto / claude.ai / API key / offline) with status,
  claude.ai speed (quick/deeper), API key field (stored only in this browser, with a clear
  warning) and model, voice on/off + voice, music/sfx volume, text speed, thought bubbles,
  zoom, names (player, companion), cloud save, reduce motion, FPS, controls list, quit to title.
- Pause (`Esc`): resume, settings, save, quit to title. Sets `game.paused`.
- `ui.toast(text, kind = 'info'|'good'|'warn'|'quest'|'lyra')`, `ui.setInteractPrompt(label)`,
  `ui.isModalOpen()`, `ui.fadeOut(s) / fadeIn(s)` (promises), `ui.showDiary(entry)`,
  `ui.update(dt)`, `ui.showTitle()`, `ui.init()`.

**Input** (`game.input`): `update(dt)`, `endFrame()`, `moveVector() → {x, y}` (keyboard,
gamepad left stick, touch joystick), `down(action)`, `pressed(action)`, `press(action)`
(from on-screen buttons), `setTouchVector(x, y)`, `enabled`. Actions: `up down left right
attack dodge interact talk mind inventory menu cmd1..cmd5`. Keys: WASD/arrows, J/Space attack,
K/Shift dodge, E interact, T/Enter talk, Tab/M mind, I inventory, Esc menu, 1–5 commands
(1 follow, 2 stay, 3 attack mode, 4 defend, 5 passive). Gamepad: A attack, B dodge, X
interact, Y talk, Start menu. Touch: left-half floating joystick; right-side buttons
(attack, dodge, interact, talk) sized ≥ 56 px; the command bar collapses into a radial menu
on small screens. Prevent page scroll, pinch zoom and long-press menus on the game surface.

**Audio** (`game.audio`): `unlock()`, `play(name, {x, y, volume, pitch})` (positional falloff
from the camera), `setMusic('title'|'day'|'night'|'combat'|'none')`, `applyVolumes()`,
`update(dt)` (switch music by state/time/combat). All synthesized: short SFX from oscillators
and noise with envelopes; music as gentle generative chord progressions (lute/pluck + pad)
for day, music-box + pad for night, low drums for combat, crossfaded.

**Saving** (`game.save`): `init()`, `hasSave()`, `save(reason)`, `load()`, `update(dt)`,
`exportMind() / importMind(json)`. Data = `game.serialize()`. Local: `localStorage[SAVE_KEY]`
(try/catch everything). Cloud (when `settings.cloudSave` and `runtime.db` + `runtime.user` are
available): document `data/users/<await user.id()>/save` (`{ data: <save json string>, savedAt }`,
< 256 KiB). Load picks the newer of local and cloud. Autosave locally every 60 s while
playing and on `player_sleep`, `quest`, `level_up`; cloud saves on sleep, manual save, and on
`visibilitychange` → hidden (at most once per 2 minutes, only if changed). Never write the API
key into a save.

## 15. Ownership

| agent | files |
|---|---|
| **world** | `src/world/tiles.js`, `map.js`, `objects.js`, `pathfind.js`, `worldgen.js`, `src/art/tiles_art.js`, `src/art/props_art.js`, `tests/world.test.mjs` |
| **characters** | `src/art/characters_art.js`, `src/entities/npc.js`, `src/entities/npc_data.js`, `src/entities/monsters.js`, `src/entities/spawner.js`, `tests/characters.test.mjs` |
| **combat** | `src/entities/player.js`, `combat.js`, `projectiles.js`, `pickups.js`, `items.js` (add only), `src/art/items_art.js`, `tests/combat.test.mjs` |
| **render** | `src/render/renderer.js`, `lighting.js`, `particles.js`, `bubbles.js`, `weather.js`, `src/core/camera.js`, `src/art/fx_art.js` |
| **mind** | `src/ai/mind/*` (mind, soul, emotions, needs, memory, relationships, goals, perception), plugins `relationships_plugin.js`, `memory_plugin.js`, `feelings_plugin.js`, `social_plugin.js`, `quest_plugin.js`, `tests/mind.test.mjs` |
| **behavior** | `src/entities/companion.js`, `src/ai/behavior/*` (behavior, steering, jobs, combat_ai), plugins `core_commands.js`, `world_plugin.js`, `jobs_plugin.js`, `tests/behavior.test.mjs` |
| **brain** | `src/ai/brain/*` except `actions.js` (brain, local_brain, nlu, speech_gen, claude_brain, providers, prompt), `src/platform/claude_runtime.js` (extend only), `tests/brain.test.mjs` |
| **ui** | `src/ui/*`, `src/core/input.js`, `src/core/audio.js`, `src/core/save.js`, `src/styles.css`, `tests/ui.test.mjs` |
| **lead (integration)** | everything else: `src/core/game.js`, `events.js`, `entity.js`, `manager.js`, `interact.js`, `registry.js`, `actions.js`, `resolve.js`, `locations.js`, `atlas.js`, `pixel.js`, `palette.js` (append-only for others), build/test scripts, docs |

Round-2 additions (§16–§18): **mind** also owns `src/lore/*` and
`src/ai/plugins/autonomy_plugin.js`; **behavior** owns the new directives and the actions
`flee`, `keep_distance`, `bind`, `warn`, `wait_outside` (in `core_commands.js`); **combat**
owns friendly fire and crimes; **characters** owns villager reactions to crimes;
**brain** owns the consent-aware message flow, the memory-aware prompt and Claude tools;
**ui** owns the trust/fear/companionship display, the new Mind tabs and memory chips;
**world** adds `lyra_inn_bed`.

---

## 16. Lyra lives for herself

The author's words, which every module serves: *"She is there for herself to live, to choose
every single choice for the better life of Lyra. If she senses that my choices are wrong, if
she senses that I'm trying to do something that would hurt her, if I want to do something and
she doesn't trust me, if she fears for her life, she will do what she needs to: stop me, run
away, or just leave me."*

So: Lyra is not an assistant, a servant, a bodyguard or a quest-giver. She is a person living
her own life in Hearthvale. She travels with the player because she chose to (she owes them
for the wolves, she is curious about them, two are safer than one while she looks for Maren),
and only for as long as that stays good for her. Standing orders still work — once she has
agreed to attack mode she fights without asking per enemy — but agreeing is her decision.

### 16.1 Her own life (mind: `mind.agenda`)

- **Long-term goals** with weights: stay alive; find Maren; earn her keep (coin); keep the
  people she loves safe; grow her magic; belong somewhere; small joys (moonpetals, stars, honey
  cakes, rain on roofs). These, her needs (§9) and her values drive every decision.
- **A daily plan**, made each morning and revised when things change:
  `mind.agenda.today = [{ from, to, activity, at: locationId, why }]` — e.g. gather herbs for
  Mira for coin in the morning, follow a lead about Maren after noon, supper at the Ember
  Kettle, the evening free. With the player around she proposes ("I'm helping Mira this
  morning. Come if you like."), or simply goes. `mind.agenda.purse` — her own coin.
- **Where she sleeps**: `lyra_bed` in the cottage while she trusts the player (trust ≥ 50 and
  fear ≤ 20); otherwise a rented room at the Ember Kettle (`lyra_inn_bed`).

### 16.2 How she sees the player (mind)

- From her relationship with the player: `trust`, `affinity`, `respect`, `fear` (§9).
- `mind.ledger` — what she has seen the player do: `[{ t, day, deed, severity -3..+3, text,
  victimId }]`. Deeds and default severity: `protected_lyra` +2 (killed something attacking
  her), `revived_lyra` +3, `gift_liked` +1, `gift_loved` +2, `gift_disliked` −1,
  `kept_promise` +2, `broke_promise` −2, `respected_refusal` +1 (didn't push after a no),
  `pushed_after_refusal` −1 (repeated a refused request within 60 s), `kindness` +1
  (gifts/help to villagers, sparing a fleeing creature), `reckless_order` −1 (her HP fell under
  30% in a fight the player ordered), `hit_lyra_accident` −0.5, `hit_lyra` −3,
  `downed_lyra` (the player knocked her out) −10, `abandoned_downed` −3 (left her knocked out:
  walked > 20 tiles away or 45 s without reviving), `killed_harmless` −1 (rabbit, deer,
  chicken, cat — 0 if she agreed it was for food), `attacked_villager` −3, `downed_villager` −5,
  `attacked_guard` −2, `stole` −2, `lied` −2 (Claude may record it). Each deed shifts trust,
  affinity, respect and fear (weighted by her personality and how much she already trusts),
  is remembered (importance by severity), and may change her companionship state.
- **Telling an accident from an attack** when the player's sword hits her: an accident if a
  hostile creature is within 48 px of her and it's the first hit in 8 s; otherwise deliberate.

### 16.3 Companionship state (mind: `mind.companionship`, plugin `autonomy`)

`together` → travels with the player by choice · `wary` → still together but guarded: keeps
her distance, refuses risky requests, watches the player · `apart` → living her own life for
now (her choice or agreed), friendly, may rejoin · `left` → she broke off after being hurt or
betrayed: avoids the player, rejoins only after amends (an apology she believes, trust ≥ 35,
fear ≤ 30, and at least one in-game day) · `gone` → permanent: the player knocked her out
(`downed_lyra`), knocked out a villager she cares about (affinity ≥ 30), or repeated grave
violence after she warned them. She walks away along the King's Road and leaves the world;
`game.flags.lyra_gone = { day, reason }`; a farewell memory and a last diary entry stay.

`mind.setCompanionship(state, reason)` emits `companionship_changed {state, previous, reason}`.
`mind.reconsider()` runs after every ledger entry and every in-game hour: together ↔ wary
(trust < 25 or fear > 35), → left (fear > 60, trust < 10, or a grave deed), → apart by her
plans, left → apart after amends, → gone on the gone criteria. She says why, in her voice.

### 16.4 Every order is a request (mind: `mind.evaluateRequest`; core: the consent gate)

`game.actions.run(name, args, 'player')` passes the **consent gate** first
(`game.actions.setConsentGate(fn)`, installed by the autonomy plugin). The gate calls
`mind.evaluateRequest({ action, args, source })` →
`{ decision: 'accept'|'accept_conditional'|'counter'|'refuse'|'refuse_and_act', reasons: [string],
message, condition?, counter?: {name, args}, score }`. Only `accept` / `accept_conditional`
run the action; otherwise `run()` returns `{ ok: false, refused: true, verdict, message }`.
Sources: `'player'` (HUD, hotkeys, commands parsed from the player's message) is gated;
`'claude'` (her own choice, reached with Claude), `'self'` (her autonomy) and `'local'`
(internal effects) are not. Actions that ask nothing of her are registered `ungated: true`
(remember, forget, note_about, express, set_goal, complete_goal, read_journal...).

Weights (each adds a signed amount and a reason):
- **Trust, affinity and fear of the player** — the base willingness. Wary: stricter. Left /
  gone: refuses everything but talk. Apart: accepts invitations when she is free and trusts.
- **Risk to her** — for fighting, guarding, patrolling, exploring and going places: location
  danger, the threat of nearby enemies against her HP and level, night, weather, how her last
  fights went. High risk is refused unless trust is very high or it serves her own goals.
- **Values** — never harms the innocent, friends, villagers or pets; won't steal; hunting
  harmless animals only when food is needed and she agrees; won't abandon someone she loves.
- **Needs** — exhausted (energy < 0.2): no work, no exploring; starving: "after I eat";
  badly hurt: no fights.
- **Her goals and what's in it for her** — helps find Maren: +; offered coin or a fair share
  (the player can offer: "I'll pay you 10 coins" → `args.amount` on the request, or the brain
  detects the offer): +; pointless or boring: −.
- **Pushing** — the same request again within 60 s of a refusal: irritation, and the
  `pushed_after_refusal` deed.
Outcomes come back with a line in her voice: "Fine. Half the wood is mine." / "Not tonight —
I can barely stand." / "Walk into a camp of crossbows first? No. Find someone else."

### 16.5 Self-preservation (behavior enforces; overrides every order)

- In a fight at HP < 30% she disengages and retreats to safety even in attack mode, unless
  someone she loves (affinity ≥ 70) is downed beside her and she judges she can cover them.
- She will not enter a place whose risk is above her threshold: she waits outside
  (`wait_outside`) and says so.
- Critical needs (exhaustion, starvation) make her stop and tend to herself.
- `self_defense`: whoever attacks her is a valid target, **including the player**.

### 16.6 When the player is the danger (mind decides, behavior acts)

- First deliberate hit while trust is still fair: shock and a warning ("What are you doing?!"),
  she steps out of reach (`keep_distance`), state → wary.
- Hit again, or trust already low: she **binds** the player (Binding Light: roots the target for
  3 s, 20 s cooldown) and flees or fights back by personality and fear; state → left.
- The player knocks her out: when she comes to, she leaves for good (`gone`).
- The player attacks a villager or guard: she shouts a warning, then binds the player, steps
  between, and reports to the guards; trust crashes; knocking out someone she cares about →
  `gone`, anyone else → `left`.
- The player leaves her knocked out: `abandoned_downed`; if she wakes alone she remembers it.
- She runs to safety (`flee`): the guards, the inn, the chapel — away from whoever threatens
  her, breaking line of sight, until safe.

### 16.7 Combat and villagers (combat, characters)

- **Friendly fire**: the player's sword hits every actor in its arc (Lyra and villagers
  included) — the player can do wrong. Lyra's movement avoids standing in the player's swing.
- **Villagers are never killed**: at 0 HP they are knocked out (downed) for 30 s, then get up.
- **Crimes**: damaging a villager or guard sets `player.crime = { level, until }` (assault 90 s;
  knocking someone out: the rest of the day) and emits `crime {actor, victim, kind:
  'assault'|'knockout'}`. While a crime is active, guards are hostile to the player
  (`combat.isHostile(guard, player)` → true), villagers flee and shout, and `opinionOfPlayer`
  drops; NPCs greet the player coldly for a day.

### 16.8 Her initiative

She does not wait to be told. From her plan and feelings she announces decisions and makes
requests of the player ("I'm going to the inn. I'm done for today." / "Buy me a honey cake and
I'll forgive the mud."). A request the player agrees to becomes a **promise** tracked in
`mind.promises` (kept/broken feeds the ledger). Offline lines come from templates; Claude is
used only when the player is talking to her (the claude.ai `sample` rules allow calls only on
the player's actions).

### 16.9 New actions

| action | target | value | amount | effect | owner |
|---|---|---|---|---|---|
| `leave_player` | | 'apart'/'left'/'gone' | | she stops traveling with the player (her decision) | mind (autonomy) |
| `rejoin` | | | | travel with the player again (only when she wants to) | mind (autonomy) |
| `set_plan` | | activity or plan text | | change her plan for today | mind (autonomy) |
| `request` | | what she asks of the player | | she asks; tracked as a promise if accepted | mind (autonomy) |
| `promise` | | text | | record a promise (hers or the player's) | mind (autonomy) |
| `flee` | from (default the threat) | to (location) | | run to safety | behavior |
| `keep_distance` | from (default player) | | tiles | keep away | behavior |
| `bind` | who | | | Binding Light: roots the target 3 s | behavior |
| `warn` | who | text | | a sharp warning (bubble, memory) | behavior |
| `wait_outside` | place | | | wait near the entrance instead of going in | behavior |

New directive types (behavior): `independent {plan}` (her own day from `mind.agenda.today`:
walk, work jobs for coin, eat, rest, visit friends, study, follow leads, sleep in her bed),
`flee {from, to}`, `leave {mode}` (for `gone`: walk off the map along the King's Road and
despawn), `keep_away {from, tiles}`, `wait_outside {location}`. New stance: `self_defense`.

New events: `companionship_changed`, `request_evaluated {action, args, verdict}`,
`deed {deed, severity, text, victim}`, `crime`, `promise {text, by, state}`, `plan_changed`.

### 16.10 What Claude is told

The stable rules frame her as herself (above), not a helper. The dynamic context adds her
companionship state, trust/fear/affinity toward the player, the last deeds from the ledger, her
plan for today, open promises, and — for any request in the player's message — the gate's
verdict as "your gut says: …, because …". Claude decides; its actions run with source
`'claude'`. The UI never presents her as a tool: the command bar asks, she answers.

## 17. Memory and lore

### 17.1 The story (`src/lore/story.js`, `src/lore/lorebook.js`)

The author is writing the world's story and Lyra's life. Until it arrives `STORY.placeholder`
is true and holds a short placeholder; the structure below must not change, so the real story
drops in without code changes:

```js
export const STORY = {
  placeholder: true, title, premise,
  world:    [{ id, title, text, tags, aliases, knownBy: ['lyra'|'everyone'|npcId], secret }],
  timeline: [{ id, when, title, text, tags }],
  places:   [{ id, locationId, title, text, tags, knownBy }],
  people:   [{ id, npcId, name, title, text, tags, knownBy }],
  lyraLife: [{ id, age, title, text, people, places, feeling, importance }],  // birth → today
  mysteries:[{ id, question, clues: [{ text, foundAt }], truth }],          // truth hidden from her
}
```
`Lorebook(STORY)`: `get(id)`, `all()`, `search(query, {limit, knownBy})`, `knownBy(actorId)`.

### 17.2 Her memory (`src/ai/mind/*`)

Four stores, one index — Claude never receives everything, only what fits the moment:
- **Life** (autobiographical): seeded from `STORY.lyraLife` (or her soul while the story is a
  placeholder); never pruned.
- **Episodes**: what happened since the game began (§9 memory).
- **Knowledge**: `{ id, subject, text, kind: 'fact'|'lore'|'theory'|'rumor', source: 'lore'|'told'|
  'observed'|'player'|'inferred', confidence, about, loreId, t }` — from lore she knows, what
  villagers tell her, what she sees, what the player says, and her own theories.
- **People**: dossiers assembled on demand from relationships + knowledge + episodes.

`mind.index`: inverted index with entity linking (names, aliases, places, items) over all four;
scored by BM25 + importance + recency + emotional weight + activation (recently recalled) +
association spread (items sharing people/places with the top hits get a smaller boost).

`mind.workingMemory`: ≤ 12 active items with decaying activation, refreshed by perception
triggers (entering a place, seeing a person, an item, a topic in conversation). Strong
associations surface as **reminiscences** — a thought or a bark ("This lake… Maren swore the
fish here could hear you.") — rate-limited.

API: `mind.recallContext(text, { budget = 3500 })` → `{ text, items: [{ id, store, label }] }`
(grouped: on her mind now, memories, what she knows, the people involved, her past — deduped,
truncated, under budget); `mind.recall(query, opts)`; `mind.dossier(personRef)`;
`mind.loreLookup(topic)`; `mind.learn(subject, text, opts)`.

Learning lore: entries `knownBy` an NPC can be learned by talking to them (`talk_to`, social
plugin); place entries when she arrives; item entries when she reads (the journal).
Theories she forms (Claude's `knowledge` with kind 'theory') are kept as her beliefs, never as
facts.

### 17.3 Brain and UI

- The prompt uses `mind.recallContext(message)` and working memory instead of raw dumps.
- Response JSON gains `"used_memories": [ids]` and `"knowledge": [{ "subject", "text", "kind" }]`.
  The chat shows small "remembered …" chips under her reply for the memories she used.
- Claude tools when the view supports them (`sample.limits().tools`): `recall(query)`,
  `about_person(name)`, `lore(topic)` — read-only, small results. Without tools, only the
  pre-selected context is sent.
- Mind panel: new tabs **Knowledge** (by subject; facts, lore, theories, rumors, with sources)
  and **Her life** (timeline from birth), and a **You and her** section (trust, fear,
  affinity, respect, companionship state, what she has seen you do, promises).

## 18. The 2D look

Stay 2D pixel art. Take the mood, not the medium, of low-res "lost console game" reels:
- Night is dark (cool blue, most of the frame deep) and **one or two warm practical lights**
  per scene carry it — windows, lamps, campfires, the forge, Lyra's staff — each with a soft
  bloom halo. Day is bright and warm-neutral.
- Smooth, shaded surfaces with relief (soft gradients, highlights and shadows on stone, wood,
  grass and water) instead of flat, blocky single-color tiles.
- Fog for depth, wet/glossy ground in rain that reflects lights, mirror-like water.
- After the upscale: a faint ordered dither (±2 levels) and a soft vignette. Text is always
  drawn at full resolution, never pixelated with the scene.
