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

**Every change walks [docs/IMPACT.md](docs/IMPACT.md)**: the axes a change can ripple across
(builds, terrain, places, characters, states, devices, weather, Claude on or off, saves,
story branches) and the systems that must react to each. Say which axes a change touches.

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
| `tree` | variants oak/pine. Work 3 s → 2–3 `wood`, becomes a stump, regrows after ~1 in-game day. The player's strike and heavy weaves fell it (`fell(dir, onLand)`, §31.3). |
| `rock` | → `stone`. `ore` (iron) → `iron_ore`. `crystal` → `crystal` (ruins only). Regrow slowly. |
| `herb` | → `herb`. `moonpetal` → `moonpetal`, only pickable at night (glows). `berry_bush` → `berries`. Regrow. |
| `crop` | Tobias's field. stages 0–3; stage 3 harvest → `turnip` or `wheat`; replants to 0; grows over time. |
| `chest` | `inventory` (an `Inventory`); interact opens the storage UI (`game.ui.openChest(chest)`). `home_chest`, `bandit_chest`. |
| `bed` | interact → `game.sleep(bed)`. `home_bed` (player), `lyra_bed`. |
| `campfire` / `hearth` | light source; cooking spot. `inn_hearth`, `camp_campfire`, `lake_campfire`. |
| `lamp` | light at night (auto-lit from dusk). Street lamps around the village. |
| `sign` | interact shows its text (`game.ui.toast` or a small dialog). `notice_board` gives hints. |
| `well`, `anvil`, `forge`, `table`, `chair`, `barrel`, `crate`, `fence`, `altar`, `shelf`, `tent`, `ruin_pillar`, `statue` | decor; some solid; forge/altar give light. Fences, barrels, crates, carts, signs, woodpiles, pots, sacks, hay and bushes break under the player's blows (`state.broken`, §31.3); `dummy` is the training dummy (§31.4). |
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
flying, light, rootTime` (seconds rooted in place by Binding Light: no movement, can still act); methods `isAlive(), setState(state, lockSeconds), faceToward(x, y), faceDir(d),
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
heal spell. At 0 HP she is `downed`; the player revives her by interacting; after 60 s she
gets up alone at 15% HP. Round 14b: she can be killed by the finishing blow like any adult
(blood, V-7); dead, nothing of hers runs any more (§34.6). She is Lyra the person
(`game.companion`, `game.lyra`), not "whoever walks with you" (`game.party.holder`, §34.1).

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
quirks [], speechStyle, secrets [{text, revealAtBond}]`, plus `limits [], family []` and `giftTastes`.
Lyra (docs/LORE.md §7 is canon): **Lyra Ambrel**, 24, a lumencrafter born in Hearthvale to old
parents (Hobb, 79, the lamplighter; Wenna, 76, the beekeeper), Maren Ashgrove's apprentice since
eleven. Maren vanished into the Sunken Ruins three months ago. Two days later Lyra and Hess found
the player in the Crown Ring on the Hollowcrown and carried them down. The player slept 81 days
and woke six days ago, and Lyra took the hearthwatch on them. Two days ago, wolves on the King's
Road, and the player stood beside her. Warm, nosy, teasing, plain; she lives for herself and
gives what she can spare. Hearthvale is her home: she never leaves it (§19.7). Secret: Bryn's
leg in the Weeping Cut. Her people (all eighteen villagers, Maren and Bryn) are seeded from
`soul.js` `LYRA_PEOPLE`; her life memories come from `STORY.lyraLife`.

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
- **Interface size** (r13; the author: "on pc i feel that the hud is a little small"):
  with a mouse the HUD (cards, mission line, prompt, the weave bar), the chat and every
  panel are drawn at a zoom (`src/ui/ui_scale.js` `uiZoom`, CSS `zoom: var(--uiz)` on the
  HUD, chat and panel layers): Settings → Display → Interface size Small / Normal / Large
  = 1 / 1.2 / 1.45, times the window next to 1280×720 (0.8–1.35, so the HUD keeps its
  share of a big monitor), never wider than about a third of the window for the left
  column. Normal (the default) is larger than before; Small is the old size at 1280×720.
  Touch keeps 1 (Controls → Button size is the phone's; the row is greyed with touch and
  says so). Toasts and the coach stay at 1: they are placed by measured boxes, and the
  HUD's own measured layout divides by the zoom.
- Pause (`Esc`): resume, settings, save, quit to title. Sets `game.paused`.
- Notices (`src/ui/toast.js`) keep clear of the HUD, the speakers' bubbles, the player and
  Lyra, re-placed ten times a second; one at a time on a phone; a tap puts one away. With a
  mouse a notice is not a target at all (`.is-touch .toast` alone takes the pointer): a click
  over it reaches the world, so the sword and the right-button cast land where you click. A press
  on the stack holds it where it is until the press and its click are over (`Toasts.held`),
  so a notice never slides out from under the finger that is putting it away.
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

Round-2 additions (§16–§18): **autonomy** (a new agent) owns `src/ai/mind/autonomy.js` (and
any `src/ai/mind/autonomy_*.js`), `src/ai/plugins/autonomy_plugin.js`, `tests/autonomy.test.mjs`;
**mind** also owns `src/lore/*` and wires `mind.autonomy = new Autonomy(mind, game)` plus its
delegates into the Mind facade; **behavior** owns the new directives and the actions
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
- **She fights back** (r8; the author: "she can fight me until I die — something cooler").
  Coming at her again, meaning it, she weighs it once by her state (`autonomy.fightWorth`:
  how hurt she is, fear, anger, how badly she is outmatched, whether help is near, her
  nature) and either binds and runs to her people (above), or **stands and fights** with
  everything she has (behavior's fight-back): the Stillring first, quicker and harder bolts,
  staff strikes when they close in, cover and her own healing (and a potion) when hurt,
  and she shouts for the watch until someone comes. Going at her like that is assault: the
  player is wanted, so the watch and Hess fight them on her call. Badly hurt mid-fight she
  weighs it again (a last stand, or she breaks off and runs). It ends when they fall: she
  never finishes them (a hit-stop on the blow that drops them; "It's over. Lie still."),
  holds back from the rescue and sends for Mira and the watch (who carry them off), and
  comes herself only if nobody does and their time runs short (LORE §7: she never leaves a
  living person to die). Afterwards she is `gone` from them; the deed (`lethal_attack`),
  her memory, her diary and the village's rumors keep it. Accidents never start it.
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
  (`combat.isHostile(guard, player)` → true). Who *acts* on it is who knows it (§29.4): those
  who saw it flee and shout, their `opinionOfPlayer` drops and they greet the player coldly
  for the day; a watchman strikes only once he knows (saw it, came and saw, or was told);
  everyone else hears of it by meeting someone who knows (§29.2), not on the wind.

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

### 16.11 Her proposals, followed through (`src/ai/mind/autonomy_outing.js`; the author: "she goes there, and the second she reaches it, she comes back following me")

"Come with me to the chapel? Sister Aveline knew Maren." is a plan of hers, not an order to
the player's feet. Her request carries `{ at, npc, topic, lead: true, why }`; the player's
yes ("lets go", "ok", "sure, lead the way": the brain's `_goingAlong`, which takes the whole
message as one answer, never as `follow`) is the player's promise, and the promise starts
an **outing** (`autonomy.outings`):

- `go` — she leads the way there (`goto … then stay`). A guide waits for the one she is
  guiding: 13 tiles behind and she stops and says so; within 7 she walks on; after 70 s she
  goes on alone (it was always her errand) and remembers that they didn't come.
- `find` — the person it is about, if they are up and about (`available`); otherwise she
  waits for them (up to 1.5 h) and says so, then gives up for today.
- `talk` — the talk it was about: the social plugin's `talk_to` (Claude writes it when it
  is to hand and the outing was agreed in a Claude chat), the `conversation` event the Maren
  arc listens for (a chat about the weather is not it). Retried up to 3 times.
- `after` — what she heard settles (the arc's own lines are said first), then she carries
  on with **her own life**: her open agenda (§16.12) chooses what next — a while alone with
  it, her mother, the player's company — said in her voice ("I'm glad you were there. Now I
  need a while. Mam should hear it from me.").

Nothing in it snaps her back to following. A `goto`/`follow` from a reply is overridden by
her plan while it runs (Claude is told so: "the game carries it out; do not use goto or
follow for it"). She comes back to the player only if she chooses to (her agenda picks
their company) or if they ask and she agrees (the consent gate weighs it, and an outing in
hand weighs against): then the outing is dropped and becomes **unfinished business**. The
player's promise is kept when they were there. Left/gone ends it. Saved (a talk cut by the
save starts again from finding the person). Her yes is said once: the reply adds no
generic line after the outing's own.

### 16.12 Her open agenda (`src/ai/mind/autonomy_open.js`; the author: "not only those 5 criteria")

Her day is still planned each morning from a handful of factors (§16.1); her choices in
the moment draw on everything she has going on, weighed (`openAgenda(view)`, sorted, ids
`a1…`):

| kind | what | weighs |
|---|---|---|
| `want` | what she wants today: food, rest, coin, a small joy (stars, the fire in the rain, a honey cake), a while alone with hard news | her needs, mood, nerves, the weather, the hour |
| `unfinished` | unfinished business: a talk she never had, a call she was sent | older is heavier (a week, then it lapses); Maren weighs more |
| `person` | people she cares about (affinity ≥ 35): not seen today, grieving, Mam and Da | family more; the grieving most; after hard news, family |
| `said` | what she said she'd do: her open promises | steady |
| `company` | the player's company | only while she wants it (trust, fear, worth §19.4) |
| `plan` | her plan as it stands | steady, low |

A day's small randomness keeps two days apart. `chooseNext` picks for her offline; with
Claude in a chat, the list goes into her prompt with its ids, and Claude may choose one by
`set_plan "a2"` (the game turns it into an ordinary plan block, or an outing for
unfinished business with a person). Saved: `autonomy.unfinished`.

### 16.13 Hate means distance, not jitter (`src/ai/behavior/own_life.js`; the author: "she tries to get away from me, but she wants to come back… literally moving in place")

Measured first: a Lyra who had left the player, with the player standing where her day took
her, turned back on herself 161 times in 90 s (avoiding stepped her out, her day walked her
back in). Now one owner decides her feet (own_life), weighing both at once, with
hysteresis:

- **left / gone**: she steps clear until 3 tiles past the distance she keeps (her own day
  avoids them by 8 tiles left, 10 gone), to a spot she keeps until they close on it; never walks toward them inside 7 tiles; does
  her day from a spot clear of them or waits it out where she stands. If they walk at her,
  she keeps stepping away; she never turns back toward them. While she holds off, the spot
  she holds off at must stay clear of them and the way there must not lead toward them;
  once her stepping clear has put them between her and it, she waits where she stands. Her
  actual steps count, not only where she means to go: a way that bends back toward them
  (round a house, along the shore) inside 7 tiles stops her, and she waits it out there.
- **flee** commits to its break-away and finds another safety (or just away) when the way
  runs past the player.
- **wary** and afraid (fear ≥ 25 or affinity ≤ −30): she trails at a steady distance
  (`keep_away` that follows, 4–8 tiles by fear) instead of `follow far`; she returns to
  `follow far` only below fear 15 and above affinity −20.

Reversals in the same scenes: 0–4. Played in Chromium (20 chase-then-stand trials on both
phone sizes): 0–2 turns once the player stands (13 before the last two rules), a few more
while she is chased into a corner such as the lake shore.

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

### 17.4 She edits her own memory

Her memory is hers to tend, like a person's: she rewrites how she remembers things when she
learns more, corrects facts that turned out wrong, lets small things fade, sharpens what
matters, and forgets what she chooses to forget — for her own reasons.

- **Edits keep their history.** Every memory and knowledge entry can carry
  `history: [{ t, text, importance, why }]` (earlier versions) and `edited: true`; nothing is
  silently overwritten, so the UI can show "she used to remember it as…".
- **Actions** (her own when she runs them; when the player asks, they are requests she
  weighs like any other — §16.4):
  | action | target | value | amount | effect |
  |---|---|---|---|---|
  | `edit_memory` | memory id or words that find it | how she remembers it now | new importance 1..10 (optional) | rewrite or reframe a memory, keeping the old version in history |
  | `forget` | | words that find it | | let a memory go (exists; she refuses for things that protect her) |
  | `update_knowledge` | subject or knowledge id | the corrected text | confidence 0..1 | correct or update a fact, rumor or theory |
  | `retract_knowledge` | subject or knowledge id | why | | drop a fact or theory she now believes is wrong |
  Life memories (her past before the game) can be reframed but never forgotten.
- **Who edits:** Claude, through the response JSON field
  `"memory_edits": [{ "id", "op": "update"|"reweight"|"forget"|"retract", "text", "importance", "why" }]`
  (ids from the recall context it was given); the offline mind at sleep (merge duplicates of
  the day into one memory, let trivial ones fade, update facts superseded by newer
  knowledge, reframe the day's events through her new opinions); the autonomy module
  (reconciliation and hurt change how she remembers people — or don't, if it is not worth it
  to her).
- **The player cannot edit her mind directly** in the Mind panel. Asking her ("please forget
  that I hit you", "remember it differently") is a request: she may agree, refuse ("No. I
  remember that for a reason."), or reframe it her own way. The Memories tab shows an
  "edited" mark with her earlier version and her reason.

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

## 19. Round 3: Hearthvale lives

`docs/LORE.md` is canon from now on. Where LORE and older code or this document disagree,
LORE wins. **LORE §12** lists every line in the built game that it replaces, with the new
text; apply it exactly. LORE §9.10 (*Who knows what*) decides what each character may say:
a truth marked *hidden* is never spoken by anyone until the game reveals it.

The author's rule, again, because round 3 touches it everywhere: Lyra lives for herself.
She stops the player, runs or leaves **only when that is better for her, or when staying
is not worth it to her**. She is warm, nosy, teasing good company by default, and she never
threatens or hints that she might leave. Other villagers live their own lives too: they
talk to each other, like and dislike each other, gossip, and remember the player.

### 19.1 The eighteen villagers (characters: `src/entities/npc*.js`, `src/art/characters_*`)

- Ten new villagers join the eight, exactly as LORE §6 describes them: `hobb`, `wenna`,
  `hess`, `sabeth`, `alder`, `petra`, `tilly`, `tansy`, `corran`, `wys`. Their profiles
  go in a new file `src/entities/npc_data_more.js` (`export const MORE_PROFILES = [...]`
  and `export const MORE_KNOWS = { bram: { hobb: '…' }, … }` for what the original eight
  think of the newcomers). `npc_data.js` appends them in one place at the end of the file.
  Do not rewrite the original eight's entries (the canon agent edits a few of their facts).
- Every profile follows the NPC schema (§7) plus: `howAreYou: [...]` (their answer to
  "how are you?", from LORE §6), `saysOutLoud: [...]`, `family: { parent: [], child: [],
  spouse: [], sibling: [], ward: [] }` (ids), and facts may carry
  `hiddenFrom: ['lyra']` or `knownBy: [...]` (LORE §9.10). Facts the LORE marks hidden are
  `topic: 'secret'` with a high `minFamiliarity` and are never offered to Lyra.
- Homes and days follow LORE §10 *Homes*. Location ids (built by the world agent):
  `chandlery`, `lamplight_lane`, `ashby_house`, `dye_cottage`, `weavers_row`, `net_shed`,
  `wenna_hives`. Each villager sleeps in a bed whose `owner` is their id.
- Wys is faction `guard` and fights like Rowan. Hess hunts: she fights hostile creatures
  that come near (never villagers, never the player unless there is a crime).
- Hobb walks the lamp-round at dusk: he lights the village lamps one by one (lamp objects
  with `state.lit`, see 19.2). After he passes, a lamp stays lit until dawn.
- Wenna is nearly blind (milky eyes, walks with a stick, keeps a hand out); Petra is 84;
  both move slowly. Art must make every new villager recognisable at game scale
  (silhouette, hair, colours, a held item) and give each a portrait.

### 19.2 New places (world: `src/world/*`, `src/art/world_*`, `src/art/props_*`)

LORE §10: Lamplight Lane running east from the chapel behind the smithy, with the Ambrels'
chandlery at its end and the bench outside; Ashby House on the south side of the square
facing the well; the dye-vats cottage east of the Wayhouse by the stream above the bridge
(the stream runs violet and teal below it); Weavers' Row, a short lane south of the square
with Nan Pike's loom and two or three small houses; Corran's net-shed at the landward end of
the dock; Wenna's hives among the lindens at Whisperwood's near edge. Beds with owners for
all ten (Wys gets the second cot in the guardhouse, Tansy a bed in the farmhouse). Village
lamps along the square and the lanes as objects of type `lamp` with `state.lit` (lit lamps
give light at night; unlit ones do not). Spawns for the ten new villagers at their homes.
New props get art and `LOOKS` text. The village must still read clearly and path cleanly:
every door reachable, no villager stuck.

### 19.3 Village social life (social: `src/ai/social/*`, `src/ai/plugins/social_plugin.js`,
`src/ai/plugins/village_plugin.js`, and only the `social()`, `chatWith()` and `hears()`
methods of `npc.js`)

`game.village` (a `Village`, created by `village_plugin.install`) owns the social world:

- **Bonds.** A directed graph `village.bond(a, b) → { affinity -100..100, trust 0..100,
  familiarity 0..100, tags: ['parent'|'child'|'spouse'|'sibling'|'friend'|'rival'|'crush'|
  'mentor'|'apprentice'|'ward'|'grudge'…], note }`, seeded from LORE §6 (each profile's
  relationships and the relationship map) for all 18 villagers and Lyra (`lyra` is a node;
  her side also lives in `mind.relationships`, which stays the source of truth for her).
  Bonds drift with every conversation, favor, slight and rumor. Saved and loaded.
- **Conversations.** `village.converse(aId, bId, { topic })` makes a 2–6 line exchange
  from both speakers' voices, their bond, the time and weather, what they know, their
  shared history and the rumors they carry. Topics: small talk, work, family, the player,
  Lyra, Maren, the bandits, the ward, each other's secrets they know, LORE §5 *In the air
  this week*. Every line is in character (use each profile's voice and LORE §11), never a
  generic template that could come from anyone. On screen, the lines play as speech bubbles
  in turn; off screen, a conversation resolves instantly as a summary. Each conversation is
  logged: `village.log → [{ t, day, a, b, topic, summary, lines?, effects }]`.
- **The rhythm.** Villagers who share a place and are awake start conversations on their
  own (eating, socialising, working side by side, passing in the lane), a few per in-game
  hour across the village, more in the evening at the Kettle. Lyra takes part as herself:
  she visits people she loves (her parents most of all, LORE §7 *Lyra's people*), and her
  side of each conversation comes from her mind (mood, relationships, memories) and is
  remembered by her mind like any other conversation (`applyConversation`).
- **Gossip.** Notable events become rumors `{ id, about, text, valence -1..1, source,
  t, heardBy: [ids] }`: the player's deeds (autonomy `deed` and `crime` events, gifts,
  help, quests, fights), Lyra's choices (leaving the player, moving back to the Kettle),
  and village news. Rumors spread one listener at a time in conversations, are retold with
  small distortions, shift each hearer's `opinionOfPlayer` a little, come up when the
  player talks to someone ("Heard you pulled the wolf off Tansy."), and reach Lyra as
  hearsay knowledge (weighed less than what she saw herself).
- **Talking to anyone.** `village.playerSays(npc, text) → Promise<{ lines: [string],
  mood?, options? }>`: the player can say anything to any villager. Greetings and "how
  are you?" get that villager's own answer (`howAreYou`); questions about people, places
  and topics get what they know at their familiarity with the player; thanks, compliments,
  insults and threats change their opinion; Lyra overhears if she is near. With a Claude
  provider available (`game.brain.providers.current()`), the reply comes from Claude: the
  villager's profile, voice, opinion of the player, the facts they would share, the rumors
  they carry and the last few exchanges, returning JSON `{ say, opinion_delta, learned?:
  [fact ids], rumor? }`. Local fallback on any failure. Claude is called **only on a player
  action** (pressing send), never from a timer.
- **Listen in.** `village.canListen()` returns the conversation playing near the player,
  if any; `village.listenIn(conv) → Promise<lines>`: a player action, so with Claude
  available Claude writes the next exchange between those two (4–8 lines, in their voices,
  from their bond, their news and rumors); otherwise the local generator does.
- **While you slept.** On `player_sleep`/`player_wake`: `village.nightSummary(day) →
  Promise<[string]>` gives 3–6 short lines of the day's village life (who talked, what
  spread, who fell out, what Lyra did). Local first; with Claude available (sleeping is a
  player action) Claude may rewrite it as a few warm sentences. Never blocks the sleep.
- **Always-on mode.** Setting `villageAi: 'player' | 'always'` (default `'player'`).
  `'always'` works only with the API-key provider and lets Claude write on-screen ambient
  conversations near the player, at most one every 45 s. Never with claude.ai sampling.
- Events: `village_talk {a, b, topic, summary}`, `rumor {rumor}`,
  `bond_changed {a, b, bond}`.

### 19.4 Worth it (autonomy: `src/ai/mind/autonomy*`)

`autonomy.worth() → { stay, cost, net, reasons: [{ text, weight }] }`, recomputed each
update and shown in the Mind panel. **Stay** is what being with the player gives her: trust
and affection, the Maren thread (the stranger came from Maren's "other end" and is her best
clue), shared good days, promises kept, the hearthwatch wage, safety together in danger, the
player being good to people she loves. **Cost** is what it takes from her: harm done to her,
fear, lies, broken promises, being pushed after a no, harm to villagers, crimes, dangerous
asks, and time taken from her own life (her parents, the waystones). Small wrongs she can
afford are weighed and let go, and fade. State changes come from the weighing with
hysteresis: `wary` / `apart` / `left` only when the net value stays low; an intervention
(warn, step between, bind, flee) only when protecting herself or someone she loves is worth
more than the risk. LORE §7 *Boundaries* sets the hard lines (a second deliberate blow; a
knock-out of her or someone she loves means `gone`). She never threatens to leave.

### 19.5 Memory editing (mind: `src/ai/mind/*`, `memory_plugin.js`; the `memory_edits`
field in `src/ai/brain/prompt.js` and its application in `brain.js`)

Implement §17.4 end to end: `edit_memory`, `update_knowledge`, `retract_knowledge`, and
`forget` with history; `memory_edits` from Claude; sleep consolidation that merges, fades,
supersedes and reframes; the player's requests weighed like any other request.

### 19.6 UI (ui: `src/ui/*`, `src/styles.css`; render: `src/render/*`)

The villager dialog gains a "Say something…" field (with the mic when dictation exists)
calling `village.playerSays`; a "Listen in" prompt appears when a conversation plays near
the player; the morning card shows *While you slept*; the Mind panel's People tab covers all
eighteen and shows who she is close to and how the village feels about the player; "You &
her" shows the `worth()` breakdown; memories and knowledge show the *edited* mark and the
earlier version. All of this works on a phone. Nights get darker per §18.

### 19.7 Her village protects her (the author, after playtesting)

"I tried to kill her, but then she just left and disappeared from the village. No, it's her
village. She should be able to ask help for other people. They can come and help her."

- Hearthvale is Lyra's home. **She never leaves the map or vanishes** — not when hurt, not
  in `left`, not in `gone`. `gone` now means she has cut the player out of her life: she
  lives with her parents at the chandlery (or her room at the Kettle), keeps her distance,
  and the village stands with her. She can still be spoken to (r13, the author: "even if
  somebody really hates me, make me able to talk to them"): she hears it, and answers as she
  feels: a word at most offline, or silence when pressed (shown as an act, §23.3), her own
  choice with Claude. Out of earshot she hears nothing. (LORE §7's table changes to
  match: the road to Saltmere is something she *thinks about*, never a despawn.)
- **Calling for help.** When she is attacked, badly hurt, or afraid for her life, she shouts
  for help (a real line, by name when someone is near: "Rowan! Hess!") and runs toward
  people. The mind/behavior emit `call_for_help { victim, attacker, x, y, severity }`.
- **The village answers** (characters, in `npc.js`, on `call_for_help` and on any attack on
  a villager) — those who *hear* it (§29.4: walls muffle a cry): guards (Rowan, Wys) and Hess
  come running and fight the attacker they see (one they only heard of, they come to look
  for); Mira, her parents, Elda or Aveline come to tend her (heal, help her up, walk her
  home); others shout, shield children, fetch the watch, or flee. A villager who was downed
  can call for help too.
- **Consequences** (social + autonomy): the attack becomes a rumor that spreads fast, face to
  face (§29.2); opinions of the player fall as it reaches people (most among those who love her); shops
  may refuse the player; the watch may confront or bar the player from the Kettle for a
  time; amends are possible but slow. Her parents' and friends' opinions of the player
  matter to her own weighing.

### 19.8 Beds, and ground that feels real (the author, after playtesting)

- **Everyone sleeps in a bed in their own home.** Nobody sleeps on a floor: not in the
  chapel, the forge, the shop or the inn's common room. Every villager (all eighteen) and
  Lyra have a bed whose `owner` is their id, in their home (a back room, a loft, a cell, an
  upstairs room). If a bed is ever missing, they walk home and sit by the hearth instead of
  lying on the floor.
- **Sleeping looks right.** Anyone in a bed lies in it the way the bed is oriented (head on
  the pillow, blanket over the body), never sideways across it.
- **Finding your bed** (r13; the author: "I'm not able to find my bed"; `src/world/home.js`,
  `src/ui/home_pointer.js`, `src/ai/plugins/home_plugin.js`): the player's bed in the
  Wayhouse is named "Your bed" and wears a "Your bed" tag whenever the player is inside
  the cottage. **Menu → Home** marks the way: the tag over the bed when it is on screen,
  an arrow with "Home" at the screen's edge when it is not, until the player reaches it,
  sleeps, or turns it off there ("Home: marked"). Asking anyone where the bed is ("where
  is my bed", "where do I sleep", "I can't find my house"…, `asksForHome`) gets the way in
  words — the Wayhouse, which way and how far from the one asked, which bed — from Lyra
  (a plugin question; Claude gets the facts in its prompt and a `show_home` action) and
  from every villager (`player_talk.js` local reply; the Claude brief carries the same
  fact), and the game marks the way whoever words the answer, once they do answer: not after
  a silence they chose (§23.3), and not by a Lyra who has broken off with the player or cut
  them off (her word is the whole answer; Claude's `show_home` stays hers to use). Lyra says
  "our cottage" only while she sleeps in the Wayhouse too (`mind.agenda.sleepAt`), not while
  she lodges at the Kettle or the chandlery (LORE: Hearthwatch, and where she sleeps).
- **Sleep and sit** (r13; the author: "I can't sit anywhere, and I can't sleep";
  `src/world/rest.js`). Your bed says "Sleep until morning" at **any hour** (no more
  "from 6 PM"): you wake at 7 the next morning (the same morning before 7), healed, and the
  game saves, as before. Not while a fight is near (`sleepBlocked`: a hostile within 10
  tiles, a blow taken in the last 8 s, lying fallen, carrying someone, burning through the
  Last Stand's minute: §25): a toast says why. *Round 13 x 14a:* any bed that is nobody's
  (an empty house in Brindlecombe) sleeps you the same way and says the same words; "Your
  bed", Menu → Home and the map's home mark still mean the Wayhouse bed (`home.js`
  `homeBed`). The calendar turns before the sleep's save, so a birthday the night carried
  you into is had once and saved as had (§32.10).
  **Every chair, stool, bench and pew is a seat** (`Seat` in objects.js): the use button
  says "Sit"; you sit in the villagers' own sitting pose (a chair at a table faces it,
  the rest face out), sharing their seats (`obj._sitters`: a full bench says so). Moving
  stands you up and walks on; a swing, a roll or the use button ("Stand up") stands you up
  and is spent doing it; a blow knocks you out of the seat. A bench with words says them
  as you sit. Saved seated, you load standing where you sat down from.
- **Ground reads true.** Anything drawn as raised (a terrace, a rock band, a cliff face, a
  retaining wall, a steep bank) is solid along its face and climbable only by stairs, steps
  or a ramp drawn as such; anything walkable must look walkable. No walking up walls.

## 20. Story and cutscenes (`src/story/*`)

The author: "you put lore but without a cutscene. I have no idea what is the role lore. Make
me some lore." The lore must reach the player in the game, not only in a file.

- **Cutscene engine** (`src/story/cutscene.js`): letterboxed scenes that play scripts made of
  steps — illustrated full-screen panels (procedurally painted pixel art with parallax,
  light and particles: falling snow, brightfall, embers, fog), in-world camera moves over the
  real map, actors walking/turning/emoting, narration, dialogue with portraits and names,
  sound, music swells, and voiced lines (§21). Tap/click/Space advances; hold or a Skip
  button skips; it pauses the game; text is drawn at full resolution; it fits a phone in
  portrait and landscape.
- **A line never waits for its voice** (r8; the author: "the cutscene at the start does not
  work"). A tap first finishes the typing; the next moves on at once and stops the voice; a
  tap in a quiet pause (a title card, a held panel) cuts it short. Each line keeps its own
  clock: it moves on by itself at its reading time, and only a clip that really starts
  playing (`voice.play`'s `onStart`) may hold it until the clip ends (whichever is later).
  A clip that is slow, failed, or blocked (audio not yet allowed on an iPhone; a suspended
  context is never "played" silently) is dropped at the reading time (`maxLatency`,
  `wanted`), and after three failures in a row the scene carries on silently.
  `scripts/cutscene_check.mjs` taps the New Game prologue through on a phone (390×640 and
  844×340) with voices working, blocked and slow: about 14 s of fast taps.
- **Never a bare caption over black** (r13; the author: "in the end of the first cutscene, I
  have seen that [Lyra] talks, but there is no pictures"). Cause: a replay (Prologue on the
  title screen or in the menu) plays the `world` block as its stand-in panel and kept only
  the lines and sounds, so the block's own fade-in was skipped and the fade-out before it
  left Lyra's last lines on black. Now a replay keeps the block's fades too (the
  "Wayhouse, morning" panel is seen), and the player never speaks a line while a
  fade-out still covers the screen (`fadedOut`: the picture comes back under the line,
  not waited on, so the voice timing is unchanged). New Game plays the same lines on the
  live map, inside the Wayhouse, with her portrait beside each.
- **The prologue** (plays on New Game, skippable, replayable from the title screen and the
  menu): Halcyre and the broken Song, the Drift, the warded villages, Hearthvale and its
  Wellstone, Lyra's birth under the Brightfall to old Hobb and Wenna, Maren going into the
  Sunken Ruins, Lyra and Hess climbing the Hollowcrown, the melted circle in the snow and
  the stranger in it, the carry down, eighty-one days of sleep — and the player waking in the
  Wayhouse with Lyra there. It ends in play.
- **Story scenes in play**, triggered by places, people and trust: meeting Hobb and Wenna
  (Wenna wants to touch your face), Lyra telling the night of the lamps, the Weeping Cut
  (only at high trust, at the quarry), Maren's thread (Aveline's account, the ruins gate,
  the journal), and the chapel candles leaning toward the stranger. Each plays once,
  respects Lyra's state (she won't tell secrets to someone she doesn't trust), and is
  remembered by her mind.
- **The Book of Halcyre** (menu): the lore as an illustrated in-game book — the world, magic,
  dungeons, Hearthvale, its people, and the story so far — chapters unlocked as the player
  learns them (from story.js and what the player has heard), so the player always knows what
  the lore is and why it matters.

## 21. Voices (`src/audio/voice*.js`, `src/story/sfx.js`, `scripts/voice/*`)

The author (r9): "here is voices to use instead of the one you have … and only put voices
for cutscenes", with their own reference voices and how they make voices and sound for their
videos; earlier: "you do not have to record voices for AI talking with each other… text is
enough".

- **Only the cutscenes are spoken**: the prologue, the story scenes in play, the mission
  scenes and the boss intros (everything `src/story/*` plays). Villagers' barks, Lyra's
  lines in the world and her chat replies, and people talking to each other are text. There
  is no live voice (no Kokoro in the browser, no claude.ai reading, no browser speech).
  Settings → Sound & voices keeps *Spoken scenes* (on/off) and *Voice volume*.
- **The cast** (`scripts/voice/cast.json`, reasons and measurements in `CASTING.md`): the
  narrator is the author's Void; Lyra is the author's goth-girl voice (without the glass
  ring); the men are the author's Bro voice shaped for age and character (Hobb slower and
  lower with a waver, Varek lower and rough, Corran thin, rough and wavering); the other
  women are the goth-girl voice reshaped (pitch, vocal-tract size, pace) until they measure
  clearly apart from Lyra and from each other.
- **Made the author's way** (`scripts/voice/`): Chatterbox (free TTS) conditioned on the
  reference (reshaped per character), three seeds per line, each take transcribed with
  Whisper, the take with every word right kept (ties: the one most like the reference, with
  no long holes); cut on its real loudness (10 ms frames above -42 dB, gaps under 0.12 s
  ignored) from the first sound to the last with 10 ms fades; the Void's chain (3 semitones
  down, a quiet layer an octave lower, echoes at 90 and 160 ms, a small bass boost, -3.5 dB
  at 350 Hz and +2.5 dB at 2.8 kHz, the words evened out so a line's end never fades); a room
  or a muffle where a scene is indoors or remembered; -16 LUFS, true peak under -1.5 dBTP;
  mono MP3. The finished clip is transcribed again: if an effect hid a word, the effects are
  lightened and it is heard again; its word times go into the manifest. Clips are cached by
  speaker + text + settings, so only changed lines are spoken again.
- **Playback** (`src/audio/voice.js`): `voice.play({ speaker, text })` finds the clip by
  the line's words (a renamed Lyra or a changed line simply has none and types itself).
  **A line never waits for its voice** (§20). **Captions follow the voice**: each word pops
  in the moment it is spoken (the clip's word times on the audio clock); without a clip, the
  line types itself.
- **Scene sound, made in code** (`src/story/sfx.js`; the author: "every action gets its own
  sound"): steps `{ sfx }`, `{ bed }`, `{ heart }`, `{ hush: ms }`, `{ slam }`, and `cues` on a
  spoken line that fire on a word as it is spoken (or typed) — footsteps in snow, the litter
  creaking, the stone ring's hum, the candles leaning, gravelight, the Wellstone, landings,
  flashes, cracks; big moments stack a sub thump, a crash, a long ring and a braam. A quiet
  bed under every scene (wind, a room, the chapel, a drone, whispers, a cave, the village, the
  lake), a heartbeat where fear lives, and before the prologue's biggest moment ("It was
  you.") near silence with a thin ringing tone, then the sound slammed back in. Effects duck
  under every spoken word (a sidechain made from the word times) and the music dips under
  the voice, so the voice always wins.

## 22. Magic: the Weave (`src/magic/*`)

The author: "There is base magical ways of casting, like throwing or blasting or punching or
summoning… and then there's those things that add into the path: dark power, fire, water…
literally everything… You make a combination of all of them… If you add another thing to
the magic system, it just works with everything else flawlessly and very fast… Colors and
effects and powers… I start with a small blast or a projectile, and after that I kill a
boss and I get a fire element. I can put it into my magic… make magic skills… blast with
fire, and after that I get multiple hits… divisions… a whole magic system that makes me
able to combine magic and fight with it."

**In the story.** Nobody in Hearthvale can do what the stranger can: hold raw Drift in the
hands and shape it with Lanternwright glyphs, the lost craft the Song was made of. The
village calls it **weaving**. Lyra notices first (a story scene); she is a lumencrafter and
can name what she sees, but she cannot do it. What the player weaves is seen, talked about
and remembered (rumors, Lyra's mind). LORE gains §13 *The Weave* (written with the
missions, never revealing §9 hidden truths).

### 22.1 A weave = one Shape + Essences + Twists

Every spell the player makes is data: `{ id, name?, shape, essences: [..], twists: [..] }`.
It is compiled once into a **plan** (`compileWeave`) and cast through one generic runtime.
Nothing is written per combination: a new shape, essence, twist, status or reaction is one
registry entry, and it works with every other entry automatically.

- **Shapes** (how it leaves the hands; `SHAPES` in `src/magic/shapes.js`): `bolt`
  (projectile; the starting shape), `blast` (short cone burst), `strike` (a punch with an
  impact wave), `throw` (lobbed, lands and bursts), `beam` (held line), `nova` (ring around
  the caster), `orb` (slow, big, pulses on what it passes), `summon` (a familiar whose form
  and attacks come from the essences), `rune` (a glyph trap on the ground), `rain` (strikes
  falling on the aimed spot), `wall` (a barrier line), `dash` (a blink that leaves the
  weave in a trail). Each defines base numbers (`dmg, cost, cooldown, speed, range, radius,
  count, life`) and `emit(ctx)`, which creates **bodies**.
- **Essences** (what it is made of; `ESSENCES` in `src/magic/essences.js`): `fire`, `water`,
  `frost`, `storm`, `earth`, `wind`, `nature`, `poison`, `light`, `dark`, `iron`, `song`,
  plus `raw` (unaspected violet weave, used when a weave has no essence). Each has a
  palette `{ core, glow, spark, deep }`, a light `{ color, radius }`, a particle style
  (`flame`, `drop`, `shard`, `spark`, `pebble`, `gust`, `leaf`, `bubble`, `mote`, `wisp`,
  `filing`, `note`), a sound, a damage type, a status it applies (`burning`, `soaked`,
  `chilled`→`frozen`, `shocked`, `staggered`, `knocked`, `rooted`, `poisoned`, `dazzled`,
  `drained`, `sundered`, `charmed`…), terrain touches (fire scorches grass, frost glazes
  water, water leaves puddles…), and `tags`. A weave may hold up to 2 essences (3 later);
  bodies carry all of them: palettes blend, damage is split across types, every status
  lands at reduced potency.
- **Twists** (how it behaves; `TWISTS` in `src/magic/twists.js`) are hook objects:
  `multishot` (+2 bodies, fanned), `split` (on hit, divides into 3 smaller), `pierce`,
  `bounce` (ricochets), `chain` (jumps to a nearby foe), `homing`, `echo` (casts again a
  moment later), `big`, `swift`, `burst` (explodes on hit or at the end), `linger` (leaves
  a ground patch of its essences), `orbit` (circles the caster first), `volley` (three in
  quick succession), `spiral` (weaving path), `leech` (heals the caster a little),
  `charge` (every weave charges while held, §22.4; this twist charges twice as fast, to
  ×3 instead of ×2.5, and makes even a beam charge instead of pour). Hooks: `onPlan(plan)`, `onEmit(bodies)`, `onSpawn(body)`,
  `onUpdate(body, dt)`, `onHit(body, target)`, `onEnd(body)`, plus multipliers
  (`dmg, cost, cooldown, speed, size, life`). Children made by twists (split, burst,
  chain) inherit the weave minus that twist, with a generation cap, so nothing recurses
  forever.
- **Statuses and reactions** (`src/magic/status.js`): statuses carry tags; a short
  `REACTIONS` list keyed by tag pairs gives combos (wet + shock = arcing stun, wet + frost =
  freeze, fire + wind = spreading flames, fire + nature = wildfire, fire + wet = scalding
  steam that blinds, earth + water = mud that slows, light + dark = eclipse burst, poison
  + fire = toxic flare, iron + storm = conducted bolt…). An essence with no reaction
  still works. Statuses show on actors (flicker, tint, drips, sparks, frost rime, bubbles).
- **Numbers.** Cost = (shape cost + essence costs) × twist multipliers; cooldown and damage
  scale the same way; every plan stays inside a power budget so a combination is never
  free or useless. Names are generated ("Splitting Ember Bolt", "Echoing Tide Nova").
- **Cooldowns you can feel** (r12; the author: "the skills doesn't have cooldown"). Each
  shape's own cooldown is stretched by its scale (`COOLDOWN_SCALE` in
  `src/magic/balance.js`) before the clamp (0.16–12 s): Spark (bolt) 0.75 s, strike 1.5 s,
  blast 1.6 s, rune 1.75 s, throw 2 s, dash 2.1 s, orb 2.9 s, nova 3.5 s, rain 6.2 s,
  wall 6.6 s; a beam cools 1 s after it is let go; bind (4.5 s), ward (8 s) and summon
  (6 s) were already slow and stay. Twists and essences scale on top (swift shorter,
  volley and echo longer). The longer wait buys a little damage inside the budget (+10%
  per e-fold of the scale: a Spark +9%, a nova +12%), so a cooldown is never a pure nerf.
  A weave's timer follows the weave (its parts, `plan.key`), not its slot: the same weave
  in two slots waits once, moving it neither dodges nor hands on a timer. Only the
  player is paced by it (Lyra, familiars and bosses keep their own timers). Focus, charms
  and cast speed shorten it (`magic.cooldownOf`).
- **Hold to charge** (r12; the author: "if I hold it it gets stronger"). Every weave but a
  beam charges while it is held and is cast on the release. A press shorter than 0.18 s
  is a tap (k = 0, exactly as before); past it (round 14b follow-up, §38.6: from the press)
  you stand still, the stick only turning you, and the charge k
  grows to 1 at 1.5 s after the press (cast speed shortens it; the charge twist halves
  it). At charge k a weave hits ×(1 + 1.5k) (×2.5 full; the twist ×(1 + 2k), ×3), is up
  to ×1.45 bigger and flies up to ×1.25 faster; binds hold, wards shield and surges last
  longer by their own scalings; count and range stay. It costs ×(1 + k) mana (×2 full),
  paid at the release; the charge stops growing at what the mana in hand can pay for (the
  button says so). A weave still cooling cannot start a charge. One charge at a time: a
  second weave pressed meanwhile lets the first one go. Beams pour while held as before.
- **Mana.** A violet bar under health (start 40, regenerates; grows with level and
  missions). **Four weave slots** on the hotbar to start (six later).
- **Rules of harm** (r8; the author: "the spells do not do any damage"). A weave physically
  hits whoever its strike touches except the caster — bolts, beams, blasts, cones and novas
  included; what lingers (patches, rains, runes, walls, trails, familiars), a bind's ring and
  a ward spare friends unless aimed at one. A friend it hits was **aimed at** (a deliberate
  blow, with all of §19.7's weight) when the aim named them, the aim point sat within 20 px
  of them with nobody nearer, or a straight weave's line passed within 12 px of them before
  anyone else (`magic.aimedFriend`, which the aim preview may ask); otherwise it is an
  **accident**: half damage, no status, no crime, no claim of self-defense, and Lyra and the
  village weigh it as one (a fight's worth of stray clips is one small wrong). A quick tap
  auto-aims only at foes, also when it is let go after its press (r12: every weave is cast
  on the release; the hold keeps the aim's `auto`). A weave let go after a hold names a
  friend only if the aim had named her for 0.3 s before the release, or since the press
  (`FRIEND_STEADY`): while a charge gathers she may walk into its line or under the cursor,
  and that is not aiming at her (if it hits her, it is an accident). Hits read: big outlined damage numbers (essence tints lifted until
  they read on any ground), a white blink, and a small health bar under whoever was hurt
  (`src/render/health_bars.js`: at the feet, since the numbers rise over the head; red under
  creatures and bosses, a quieter green under villagers and Lyra, never the player; it fades
  three seconds after the last hit). Numbers and bars are drawn over speech; a small screen
  draws only as many speech bubbles as it has room for (Lyra's, the player's, then the
  nearest), and bubbles keep off the player, Lyra and foes just hit (`src/render/bubbles.js`),
  so a fight in a shouting crowd still reads.

### 22.2 Runtime contract (`src/magic/magic.js`, `game.magic`)

- `game.magic.cast(caster, slotOrWeave, aim {x, y}) → { ok, reason?, plan }`;
  `game.magic.slots[0..5]`, `game.magic.mana {cur, max}`, `game.magic.unlocked {shapes,
  essences, twists}` (Sets), `unlock(kind, id, source)`, `setSlot(i, weave)`,
  `compile(weave) → plan`, `bodies` (live bodies: `{ kind: 'projectile'|'area'|'beam'|
  'strike'|'summon'|'rune'|'wall'|'trail', x, y, vx, vy, r, angle, age, life, owner,
  plan, essences, palette, gen }`), serialize/deserialize.
- Holds: `castStart(caster, slot, aim, { charge })` on the press (a beam pours at once;
  anything else waits, charging when `charge` is asked — the controls ask it for every
  press), `castHold(caster, aim)` each step (→ `{ mode, t, k, live, capped }`),
  `castRelease(caster, aim)` casts at charge k, `castCancel(caster)` lets go for free.
  Cooldowns: `cooldownLeft(i)`, `cooldownFraction(i)`, `cooldownTotal(i)`,
  `cooldownOfPlan(plan)`, `resetCooldowns()`.
- "Try all magic" (§24 Practice): `startTrial()` / `endTrial()`, `trial` (null when off),
  `realUnlocked` / `isEarned(kind, id)` (what is really earned, also during a trial),
  `trialDrafts` (weaves that left their slot when a trial ended).
- Bus events: `spell_cast {caster, weave, plan, slot, chargeK}`, `spell_hit {body, target,
  amount, essences}`, `status_applied {target, status}`, `reaction {id, x, y}`,
  `magic_unlocked {kind, id, source}`, `mana_changed {cur, max}`, `weave_ready {key,
  plan}` (a cooldown ran out), `magic_trial {on}`.
- Visuals live in `src/magic/fx.js` (a render layer drawing every body by kind with its
  palette, particle style and light, impacts, trails, status overlays, screen shake) and
  sound in `src/magic/sfx.js` (synthesized, per essence and shape). Core draws a plain
  fallback if fx is absent. Budget: 60 fps on a phone with a full screen of weaves (pooled
  bodies and particles, hard caps).
- **Test that it is combinatorial:** every shape × essence (and pairs) × twist (and
  triples) compiles, casts and runs for a few simulated seconds with no error, no NaN, no
  runaway body count, within a time budget.

### 22.3 Getting magic: missions and bosses (`src/missions/*`)

A mission system: givers (villagers, Lyra, the notice board), objectives (`defeat`
species/boss, `bring` items, `reach` a place at a time, `talk`, `weave` with a given
essence or shape, `protect`), progress tracking, a journal (Missions tab), map/HUD
markers, rewards (`magic` components, coins, items, xp), saved. Every shape (except the
starting `bolt`), essence and twist comes from exactly one mission or boss, in a curve
that gives the player something new every few minutes at first. Missions are written in
each giver's LORE voice, fit Hearthvale's life (the ward, the Drift, the bandits, the
ruins, the lake that hums), and never reveal hidden truths. Lyra has opinions: she may
come along, refuse what is too dangerous, worry about `dark`, and remembers what the player
did.

**Bosses** (each with art, a health bar, telegraphed attack patterns and phases, an arena,
a short intro scene, and a component reward): *Varek One-Eye* at the bandit camp (gives
`fire`: the fire that never goes out), *Greyjaw* the pack leader in deep Whisperwood,
*the Mother of Slimes* in the quarry's rain-pools, *the Lake's Hum* in Mirror Lake, and
*the Bone Warden* in the Sunken Ruins (gives `dark`). Rewards are picked up as glowing
glyph-shards with a short reveal ("You can weave fire").

### 22.4 Controls (`src/core/input.js`, `src/ui/touch.js`, `src/ui/spellbook.js`)

- **Phone, held sideways (landscape) is the battle layout**: the left side is a floating
  move stick (appears under the thumb); the right side has the sword button, the dodge,
  and the weave buttons in an arc. Drag from a weave button to aim (a preview shows the
  line, cone, circle or landing spot for its shape), release to cast, drag back to cancel;
  a tap casts at the nearest foe; holding charges it. Safe areas (notches) respected; the
  HUD is a thin top strip. Portrait keeps working. A one-time hint suggests turning the
  phone.
- **Desktop**: move with WASD, aim with the mouse, sword on the left button, weaves on
  1–4 (and the right button casts the weave marked with a small mouse on its slot; the
  wheel, Q / R or a number key moves the mark), B opens the Spellbook.
- **A click on a hotbar slot casts it** (r13; the author: "I click the button and the
  skill gets unselected after I hit it"): it is that slot's number key (`Weaving.
  clickStart` / `clickEnd`, source `click`): the press starts it, the release casts it, a
  quick click casts at once, a hold charges (and may be dragged out over the world to aim
  at the mouse); with the mouse still on the slot it aims the way a key does with the
  mouse away: the nearest foe in range, else straight ahead. It selects nothing, leaves no
  focus (a later Space swings the sword) and raises no slot; the name over the bar names
  the slot under the mouse or the one being cast. A keyboard Enter on a focused slot is a
  quick click; an empty slot opens the Spellbook on it; a right click on a slot opens it
  too.
- **Press, hold, release, on every device** (r12): a weave starts on the press and is
  cast on the release (`src/ui/weaving.js` `begin`/`finish`); a quick tap of a key, a
  click or a touch casts within the 0.18 s tap window (about 0.1 s later than an instant
  cast), a hold charges. The button shows it: a ring filling round the weave button (and
  the desktop hotbar slot), pulsing when full, dimmed with a hollow mana drop when the
  mana in hand caps it; in the world, motes gather at the hands with a light and a
  rising tone (none inside the tap window), and the release throws a burst that grows
  with the charge (a full one: a star, a wider ring, a small kick); the hit spark grows
  and a full charge's damage number is bigger. A weave cooling shows a dark sweep with
  a bright leading edge and its whole seconds while one or more is left, flashes when
  it comes back (a soft tick for waits over 1.2 s); pressing it then shakes it (the
  seconds flash red) with a quiet "not ready" knock (at most every 0.6 s, so pressing
  again and again does not drum), and nothing is cast. The magic
  lesson teaches the hold (a real charged cast moves it on) and the cooldown.
- **The Spellbook**: craft and edit weaves (pick a shape, essences, twists from what is
  unlocked; see cost, cooldown and damage; a live preview casts it at a training dummy),
  **the preview is the real Weave** (r13; the author: "when I [add] twists on spells, it
  does not change the preview"; `src/ui/weave_sandbox.js`): a sandbox with its own bus,
  clock, entity manager, combat, `Magic` runtime and fx layer, in a small walled arena with
  two straw dummies, casts the very plan the Spellbook compiled every 2.6 s (3.4 s for
  the slow shapes), the way a press and release would (a beam pours 1.2 s, a charge
  gathers 0.75 s), so every twist does what it does in the world — multishot fans,
  split bursts, bounce rebounds, chain arcs to the second dummy, orbit circles, spiral
  weaves, echo recasts, volley bursts, big and swift change the body, linger leaves its
  patch, burst explodes, homing turns after the dummy as it steps aside, pierce passes
  through, leech threads life back (green numbers), charge gathers first; a ward is shown
  stopping two stones the dummy throws. It is silent, never touches the real world,
  runs only while the Spellbook is open; if it cannot be built, the old imitation
  (`spellbook_preview.js`) plays instead. On a phone held upright the preview stays
  pinned at the top of the book while the steps scroll under it (sideways it already
  stayed on the left), so a twist tapped far down is seen changing the weave,
  assign them to slots, name them. Works on a phone in both orientations. Its Cast tile
  says how a weave is cast ("Tap or hold", "Hold" for a beam, "Fast charge" with the
  charge twist). While "Try all magic" runs, its header says "Trying all magic"; weaves
  made then that left their slot when it ended wait in a "From trying all magic" row (a
  tap weaves one into the open slot when it can be woven).

### 22.5 Bind and Ward (the author: "even the binding spell that the girl has, I can have it as well, or a shield spell that would save me from spells")

Two more shapes, plain registry entries like the rest:
- `bind` — the player's own Stillring: a ring of light that closes on the aimed target and
  holds it (rooted, unable to attack or cast) for a short time; essences flavor it (fire
  ring burns, frost freezes the hold longer, storm shocks, dark drains, song lulls, nature
  roots with vines…); bosses resist it (shorter hold, diminishing returns). Lyra teaches it
  at high trust as "the polite way to say stop" (a mission); binding a villager or Lyra is
  an attack with all of §19.7's weight.
- `ward` — a shield around the caster (or an ally it is aimed at) that absorbs a set amount
  of damage and blocks enemy projectiles and spells for a few seconds; essences flavor it
  (light reflects bolts back, fire burns whoever strikes it, frost chills them, earth and
  iron absorb more but slow you, water heals a little, wind deflects missiles, storm
  shocks, dark drinks a little health, nature grows thorns, poison stings, song shields
  nearby friends too); twists apply where they make sense (big = wider, linger = lasts
  longer, orbit = a ring of small shields, burst = explodes when it breaks). It is earned
  through a mission (fit it to the watch or the chapel).

*As built (r7/weave2).* Both are entries in `SHAPES` with their flavor tables
(`BIND_FLAVORS`, `WARD_FLAVORS`). Shapes may now carry hooks and `onPlan` like twists, and
`adapt: { twistId: { hooks: false, onPlan, clause } }` for a twist that means something
else on them (compile.js, naming.js). Two body kinds join the list: `bind` (the ring
holding its `target`) and `ward` (a shield on its `target`, with `shield`/`shieldMax`).
A bind's missile is a homing ring; whatever a bind weave touches is held through
`magic.holdTarget(body, target)` (status `bound`: root + disable; bosses BOSS_HOLD of
the time, halved per bind in a row, shrugged off after three, forgotten after 14 s;
children hold 55%; a lingering patch only roots). `combat.damage` asks
`magic.absorb(target, amount, source, opts)` before a blow lands (a blow taken whole still
emits `damage` with `amount: 0, absorbed`). Wards stop foes' `Projectile`s, foes' weave
missiles and boss `glob`/`bubble` hazards; bosses held by `disabled` pause their moves.
Bus: `bind {source, target, seconds, plan, resisted}`, `ward {caster, bearer, shield,
plan}`, `ward_broken {bearer, caster, plan}`. Missions: Lyra's *The Polite Way to Say
Stop* (trust 72; its lesson waits while she is unsure: a talk step's `trust`) and Wys's
*Two Is a Patrol* (the King's Road, the afternoon, wolves).

## 23. Talk to anyone, the way you talk to Lyra (the author: "I want to be able to talk to all the NPCs, and talk to them like I talk with this girl")

- The chat panel addresses whoever the player chooses: Lyra by default, or any villager
  near the player (a "To:" chip row with the portraits of who is within earshot; tapping a
  villager in the world or their portrait selects them; the field reads "Say something to
  Hobb…"). The same typing, mic and history as with Lyra; each villager keeps their own
  conversation history (saved), and the panel shows it when they are selected.
- Replies come from `village.playerSays` (§19.3): Claude with that villager's mind — profile,
  voice, opinion of the player, what they know and would share, rumors, their own memories
  of the player — on the player's action, with the local fallback. Villagers remember what
  the player said, talk about it to others, and it shapes their opinion; Lyra overhears
  when near. The villager dialog's own "Say something…" field stays as a shortcut.
- **Never a locked chat** (r13, the author: "even if somebody really hates me, make me able
  to talk to them. Because in real life, if somebody hates me, I can still talk to them").
  Hate, fear, terror, grief and "cut ties" never disable the field or say someone "won't
  talk to you": the words always reach them and are remembered, and they answer as they
  feel (cold, insulting, terrified, begging, refusing to help, one word, or turning away).
  The only reasons not to be heard are physical: dead, unconscious or downed, out of
  earshot, or a cutscene. "Has gone on her way" ends that conversation: an answer still on
  its way is never given, and catching up with her starts a new one.
- **Talking to whoever is in front of you** (round 14b, decision D3 and D4; the author:
  "Sometimes I click on them and try to talk to them. Stop this"): a tap or click on a
  person never opens talk (a click is the sword wherever it lands; the coach says once per
  life, at the first blow on a calm person, how talking works now). T, Enter, pad Y, the
  Talk buttons and the phone's idle Talk call `ui.talkToNearest()`: the nearest person in
  front of the player, facing first (`chat_target.nearestTalkTarget`: the companion, Lyra
  and every villager; asleep counts, downed and another roof do not), else the nearest in
  earshot, else **Everyone nearby** (say it aloud, §33.5). Beside someone, the phone's round
  button reads "Talk to Bram" and opens the chat to Bram (`ui.talkTo(id)`); Help and Search
  stay what they are for the downed and the dead. E on a person still opens their dialog
  (shop, gifts, missions); in the chat, a villager within reach has a "Trade · Give · Work"
  button (44 px) for it, farther off the header says "walk up to Bram to trade". The chat's
  default target is the nearest, else the companion (`party.holder`), else everyone
  nearby; Lyra, when she is not with you, is a person like anyone else: her chip shows
  while she can hear the chat (her own earshot: 30 / 18 / 16 tiles apart, left, gone).

### 23.1 One memory of everything they say (`src/ai/said_today.js`, `game.saidToday`; the author: "Connect it and let it have like a shot of what it said in this day, even if it was pop up text")

Every line a character says goes into a per-character log for the day (Lyra and each
villager; 60 lines; deduplicated when the same line arrives by two routes): the `speech`
event (chat replies, barks, shouts, her will's lines), bubbles shown without it (overheard
talk, a cry), thoughts said aloud, a villager's conversations out of the player's earshot
(`village.finishExchange`), gossip and listen-in lines, and toasts that quote someone.
`note`, `today`, `repeats` (already said today, or near enough: a shared three-word run,
or the same question), `fresh`, `dropRepeats`, `promptLines`. Saved with the brain.

- **Claude** is told, in both prompts, what they already said today (the questions always,
  then the latest lines): "keep to it, build on it, never say the same thing or ask the same
  question twice". A Claude reply that repeats anyway loses that sentence.
- **Local replies** dodge it: Lyra's speech banks and her will's lines pick another line;
  villagers drop a repeated sentence and its short answer ("Have you eaten? You haven't."),
  and a shrug ("I couldn't say. Ask Petra.") is never given twice while another is unsaid.
- **Asked about it** ("what were you just saying?", "what did you say to Pip?"), a villager
  quotes the last thing they said today, over their head or in the chat (to that person, if
  one is named), from this log (`player_talk.js` `recallSaid`); Lyra's Claude prompt has it.
- **"Did Elda tell you anything?"** Lyra answers from the message she really got
  (`ask.did_tell`, §23.2): who brought it and what it said, "not yet" while the promise is
  open, a plain no when nobody came.

### 23.2 Promises become real actions (`src/ai/social/commitments.js`, `village.commitments`; the author: "she said okay, but she didn't actually go", "The AI said he would give me something but didn't")

When the player asks a villager for something they can do, the game understands the ask
(`detect`), checks it is possible and whether they are willing (`decide`: can, will, why),
and their answer carries what they decided. A yes is a **commitment** the game carries out:

- **tell** ("go and talk to Lyra for me", "tell her I'm sorry"): when they are free they walk
  to her (village_life's `keep` step), the two talk (lines in the world, a listen-in), and
  Lyra really hears it (`Autonomy.hearMessage`: remembered with who brought it; an apology
  weighed as if said to her face; a call to come goes on her open agenda §16.12). Due within
  1.5 days.
- **give** ("can I have a honey cake"): the item changes hands now, from their own trade
  (`GIVES`: Elda's cakes, bread and stew, Mira's herbs, Corran's fish…, each with the opinion
  it needs; at most two gifts a day, never the same twice). An offer in their own words
  ("take a honey cake for the road") is handed over too.
- **teach** ("teach me magic"): a part they actually know — their errands that end in a
  weave (`TEACHES`, from `missions/data.js`; LORE §13): the lesson (the mission) starts and
  the part unlocks when it is done. Not yet: they say when ("after First Spark"); none to
  teach: they say who does. Lyra's own "teach me" offers her lesson (`offer_lesson`).

A no says plainly why. Claude, when it voices them, is told the ask and what is possible,
and answers with `commit: { kind, agree }`; the game never acts on a yes it has not checked
(a yes to the impossible is answered with the plain reason). A promise not kept by its day
is **broken**: both sides remember (their notes, the player's toast), and they own it first
next time. Kept: "Elda kept their word — Elda found Lyra and talked to her for you". A
villager who has gone on their way, or backed off in fear, cannot answer after: a late
reply is not delivered, and the field says so. Saved in `village.commitments`.
Sleeping to morning (§19.8, now at any hour) breaks no promise: hours skipped are hours
nobody could keep one in, so an open promise's day moves on with the clock (the walk a sleep
interrupted starts again). "Teach me" asks for a lesson on its own; "show me…" only with the
weave in it, so "show me where my bed is" is the way home (§19.8), never a lesson.
*Round 13 x 14a:* a "go tell Lyra" while she is out past the vale (the wider world, §32)
waits for her to come home: the villager says so ("She's out past the vale just now. I'll
tell her when she's back"), never walks out into the wilds after her, turns back from a
walk begun if she leaves (`commitments.lyraAway`, `stopWalk`), and a day lost to her
absence breaks it with that reason ("Lyra was away, out past the vale").

### 23.3 Silence is a choice made after hearing (`src/ai/silence.js`; the author: "make them able to choose to not respond to me but they have to get my msg so they get it and decide to not answer")

Within earshot, every line the player sends reaches the person first (out of earshot,
nothing does: Lyra's `player_message`, her will's weighing of an apology and her record of
the talk wait until she can hear): into their conversation (a
villager's talk and chat history, Lyra's `mind.conversation`), into what they remember of
the player, and into their Claude prompt or local rules. Then they decide whether to answer.
Silence is one answer, and the player sees it done, as a narration row in the chat and
their back turned (`silenceAct`, `turnAway`): "Elda hears you. She says nothing and turns
away." Never an empty screen, a disabled field, "didn't catch that" or a failure.

- **Offline** (local rules): someone cold to the player (hostile, or raw with what the
  player did) who has just answered them coldly lets the next line pressed on them within
  a minute go unanswered, then speaks again; a terrified witness falls silent after terror,
  begging and a scream (§29.3); Lyra, cut off or broken off, gives a word to the first line
  and silence to the next one pressed on her within 40 s, and her "…" is a silence too.
- **With Claude**: villagers answer `{"silent": true, "say": ""}` (the schema carries it;
  the rules say they always hear and may say nothing); Lyra, gone or left, may give an empty
  say with no action. The game keeps a silence only where it sees a reason (cold, wronged,
  threatened, insulted, wary or worse; for Lyra, gone or left): a friend's silence for no
  reason falls back to their own words. The next prompt carries it: "You: (you heard it, and
  said nothing)".
- A silent turn makes no promise and gives nothing (a request met with silence is a no).

## 24. One clean menu (the author: "the settings [are] so multiplied… when I press the menu I see all the things that I see in the HUD")

- The pause menu never repeats what the HUD already gives one tap away. One menu: Resume,
  Spellbook, Missions, Lyra (her Mind panel), Home (r13: marks the way to your bed, §19.8),
  The Book of Halcyre, Settings, Save, Quit to title. Settings are grouped into a few tabs (Game, Controls, Sound & voices, Minds
  (Claude), Display), each option exactly once, with short plain explanations; nothing
  duplicated between the settings, the menu and the HUD.
- **Game → Practice** (r12; the author: "can you add in the settings a thing that will
  reset states and a thing that gives me all the magic stuff to try it"): three action rows
  (a label, a note and a button; not settings, so never saved with them), each behind the
  in-game confirm (`ui.confirm`, danger), both greyed on the title screen and while the
  player lies fallen, the note saying why.
  - **Reset stat points**: every spent point back to spend again, free
    (`Progression.resetPoints()`; greyed with nothing spent). "All N points come back to
    spend again. Your level, gear and weaves stay." A toast then says to open the
    Character sheet; its points badge shows them. While Free stat points is on it takes
    the free points off (the real ones still wait).
  - **Free stat points: On/Off** (r13; the author: "give me a button to give me inf stats
    points like the magic thing"; "infinite stats should work like magic"): a switch like
    Try all magic (`Progression.startFree()` / `endFree()`, `progression.free`). On: the
    points really spent are kept aside (`realPoints`) and every attribute can be raised as
    far as you like (up to 999 each; the stat pipeline's caps still hold), free, on the
    Character sheet, which then shows −, + and +10 on each row and a "Free points" badge
    instead of a count (the HUD card's points badge hides). Off: exactly the points
    really spent come back; levels gained meanwhile leave their points to spend. The
    chapel's respec waits until it is off. Saved with the game (`free`, `realPoints`;
    free points are not clamped to the levels on load, the real ones are); greyed on the
    title screen and while fallen like the other rows.
  - **Try all magic: On/Off**: every shape, essence, twist and price, six weave slots,
    three essences and four twists to a weave, until it is turned off here
    (`Magic.startTrial()` / `endTrial()`). The mana is not refilled. The real unlocks,
    sources, slot counts and weaves are kept aside; a real reward earned meanwhile (a
    mission's part, a slot, a boss's price) goes into the real state too, so it stays
    when the trial ends (boss price drops, glyph shards, mission reveals and offers ask
    the real sets: `magic.realUnlocked`). Off: the real unlocks and counts come back, a
    weave made meanwhile that the real parts can weave stays in its slot, any other goes
    back to what was there and waits in the Spellbook as a draft; prices still running
    that were only borrowed end, their modifiers with them. The confirm warns that prices
    still cost what they say (Berserk's end can still end the story). Saved with the game
    (the save holds the real state and the trial's own slots; loading it keeps the trial
    on). Lent parts raise no "found" toast, Lyra line, lesson, book dot or Spellbook "new"
    mark; a weave made of them counts for no mission objective and spends none of Lyra's
    first-sight lines (`earnedPart` / `weaveEarned` in `src/missions/tracker.js`).

## 25. Prices: power with a cost (the author: "side effects, where I can choose… for 15 seconds my attack power +20%, but my HP goes down 40% for 2 minutes… or Berserk: strength 200%, speed, but I die at the end")

A fourth family in the Weave (`PRICES` in `src/magic/prices.js`), plain registry entries
that work with any weave: attach a price to a weave in the Spellbook (or weave a `surge`,
a self-cast shape whose essences choose what it empowers) and every cast pays it. Each price
is a **gain** and a **cost**, both timed modifiers on the shared stat pipeline (§26):
- `bloodprice` — +20% damage for 15 s; max HP −40% for 2 min.
- `berserk` — the last measure: 200% strength, +40% speed, faster swings and casts, no
  stagger, for 2 min; when it ends the heart gives out and the player falls (§27, with a
  short 30 s window).
- `glass` — +50% weave power for 30 s; take +50% damage for 30 s.
- `overdraw` — weaves cost no mana for 10 s; then no mana regeneration for 20 s. Casting
  it again while the well is dry borrows nothing (the drought is paid in full).
- `emberblood` — while active, lose 2% HP per second; cast 30% faster and weaves cost 30%
  less mana (the blood pays part of each) (toggle).
- `lastlight` — when the player would fall, heal fully once; max HP −50% until the next
  sleep.
- `oath` — +30% to everything while Lyra is near; if she is hurt, the player is too.
- `laststand` — the Last Stand (round 14: "if I die, maybe I come back for 1 minute and
  kill anybody, but it will not let me live anymore"). Carried by the Bone Warden (a
  second glyph-shard beside overdraw's, `BOSS_SECOND_PRICES`), never at the start, never
  lent by "Try all magic". Casting a weave that carries it asks first, in the game's own
  dialog with the danger style and "Not this" focused, the price in full ("you die for
  good… no kept flame, nobody can carry you to Mira, waking at home does not save you:
  your story ends and this save closes"); only a yes holds it (a ☠ mark on the HUD; a tap
  puts it out while it is only held). When you would die it rises you instead: whole, for
  60 s, strength ×2.5, weaves ×2, +35% speed, faster swings and casts, no stagger, damage
  taken ×0.4, and nothing can put you down (preventFall holds you at 1). While down with
  it held you may also choose to rise at once: a Rise button under the countdown that
  must be held for a second (R on a keyboard). The minute shows as embers off the body,
  the rage aura, fire at the screen's edges breathing faster as it runs out and white-hot
  in the last ten seconds, and the HUD timer. When it ends you die for good
  (`survival.burnOut`): the final death whatever flame burns or Settings say, its own
  curtain ("The fire goes out.") and memorial words, and Lyra's last entry says what she
  saw. Order with the others: lastlight catches the fall first (the last stand stays
  held); berserk's end cannot fell you while you burn, and the burn ends it. Saved as
  held or as the seconds left, so closing the page does not escape the minute.
Played and balanced in round 14b (`scripts/price_sim.mjs`: each price in a long fight at
level 1, beside no price at all; the author's own numbers kept as said). In a fight of
fifteen seconds every price but lastlight and oath (which pay off elsewhere) gives 20–50%
more damage; past thirty seconds bloodprice, glass and emberblood leave you lower, and
overdraw's drought takes back most of its burst. The table is the script's output.
Prices are earned like other components (missions, bosses, a few found), shown with their
cost in red in the Spellbook and on the hotbar button, and their timers on the HUD. Lyra
notices and has opinions (berserk frightens her).

## 26. Stats, levels and gear (the author: "I'm really interested to improve my gear and improve my health. And make stat points.")

- **One stat pipeline** (`src/core/stats.js`): every actor's derived stats = base + level +
  stat points + gear + timed modifiers (statuses, prices, food, potions). Combat, magic,
  movement and the HUD read derived stats only.
- **Levels and points**: xp from fights, missions, bosses and good deeds; each level gives
  3 points to spend: Vitality (max HP, regen), Might (sword and strike damage), Weave
  (spell power), Focus (max mana, mana regen, cooldowns), Grace (speed, dodge, crit),
  Resolve (status resistance, longer bleed-out window, carry speed). A character sheet in
  the menu; respec at the chapel for a price, or for free from Settings → Game → Reset
  stat points (§24; the Character sheet names both). Either gives back every spent point
  and keeps the level, gear, weaves and the points missions gave; health and mana settle
  into the new maximums.
- **Gear**: slots weapon, armor, cloak, boots, two charms. Items have stats and a rarity
  color; Bram forges and upgrades weapons and armor (with ore, crystals and coin), Sabeth
  sews cloaks, Garrick sells charms, bosses and missions drop special pieces, Mira and Elda
  sell potions and food that give timed buffs. Equipping shows on the player's sprite where
  it reasonably can (weapon, cloak color, armor tint).

## 27. Death is dangerous (the author: "if I die, I would not be able to come back… except if I have some certain place to get me back… I lay down on the ground, so Lyra and other people can pick me up and help me… get me to a hospital… and I can do the same… just before I die… so cinematic")

- **Falling.** At 0 HP the player falls and lies on the ground, alive, with a **bleed-out
  timer** (75 s; Resolve lengthens it; berserk's end gives 30 s). The scene turns
  cinematic: a beat of slow motion, the color drains, a heartbeat, muffled sound, a
  closing vignette. The player can crawl a little and **call for help** (a button; the
  shout reaches whoever is in earshot).
- **The countdown** (round 14: "there isn't a clear countdown to me dying";
  `src/ui/death_view.js`, numbers from `survival.countdown()`). Under the body, one row:
  a ring that drains clockwise with the seconds left, the number big in its middle (red in
  the last quarter), and beside it what is happening. The ring kicks on every heartbeat,
  and the heart (`HEART_BPM`) goes from a resting 66 to a racing 158 as the window
  closes, then falters in the last 12% (weaker, uneven, some beats missing); the sound's
  lub-dub closes up as it races. Why it drains faster or slower is said (crawling, cold
  water, someone pressing on the wound, held on someone's shoulders). Whoever is saving
  you fills an inner gold ring and a bar: dressing the wound, lending warmth, lifting you,
  and the carry with its time to the cot (red if it is longer than the seconds you have).
  Phone sideways the ring is 88 px, upright 96 px, a computer 136 px; it stays clear of the
  stick, the hotbar and the buttons.
- **Crawling** (round 14: "the crawling has no animation"). A fallen body drags itself
  face down: a four-frame crawl in every direction (`paintCrawl` in
  `art/characters_humanoid.js`: one arm reaching past the head, the other hauling, the
  opposite knee driving; laid along the ground for left and right, flattened for up and
  down), painted only for whoever falls (`ensureCrawl`, off the boot path). The frame is
  picked by distance dragged (2.5 px a frame), so hands never slide. 11 px/s (walking is
  60), 88 px in all, and it drains the window 1.6× while you move. A pool of blood where
  someone falls and a smear behind them (`survival/trail.js`, cosmetic, capped, not saved,
  fading over 2.5 min; water takes it). Villagers and Lyra on the ground drag themselves
  away from whoever stands over them (0.8× the player's pace).
- **Rescue.** Lyra comes for the player whatever their quarrel (LORE: she never leaves a
  living person to die when she could carry them; how she speaks to them while doing it
  depends on everything between them), and so do villagers in earshot (the watch, Hess,
  Mira, Hobb…). A rescuer can **revive on the spot** if they have the means (Mira's salves,
  Lyra's lending warmth — partial health and a *bruised* weakness) or **pick the player up
  and carry them** to a place of healing — **Mira's herbalist (the village's sickroom)** or
  **the chapel** — before the timer runs out. Carrying is shown (the rescuer carries the
  player; the camera follows in letterbox; Lyra talks to them on the way). Reaching a
  sickroom bed in time: the player wakes there hours later, tended, with Mira's bill and a
  weakness for a while.
- **The player can do the same.** Villagers and Lyra who fall (they never die) lie with
  their own window; the player can revive them (potion, a healing weave) or pick them up
  and carry them to the sickroom (slow walk, no attacking, can drop them), then go back to
  the fight. Saving someone is remembered: big trust and affection, rumors, Lyra's diary.
  If nobody comes in time they are carried off gravely hurt and out for a day.
- **Death.** If the window closes, the player dies. **A kept flame brings them back**: at
  the chapel, Sister Aveline can relight the stranger's family flame for them (a rite, a
  price; one at a time). Dying with a kept flame: they wake at the chapel at dawn, the flame
  spent, *flame-thin* (weaker) for a day, and the village knows. Dying without
  one ends the story: a memorial (Lyra's last diary entry about them, what the village
  says), and that save can never be continued — it moves to *Past lives* on the title
  screen. New Game explains this clearly. A setting (Game tab) can soften it to "wake at
  home" for players who want that; it is off by default, as the author wants.
- **The ember-ring: death costs everything you carry** (round 14: "I lose all my coins,
  and the place I died in would have this Elden Ring thing… click E to regain my coins…
  if I die before going there, I lose it"). Coming back from a death (the kept flame, or
  waking at home) leaves every coin where you fell (`survival.dropRing`,
  `survival/ember_ring.js`): a ring of embers on the ground with the coins in its heart,
  sparks rising, lit at night. Walk back and take it (E, or the hand button: "Take back
  your 57 coins"). Die again before you reach it and it goes out, coins and all (the
  waking words say so); die with an empty purse and there is no new ring. One at a time,
  saved with the game (`survival.serialize().ring`, a few dozen bytes). A tag floats over
  it while it is in view and an ember arrow at the screen's edge points the way with the
  paces to it (`ui/ember_ring_view.js`, clear of the HUD, the hotbar and the thumbs: it
  measures the mission line and the corner cards as drawn, so Interface size's zoom on a
  computer never puts it on them, round 13 x 14a); maps
  read `survival.mapMarks()`. Lyra knows (her prompt). A rescue is not a death: carried
  to the sickroom you keep your purse (less Mira's bill). The final death leaves no ring.
  Only coins: items stay with you. (The watch's fine when it hauls you in stays 10%.)
- **Checked** by `tests/death_heavier.test.mjs` (the crawl frames, the drag, the
  countdown's numbers and the heart, the ember-ring's life, the Last Stand's rules) and
  `scripts/death_check.mjs`, which plays all of it by touch on a phone both ways and by
  keys on a computer (countdown in view and clear of the stick and hotbar, crawl, the
  rescue bar, the ring and its arrow, taking it back, the confirm, the held Rise, the end).

## 28. Errands, problems, and the missing (the author: "everyone has a job… he needs to go to the ironsmith today… he doesn't find the ironsmith… he is not able to continue his day… Claude thinks: why am I not able to continue my job? The shopkeeper isn't there. Where is he? He will ask other villagers… if they don't know, they will search… ask more people… and at the end they might just say that he's missing, and they will have no idea why")

- **Errands.** Every villager's day has real errands that depend on other people and
  places, generated each morning from their work and relationships (data per villager in
  `src/ai/village_life/errands_data.js`): Hobb buys wick from Garrick and lights the lamps;
  Pip takes Bram his lunch; Elda buys honey from Wenna and eggs from Tansy; Tilly fetches
  ore from the quarry; Mira takes Petra her salve; Wys reports to Rowan at dusk; Alder
  brings Moot business to Elda; Corran sells his catch at the Kettle; Sabeth delivers cloth
  to Garrick… An errand = `{ who, purpose, needs: { person?, place?, item? }, window,
  then }`. Errands are visible (a villager walking somewhere has a reason the player can
  learn by asking or watching) and they make the village economy and relationships real.
- **Sightings.** Every villager (and Lyra) remembers who they saw, where and when
  (`lastSeen`), from their own eyes as they move about. This is what they actually know.
- **Problems.** When an errand cannot be done (the person is not where they should be,
  the shop is shut, the item is gone, the way is blocked), the villager has a **problem**
  and **thinks** about it: why can't I go on? who do I need? where would they be? who
  would know? Then they act: go where the person should be, check their home, ask the
  people most likely to know (family, work-mates, neighbors), ask again, wait, give up for
  today, or raise the alarm with the watch. Each villager asked answers from *their own*
  knowledge (sightings, the missing person's habits, rumors) and may reason and act in turn
  (they join the search, or remember something). Word spreads person to person; the watch
  organizes a search; Lyra hears and may ask the player ("Have you seen Garrick?") — and
  the player may lie. Found: "There you are!" and the day goes on. Not found by nightfall:
  **missing** becomes village knowledge; schedules adapt (someone minds the shop), people
  worry, and in the end they may say he's missing and have no idea why.
- **Claude thinks for them.** Each think step is a compact decision: the villager's profile
  and voice, what they know (sightings, habits, rumors, what others told them), the problem,
  and the actions open to them → `{ thought, say, action: { type: go|ask|wait|search|alarm|
  give_up|tell_lyra, target }, belief? }`. With a Claude provider (claude.ai or an API key)
  and the setting **"Villagers think with Claude: always"**, these steps run in the
  background, **batched** (one call reasons for every villager who has a pending problem),
  **budgeted** (at most one call per ~30 s, a per-session cap, quick tier), only when there
  is a real problem, and never for idle chatter; the local reasoner (the same actions from
  rules over the same knowledge) runs whenever Claude is off, busy, failing or over budget.
  Never block the game.
- **The player can follow it**: a villager with a problem shows it (a "?" over their head,
  their thought in the Mind-style Village view, what they say aloud); asking them "what's
  wrong?" gets their real situation.

## 29. Killing, witnesses and what the village can know (the author: "if I killed someone without nobody seeing it, nobody should know… they would feel that he's missing")

- A fallen villager can be **killed** only by the player's deliberate finishing blow (an
  explicit hold-to-strike on someone lying down, with a clear warning the first time). Since
  round 14b any adult can die by it, Lyra and whoever walks with you included; never a child
  (`isMinor`; §35.1). The bosses' rules are unchanged. The dead lie where they fell.
- **Witnesses** are anyone who saw it (line of sight, light, distance — night and walls
  hide things). Seen: murder — the alarm, the watch, Lyra's horror (§19.7 at its gravest),
  the village turns on the player. Unseen: nobody knows. The dead person's errands fail;
  §28 runs: people notice, ask, search, and say he is missing.
- **Bodies and evidence.** A body can be found (someone's search reaches it; a patrol; the
  lake gives it back after a few days). The player can carry a body (§27 carrying) and hide
  it (deep woods, the lake, the ruins). A found body turns *missing* into *murder*: the watch
  investigates with what people actually know — who was last seen with him, where, when
  (sightings of the player nearby), what the player said when asked — and may question the
  player, who can lie, deflect or confess. Suspicion is a belief, not a certainty; Lyra
  weighs it with everything else she knows of the player.
- Grief is real and lasting: family and friends mourn (their days change, their lines
  change), the village talks, the Moot meets, the dead person's work goes undone or
  passes to someone else.

### 29.1 How it is built (`src/murder/*`, `game.murder`; UI `src/ui/murder_view.js`)

- **Knowing** (`witness.js`): `look(game, seer, x, y)` → `{ clarity: 'clear'|'glimpse' }` or
  null: awake and up, the same space (both outdoors or the same building), within range
  (150 px by day falling to 56 px in the dark, 118 px under a lit lamp or fire, 210 px in a
  room, 40 px for Wenna), and a line of sight (walls block it; two trees in the way block
  it). Clear = close, or near in good light: they know who. `combat.damage` asks
  `murder.screenCrime()` before recording a crime: a blow nobody saw is no crime yet; the
  victim knows and tells the first person who reaches them, or the watch once up. Lyra's
  perception and autonomy, and the village's gossip, only take what was seen.
- **The finishing blow**: the attack button over a downed villager starts a held strike
  (`FINISH_HOLD` 1.5 s, a ring closing over them); the first time, a plain warning
  (`flags.finisherWarned`; Lyra has her own, round 14b). Never a child (by age, `isMinor`:
  §35.1). `murder.kill(v)` →
  `villageLife.markGone(id, { cause: 'killed', keepBody: true })`; the body lies still.
- **Seen**: the cries, the witnesses' terror (§29.3) and the rumor `murder`, carried face to
  face (§29.2). When the news reaches the watch (`raiseAlarm`): wanted (`player.crime =
  { level: 3, kind: 'murder' }`), the bell, `crime {kind: 'murder'}`, the village turns,
  shops refuse, Lyra goes (`murdered_villager` deed → `gone`). **Unseen**: nothing; §28 runs.
- **Bodies**: lift (`survival.startCarry`), and lay down / sink in the lake (back on the
  shore in 2–4 days, found in the morning) / hide in the deep woods (a search of the wood
  or Hess may find it) / leave in the ruins (kept). Seen carrying it: clearly → murder;
  a glimpse → a clue. Found → covered, laid out on a bier in the chapel, a funeral next
  dusk (a scene if the player is there), buried behind the chapel (a grave you can read).
- **The watch** (`investigation.js`): evidence from real knowledge (witnesses, carrying,
  over the body, last seen with, near the place and time, lies to anyone that sightings
  contradict, harm done before, the answers given) → suspicion (noisy-OR; ×0.8 out past
  the ward with nothing strong: "it could have been the bandits"). The lead (Rowan, else
  Wys, Hess, Alder) comes to ask: truth, lie, dodge or confess per question; ≥ 0.6 →
  "Go quietly / Run". The Moot (Alder, else Elda, Petra…) tries the stranger: guilty
  → *outside* for 3 days, the kept flame put out and barred, half the coin to the family;
  or not proven. Round 14b (§36.5): the stranger speaks a defence in their own words and
  each juror weighs it on their own knowledge (one Claude call each); the verdict emerges
  from the votes, and mercy is a lighter sentence (one day outside). The old arithmetic
  (a confession, a clear eyewitness, or suspicion ≥ 0.75) remains for the absent. Wanted and
  never caught: the Moot judges in their absence.
- **Grief and the world**: mourning (family 30 days, close friends 14, friends 4; family
  stay home of a morning, pray at dusk), grief in their first words, the Moot meets, the
  work passes (`HEIRS`, village_life `COVER`; the shop goes with it) or stays undone,
  missions pass to a stand-in or the notice board (`STAND_INS`; a word for the dead is
  skipped), the Maren thread goes through Petra, Mira or Elda if Aveline is gone, Lyra
  goes home to her surviving parent. Events: `villager_killed`, `murder_witnessed`,
  `body_hidden`, `body_found`, `murder_case`, `questioned`, `arrested`, `moot_met`,
  `funeral`, `moot_verdict`. Saved in `save.murder`.

### 29.2 Eyes and words (`src/ai/sight.js` over `murder/witness.js`; `village.js`; the author: "Villagers are able to see me kill behind walls… he shouldn't be able to send off the information until he meets other people")

- **One rule for eyes.** Every eye goes through `look()` (§29.1: awake, the same space, range
  for the light, a line of sight through no wall or house): Lyra's sight (`missions/lyra.js`
  was distance-only), the harmless kill she "saw from another house" and her cruelty
  reactions (perception), the villagers' sightings sweep and `npc.canSee` (was: the same
  building only), murder witnesses, and who saw a deed in the village's gossip.
  The line of sight stops at the tiles a blow stops at (§31.1 `wallTile`: walls, rock, a shut
  door); a felled tree's stump (§31.3) hides nobody; and a lamp under a roof lights its own
  room, never the street outside the wall (the rule the roofs give the renderer, §31.5), so
  the chapel's altar does not light a killing in the square.
- **News travels by meeting.** Grave news passes face to face only (`MEET` 88 px, the same
  roof, both awake). A killing seen is known by those who saw it and those near enough to
  make out the scream's words (96 px, and no wall between: §29.4); nobody else. The watch learns only when someone who knows
  reaches them (`tickNews` → `raiseAlarm`): then wanted, the bell, the body found, the case
  certain, the village turns, Lyra hears the bell. A watchman who saw it raises it at once;
  a witness who has run to one of the watch tells them within 64 px, roof or no roof (she
  shouts it in at the door).
- **Until then, nobody knows who did it.** A witness's account counts in the watch's case
  only once the watch has heard it; a body found first by someone else is a mystery at a
  mystery's pace (weighed again, and hastened, when the witness arrives). A witness does not
  "find" the body she saw fall. Shops refuse the killer only once they know (`knowsKiller`:
  saw it, were told, or heard the bell); `knownDead` likewise.

### 29.3 Witnesses are people (`murder.terrify`, `village.fearNote`, `village.afraidReply`, `ui/chat.js`; the author: "I killed in front of this old woman 3 people and she responds like this after, no effect")

- Someone who watched the stranger kill is **terrified** (`e.terror`, 18 h): they run for the
  watch, screaming (`npc.startFlee(…, { to })`: the nearest of Rowan, Wys or Hess awake, else
  the guardhouse; another cry for help on the way does not turn them aside), their opinion
  falls to the floor, and they **answer only in terror**: tapping them or picking them in
  the chat shows what the player sees ("Elda backs away from you, white to the lips.") each
  time the chat opens to them or turns to them (never twice in a row), the header says
  "terrified of you" (then "afraid of you", `chat_target.fearWord`), and
  the field stays open; what the player says reaches them and is remembered, and the answer
  is fear in their own words, never calm, never Claude wording it kindly, and no errands
  run for a killer. Pressed on and on (within a minute of each other), fear changes as a
  person's would: terror ("Don't come near me. Murderer."), then begging ("Please, love—
  please. I'm an old woman. Let me be."), then a scream for help ("Rowan! ROWAN! Somebody
  help me!"), then silence, shown as an act ("Elda hears you. She says nothing; she only
  backs away, shaking."; §23.3), and round again. Every line is kept in their talk, and
  they remember that the player came talking at them after what they saw.
- After two killings seen, they are never calm with the stranger again (`e.dread`, saved).
- Nor do they go back to the stranger's feet: a terrified (or dreading) witness never takes a
  helper's part beside them (`helpRole` gives `flee`: no tending, shielding or fetching by the
  body), and when their flight ends they do not return to the victim they had come to tend
  (`npc.endFlee`). Replayed: Elda, a tender by trade, knelt again by the next body at the
  killer's feet after a second cry.
- A villager who **has gone on their way** cannot answer after: a reply that comes late is
  not delivered (the author saw Elda answer after "Elda has gone on her way", twice).

### 29.4 Ears (`src/ai/hearing.js`; the author, of Wenna crying "Who's there? Stop it, whoever you are!" in the street at a killing inside the Ember Kettle: "How does it sees the death from the wall?")

Hearing is a sense like sight, with one rule, and it tells **what and where, never who**.

- **One rule for ears**: `hears(game, listener, x, y, loud, { mul })` → `'clear' | 'muffled' |
  null`. The reach is the loudness in open air (`LOUD`: words 44 px, a scream's words 96, a
  blow 300, a cry for help by severity 300 / 440 / 600; kin hear their own ×1.8 at severity 2+).
  A wall or a shut door on the straight line (`walls.js wallBetween`, the tiles that stop a
  blow) muffles it to `MUFFLE` 0.3 of the reach, and each further wall again: a scream inside
  a shut house is heard just outside it (180 px), not down the street. An open door lets it
  out: in line with the doorway it is open air; round the corner, along the way through the
  doorway, `DOOR` 0.6 of the reach, muffled. Asleep: 0.3 of the reach (the loudest, 0.6). The
  dead, the downed, the absent and the carried hear nothing.
- **Everyone uses it**: the village answering a cry (`npc.onCallForHelp`), the watch and Hess
  hearing a blow (`npc.onCrime`; a theft makes no sound, the bell is news, not a noise),
  `murder.heardBy` (the "nobody near enough to hear" toast; through a wall, "may have heard
  something"), the words of a witness's scream (`seenMurder`, 96 px, clear only), a fallen
  victim telling who did it (`TELL_REACH` 44 px, clear only), the village's own record of a cry
  (`village` `call_for_help`: who did it goes to those who see it and to whoever the hurt one
  can tell, never to all within 240 px), Lyra overhearing the player (110 px, clear only),
  the bystanders of the player's words in the village's news (a threat, an insult, a kind
  word: 90 px, clear only; Lyra saying she is leaving: 200 px, clear only; `witnessesNear(…,
  { words: true })`) — while a rescue or a helping hand is news only to those who saw it,
  and the player's own shout when fallen (`survival.alert`; the watch hunting a wanted stranger
  and the sight sweep keep their own reach). Lyra's cry at a crime (`barks` `crime_warning`)
  and what her perception makes of it take only a blow she saw (`sight.sawTheBlow`): out in
  the street beyond a wall she no longer shouts "What have you done?!" at a blow she never saw.
- **Hearing tells what and where.** A beast's snarl or a bandit's yell says what it is (the
  watch runs to fight the wolf it heard); a person — the player, Lyra, a villager — is known
  only by eyes (the sight rule: seen at the hurt one's side within 96 px, or the blow itself
  seen) or by words (the hurt one, close by; someone who ran to tell them: `onCallForHelp(p,
  true)` carries who the teller knew, and `culprit` for the one who really did it). Someone who
  only heard: stops, turns to the sound and says what they heard (`HEAR_LINES`: "What was
  that? It came from the Kettle!"; Wenna, who is blind, keeps "Who's there? Stop it, whoever
  you are!"), and may come to look (`look`: carers, the watch and Hess, those near), tend, or
  fetch the watch. They do not flee from the player, call them by name, shout the wanted
  lines, think less of them, or fight them. On the way (`helpStep`) they may see who stands
  over the hurt one, or be told by them: then they know (`learnWho`: the crime's rumor, as a
  witness), and answer as one who knows. A body come upon is found (`murder.bodySeen`: and
  the one standing over it is seen there).
- **Knowing the stranger is wanted is each villager's own** (`npc.knowsWanted`): the bell (a
  killing told to the watch, the Moot's sentence) reaches everyone; a blow reaches those who saw
  it, came and saw, were told by the hurt one, or had it face to face (the village's crime
  rumors today). Villagers flee a wanted stranger, a watchman strikes them on sight, and a shop
  turns them away, only when they know. `player.crime` stays the record combat keeps.
- **No crime on the wind.** A crime no longer makes the whole village colder the same day.
  Those who saw it are cold and think less of the stranger; those who only heard it are
  uneasy (`npc.uneasy`: a line about the place, never a person); everyone else learns it by
  meeting someone who knows (§29.2's news; `village.onHeard` moves them then).
- **Told is not seen.** A blow nobody saw is the hurt one's to tell (`murder.reveal`): when
  they tell whoever reaches them, the crime goes on record and its event carries a screen of
  its own (`lastScreen` with only the one told; `sawBlow`, `toldNow`). So `npc.onCrime` and
  the village's crime rumor take only the one told as knowing it, and a told crime makes no
  sound: the watchman in the square who happens to see the stranger walking by at that moment
  saw no blow, and neither fights, flees nor turns cold for it. The crime notice says what is
  true: "…and word of it is out. Once it reaches the watch, they will hunt you…".
- **A body found reaches Lyra as news.** She learns of a body found by someone else from the
  finder's own cry when she makes out the words (`murder.lyraHearsFinding`: `hears(…,
  LOUD.shout)` clear: in the open or in line with an open door), else when someone who knows
  tells her (the village's `found_dead` rumor reaches her face to face, `tickNews`), else with
  the whole village within the hour (`rec.lyraNewsAt` = `newsAt`). Never through two walls
  the moment someone next door finds it; she weighs the watch's case only once she knows.
- **Her mind's ears too.** What Lyra takes in of words said near her (`perception.onSpeech`,
  160 px) is only what she hears clearly (`hearsWords`): a name screamed in the next house is
  a noise.

## 30. pixelfx effects (the author: "download and use pixelfx if you see fit"; "the spells do not do any damage, and it's not clear")

**Third-party.** pixelfx (patch-gg, MIT, commit 5294518) is vendored in `src/vendor/pixelfx/` with its
LICENSE and NOTICE (Sprite Fusion by Hugo Duprez and Hollow Crown, both MIT). Only `core/*.js` and the
effects the game plays are copied; not its gallery (its font is not MIT), docs, tools or records. See
`THIRD_PARTY.md`.

**The view.** pixelfx is drawn for a side view; Hearthlight is seen from above. Nothing uses the stock
actor or acts. The effects we use were redrawn top-down where they needed it (each file says what changed
at its top): rings, pools and shockwaves lie on the floor as 0.6–0.75 ellipses; sparks, chips, clods and
drops scatter over the floor in x and y, hopping up the screen and landing near where they rose (a
per-particle floor in `core/sim.js`); aimed effects take the blow's angle (`aim`) and were looked at in
four to eight directions; statuses, heals and souls wrap the afflicted body's own sprite frame
(`pixel_fx_bodies.js`; a boss's from its own sheet, `bossFrame`). Effects that wrap a body are made round
ours from the start; pixelfx would otherwise fill in its 24x38 stand-in, and a body it cannot read keeps
the old look.

**The host** (`src/render/pixel_fx.js`, `game.pixelFx`): `play(id, { x, y | follow, dx, dy, angle,
palette, tag, life, ...opts })` → handle, `stop(handle | tag)`, `playing()`, `clear()`.
- Each live effect owns a pooled frame (color + light) sized to its bounds; when painted, the box its
  color fills is kept as a small picture and drawn into the world buffer at its world spot minus (ox, oy);
  its light is a second small picture added with `'lighter'` after the night's lighting (held back a
  little by day), so effects glow at night and never wash the day out.
- Layers: `ground` (under everyone), `body` (y-sorted round its anchor: a back half behind the body, a
  front half over it) and `top` (over actors and spells). Followers track their body and end with it.
- Culling: one-shots far off screen are not started; nothing off the view is drawn. A cap on effects at
  once (24 desktop, 12 phone; halved with reduced motion) drops the oldest least important first
  (ambience 0 < flourishes 1 < statuses 2 < hits 3). Hit sparks have a budget of their own (8, 4 on
  phones; crits 6, punches 4): a new one replaces the oldest whose flash is over, so a brawl's sparks
  never push statuses off the bodies.
- Each effect is painted at its own frame rate (pixelfx's 30 fps): between its frames its picture
  and its light are reused, moved with its body, so a 60 fps game paints each effect half as often. Past
  1.6 ms of painting in one rendered frame, effects show their last picture a frame (loops up to three)
  before repainting, so a screen full of effects costs about what a quiet fight does.
- Time: stepped with the world's `wdt`, so effects freeze while paused, in a hit-stop or a cutscene, and
  slow with `timeScale`.
- Reduced motion: ambience is skipped; every effect plays its `calm` mode, 15% smaller, with half the glow
  and no white pixels (drawn in its ramp's brightest color instead).

**Where it plays** (`src/render/pixel_fx_play.js`, the catalog in `pixel_fx_catalog.js`):
- Every blow: the hit spark at the target's chest, thrown along the blow, in the weave's palette for a
  weave (replaces combat's streaks and the weave's debris spray, a pinch of the essence's own stuff stays);
  a critical hit gets the starburst (replaces the old star). The Strike's fist: a real punch (a white-hot
  blob, ink wedges, a ring of dust, clods over the floor), the fist's only spark.
- Statuses on the body (the old tint and overlay step aside while it plays): burning, chilled, poisoned,
  drained (cursed), stunned/staggered, dazzled (dazed); the fallen bleed; berserk's rage on the player.
  The game's own ice crust stays for "frozen".
- Bind: hands come up out of a pool round the bound one and hold on (replaces the spray). A blow on a
  ward: a spark glancing off the shell (the dome is the ward's own).
- Heals: Lyra's spell (green), potions (red), the sickroom; revival with help (gold; combat plays it, its
  old shimmer steps aside; getting up alone stays without fanfare); the kept flame lit (a gold burst).
- Foe deaths: a cartoon poof that hides the fading body (replaces the old puff). Bosses arrive in a puff;
  beaten for good, the soul lifts out of them.
- Pickups, a chest's haul, level-ups (combat plays it; the old gold spray steps aside), stat points
  spent: a burst of light with hoops at a slant and twinkles over the ground, sized to the moment.
- Ambience: a few butterflies over the meadows by day, bats at dusk (`pixel_fx_critters.js`, tiny,
  seen from above with a shadow); fireflies and leaves stay `weather.js`'s. None indoors, in rain or under
  reduced motion.

Tests: `tests/pixel_fx.test.mjs`. Shots: `scripts/pixelfx_shots.mjs` (in the game, three screen sizes,
day and night), `scripts/pixelfx_preview.mjs` (contact sheets from above, aimed several ways).

## 31. Combat in a world with walls (round 13, the author: "Why am I able to hit through walls?"; "The spells do not have a stun"; "Skill magic like strike isn't able to destroy a tree"; "the dummies, I'm unable to hit them with the sword … no damage is shown … they do not gain XP"; "the church, the lights inside of it shows from the roof")

### 31.1 Walls stop blows (`src/world/walls.js`)
One rule for every attack, the tiles projectiles already stopped at: `map.blocksProjectile`
(walls, rock, palisades, ruin walls, the edge) and closed doors.
- `wallTile(game, tx, ty)`, `wallAt(game, x, y)`, `wallBetween(game, x0, y0, x1, y1)` (a grid
  walk of every tile the segment crosses; the two end tiles do not count, so a body hugging a
  wall stays in reach) and `canReach(game, a, b)` (feet lifted 3 px, where actors collide).
- The sword and every creature's bite (`combat.melee`) skip anyone `canReach` says no to,
  and so does the finishing blow on someone fallen (§29.1 `murder.finishTarget`).
- So does the use button (`core/interact.js` `candidates`): a bed, a chest or a shopkeeper
  on the far side of a house wall is out of reach from the street (replayed: "Garrick's bed"
  was offered through the general store's east wall). Doors, windows and signs on a wall
  stand on its tile, an end tile, so they are used as before.
- Weaves (`bodies.js` `reaches(rt, x, y, a)`, `magic.blocked(...)`): rings, bursts, cones, the
  strike's fist (thrown into a wall it lands on the wall's face) and wave, beams (from the point
  of the ray nearest the target), weave walls, trails, rune triggers, reactions' spread, and
  every `nearestFoe` (aim assist, homing, chain, ricochet, familiars) need a clear line. A
  missile that meets a wall ends at the wall's face (its burst stays this side); a lobbed bomb
  meets a wall and bursts there; rain never falls past a wall from where it was called.

### 31.2 Hits stun (`combat._hitStun`, statuses in `src/magic/status.js`)
Every blow stuns for a moment, through the Weave's status system (so every controller obeys
it: statuses hold `lockTime` and stop `moveIntent` each step, and break a held weave).
- **Flinch** (`flinch`: 0.3 s, no step and no swing; `stack: 'keep'`, so a second blow neither
  stacks nor renews it; 0.22 s immunity after): every sword hit and every weave hit that is not
  a tick. A flurry stuns a foe for about half the time and leaves windows to act.
- **Reel** (`reeling`: 0.6 s, stars at the head, 1.1 s immunity): heavy blows (the sword's
  finisher, the strike's fist, a bomb, a rune, a heavy missile) and any weave charged past half.
  Tagged apart from Stone's `staggered`, so a blow sets off no earth reactions.
- **Pin** (`pinned`: a 0.15 walk while the ray is on them, renewed by each beam tick, gone a
  third of a second after it leaves): `magic.hit` marks a beam tick `pin`.
- Bosses and super-armored foes shrug off the flinch, reel for a third as long (control `cc`)
  and are pinned half as hard. The player keeps the short hurt pose they always had; without the
  Weave (tests of combat alone) everyone does.
- `stack: 'keep'` and `quiet` (no flourish, no `status_applied`) are new status fields.

### 31.3 Strike and heavy spells break things (`src/world/breakables.js`, `src/world/broken.js`)
The player's blows land on the world's props as well as its people (everyone else's pass over
props as before). Missiles and rays stop at the first intact prop they meet; bursts, rings,
cones, the strike's fist and wave reach every prop in them (never through a wall); the sword's
arc reaches the props in front of it.
- **Damage builds up** on a prop (`o._dmg`, not saved): a blow counts its damage, x4 for a
  strike's fist, x3.5 for a heavy blow (a bomb, a rune, a heavy missile), up to x2 more when
  charged; a sword blow counts half and never fells a tree or cracks a rock (the work swing is
  the axe and the pick). Small blows chip: the prop jolts a pixel, chips of its material fly, a
  knock. Toughness (`BREAKABLE`): tree 56 (one Strike, a bomb, ~6 bolts, ~2.5 s of beam), rock
  48, cart 40, woodpile 24, sign 20, fence 18, barrel 16, crate 14, bush 10, hay 10, sack 8,
  berry bush 8, pot 6.
- **Trees** fall away from the blow (`Tree.fell(dir, onLand)`, drawn turning about its foot
  for `FALL_SECONDS`), leave their stump, and when they land a dust cloud and their logs (the
  2–3 wood a chop gives) lie along the trunk to pick up. They grow back in a day, as a chopped
  tree does. **Rocks** crack to rubble and give their stones; **berry bushes** are torn and
  give their berries; both come back as they always did.
- **Other props** (fences, barrels, crates, carts, signs, woodpiles, pots, sacks, hay, bushes)
  burst into debris (`state.broken`: drawn as planks, shards, cloth or straw in the prop's own
  colors; not solid, not interactable, no baked shadow), a pixelfx dust cloud in the material's
  colors (`playDust`), chips, sometimes a little wood. A broken fence's neighbours lose the rail
  to it. Mended two days on (`MEND`; bushes grow back in one) unless someone stands there.
  Until then nobody leans on it or works at it: a villager's `near` and work props skip the
  rubble (`npc.js` `spotFor`), and a broken seat seats nobody (`rest.js` `seatFor`).
- **Never**: buildings (tiles), doors, windows, beds, chests, lamps, hearths, wells, anything a
  story needs (`story: true` on the object; `unbreakable` likewise; every sign of a boss on its
  trail, `trailBoss`: the toll board, the scored trunks, §32.4), the notice board and signs
  hung on buildings. **Chests** (round 13 x 14a): nothing that holds an inventory ever breaks.
  A blow (Strike, a heavy weave, the sword) neither opens nor spills a chest; a locked one
  keeps its ways in (§32.6: its key, its keeper, or Force the lock at the chest with the use
  button, theft if it is someone's), and its contents are never lost or doubled. A prop you can look at (the Holloways' barrels, the thatching reed, Pip's
  treasure crate) breaks like any other: its rubble has nothing to read, and its words come
  back with it when it is mended (the author: "a strike and a heavy spell should break trees
  and also anything else").
- Saved: `state.broken`/`mendAt` and the trees' and rocks' own `depleted`/`regrowAt` ride on each
  object's state; a load redraws the fence rails. Bus: `prop_broken {object, by, kind}`,
  `object_mended {object}`.

### 31.4 Training dummies (`breakables.js` `trainOn`)
The dummy by the guardhouse takes the sword and every weave: each blow shows its number (crits
too, a beam's ticks pooled), a hit spark in the blow's colors, and the dummy rocks on its post.
Each blow that lands teaches `TRAIN_XP` (1; a tick a quarter), shown as a rising "+N xp", up to
`TRAIN_DAY` (40) a day per dummy; then it says it has taught all it can today. It never breaks.
With nothing alive to fight, the sword turns toward a dummy or prop just in front
(`Player._findProp`). Bus: `dummy_hit {object, by, amount, crit}`.

### 31.5 Interior lights stay inside (`src/render/lighting.js` `roofSeen`)
A light whose source stands under a roof (a building's tiles above its two front-wall rows)
shows only as much as that roof lets through: `1 - roof._alpha`. Outside, the roof is opaque
and the altar, candles, hearths and forges inside light nothing, so they never glow on the
roof; walk in, the roof fades (`map.drawRoofs`) and they shine. Windows, lamps and signs on
the front wall are outside the roof and glow to the street at night. It applies to every light
the renderer collects (objects, actors, flashes), in all three passes (the light map, the
night lift and the glow). The witnesses' light (`witness.js` `lightAt`) keeps the same rule
for every light, objects and entities alike: a lantern carried or the ember-ring (§27) under a
roof lights its room, never the street outside the wall (round 13 x 14a).

**Round 13 x 14a seams.** The wider world (§32) keeps every rule of this section at its
negative tiles: Brindlecombe's walls and doors, the ruins, palisades and thickets stop a blow,
an eye and the use button (`wallTile` reads `map.blocksProjectile`, which the wilds' tiles
fill like the vale's); Brindlecombe's houses have roofs, so whatever lights under them stays
inside; the square's rain barrels and crates, the graveyard and lookout fences, the east
fork's cart and barrels break and mend as the vale's do and save by their positional ids
(`barrel@-312,43`); a beam pins a wolf in the deep wood as anywhere, and a boss on its trail
resists as Varek does. Tests: `tests/v11_seams.test.mjs`; in the browser
`node scripts/seams_play.mjs`.

Tests: `tests/walls.test.mjs`, `tests/hit_stun.test.mjs`, `tests/breakables.test.mjs`,
`tests/interior_lights.test.mjs`. In the browser: `node scripts/world_check.mjs` (each scene by
touch sideways and upright, and on a desktop; screenshots in `screenshots/world`).

---

## 32. The wider world, on foot (round 14: "the map is really small. If you are going to add other places that I can go, do not make it teleportation. Make me walk there and expand the map into the lore.")

### 32.1 One map around the vale

The world is one tile map from x −384 to 255 and y −288 to 119 (`WORLD_X0`, `WORLD_Y0`,
`WORLD_W`, `WORLD_H` in `src/core/constants.js`; edges on 16-tile chunk lines). The vale
keeps tiles 0..159 × 0..119, so every save, mission point and object id keeps its meaning
(ids are positional). `TileMap` and `ObjectManager` take an origin (`x0`, `y0`) and index
through `map.idx(tx, ty)`; queries take world tiles, which go negative west and north of
the vale. The camera, renderer, pathfinder, ground painter and spawner all respect it.

`worldgen.js` lays out the vale as before (its builder never writes outside 0..159 ×
0..119) and then calls `buildWilds` (`src/world/wilds.js`), which borrows the vale
builder's tools with world bounds. The layout is data (`src/world/wilds_layout.js`):
roads (`ROADS`), the walkable land as corridors along them and open places (`LAND`, with
half-widths), regions (`regionAt`: heath, grey, wood, pine, foothill, snow, east), waters
(pools, rivers, fords) and the named places (`P`). Inside a corridor is open country,
then five tiles of thick walkable wood, then the wilds' wall (thicket, or cliff on the
mountain), roughened so no edge runs straight. The vale's ring of edge trees is left out
only at three seams (`SEAMS`), where the roads walk on.

### 32.2 What is out there, and how far

- **West**, the King's Road across the western heath: the dead waystone (Lyra's, a mile
  out), Bracken Ford, the Long Mile (a lit waystone: rest and safety), the west fork,
  the Saltmere road to the Greyford (the bridge is gone), and up the Brindle lane,
  **Brindlecombe**: open doors, a cold wardstone with new candle stubs, a chapel, five
  houses to loot, graves, the grey over it all.
- **North**, the old Crown path from the heart of Whisperwood: the deep Whisperwood, a
  Lanternwright marker stone, a mountain stream, the treeline camp (Hess's lean-to, a
  wardrunner's cache), the switchbacks of the Hollowcrown, and the **Crown Ring**: nine
  stones in snow round the green circle where the stranger lay.
- **East**, round the far shore of Mirror Lake: the **Cinderwick fork** with its burning
  waystone and a carter's cart, the bandits' lookout above it, the oil track buried under
  a slide, the Owlsend track closed by fallen pines.

Walking from the square at full pace (paths measured by `tests/wilds.test.mjs`): the
dead waystone ~30 s, the Long Mile ~55 s, Brindlecombe ~90 s, the Greyford ~100 s, the
treeline camp ~50 s, the Crown Ring ~80 s (more in snow), the Cinderwick fork ~40 s. Snow
(0.8), fords (0.7), scree (0.88) and heather (0.94) slow your feet (`tiles.js` `speed`);
the vale walks as it always did.

### 32.3 The map

`src/ui/world_map.js`, opened with **N** or Menu → Map: the world one pixel a tile, what
you have not walked under a dark wash (`game.travel` keeps 8×8-tile fog cells as a
bitset: the save grows by about a kilobyte), names of places you reached, lit waystones,
you, Lyra, home, the mission objective, the ember-ring where your coins lie (any entity
of type `ember_ring`, or any entity with `mapMark()`), and the bosses you have heard of.
Drag, pinch, wheel or +/− to zoom, "Me" to come back; the tools sit over the chart so a
phone held sideways keeps its height. With a mouse the panel is drawn at Interface size
(§14, CSS `zoom`): a click and a drag divide screen pixels by the canvas's own zoom
(`canvasZoom`), so the mark named is the one under the mouse and the chart follows it one for
one. Home on the map is the bed the Home pointer leads to (`homeBed`). Menu → Map has the
flag icon (round 13 x 14a).

### 32.4 Bosses you can find

`src/world/boss_trails.js`. Every boss has a trail: the villagers who would know tell
you when asked "Heard anything out there?" (and then talk of the roads beyond); the
notice board warns of the quarry pools, the camp and the ruins from the first morning;
signs stand on the way (slime smears up the quarry trail, claw-scored trunks to Greyjaw's
den, the toll board on the shore trail, the humming dock end, bones at the ruins gate)
and looking at one marks its boss; seeing an arena marks it; a boss mission marks its
boss; after the first lesson the village talks of the Mother of Slimes (the first boss,
pointed to on day one). Marked bosses show on the map with their names. Events:
`boss_heard { id, from }`, `place_reached { id, name, first }`.

### 32.5 Living with a bigger world

- **Spawns**: a wilds zone (`near` in tiles) fills only while you are near and lets its
  creatures go when you are far; nothing turned spawns in a lit waystone's light
  (`map.safeSpots`).
- **Objects**: those within 40 tiles of you update every step; the rest take turns (an
  eighth a step, with eight steps' time), so far timers still run.
- **Paths**: journeys out in the wilds route along the roads (`map.roadGraph`, short
  searches per leg); the vale's own paths keep their single search.
- **Weather**: the grey over Brindlecombe is one flat wash; snow falls on the
  Hollowcrown (`weather.localFog`, `weather.localSnow`, set by `travel.js`).
- **Knowledge**: every place has a location entry, a lore page (the Book's "The Roads
  Beyond" chapter) and road talk; `travelPlugin.promptContext` tells Claude where you are.

### 32.6 Chests you can open

`src/world/containers.js`. Chests have locks: a key (`keyId`), a keeper (`keeper`), an
owner. No key: the keeper may open it (Lyra opens her own trunk for someone she trusts),
or you may force the lock. Forcing or emptying someone's chest is theft (`crime`, kind
`theft`, `owner`). Rowan gives the watch's footlocker key for Hold the Line. Loot
(bandits', Brindlecombe's) is free. Forcing is done at the chest (the use button, then
Force the lock): a Strike or any other blow never opens, breaks or spills a chest (§31.3).

### 32.7 Footsteps by ground

`src/world/footsteps.js`: `surfaceAt` (grass, dirt, stone, wood, water, sand, snow) picks
`step_<surface>` (code-made in `src/ui/sfx.js`). Your own steps are the loudest; anyone
walking near you treads softer and fades with distance; splashes in fords, puffs in snow.

### 32.8 Harder missions

Mission foes scale with your level (`toughen` in `src/missions/system.js`: one more every
three levels, more health and bite, a scarred leader for a pack of three or more). Boss
missions now ask you to follow the trail, clear the brood or the pack, or take the
lookout first; Hold the Line is a line to hold; The Count sends you to Brindlecombe.

### 32.9 A shop that buys what you carry (the author: "a shop to sell my stuff")

Gale's Goods buys anything worth anything: Garrick's own prices for what he names
(`shop.buys`), and a share of its worth for any other item of value (not keys, quest items
or coin). The shop's sign says so. Round 14b's full shop (four merchants by taste, one
stock, haggling, stolen goods) is §36.2.

### 32.10 People grow older (the author: "make people age as well")

`src/world/calendar.js` (`game.calendar`, saved by `calendarPlugin`). Hearthvale's year
turns every 12 days. Everyone has a birthday (a day of the year fixed by their name); on
it they turn a year older: the profile's `age` (which every prompt and line reads) and
Lyra's soul age change, a `birthday { id, name, age, day }` event goes out and the village
hears of it. Children grow up with the rest; who is a child is decided by age (round 14b,
§34.2: `isMinor`, under 16), so a child stops being one on the birthday that makes them 16. Round 14b (§36.3): seasons, the pace setting, Petra's
reckoning of the stranger's age, looks that follow the years, and death of old age. Sleep (§19.8) jumps the clock at
most one morning ahead: the calendar is turned in `game.sleep` before its save, so a
birthday is never skipped by a reload and never had twice.


---

Round 14b (§33–§37): talking, freedom, the society, and the dark spell. The base (branch
`r14b/base`) laid the shared ground below; six workstreams build on it, each in its own
files: **talk** (§33.3), **party** (§34), **blood** (§35), **society** (§36), **soul** (§37)
and **polish** (the note after §37). Every caller of another workstream's API feature-detects
it (`game.party?.weighJoin?.(e)`), so any workstream may land first.

## 33. Round 14b's shared ground, and Talk (the author: "even if somebody really hates me, make me able to talk to them")

### 33.1 Plugin slots and sheets (the base)

- **Plugin slots** (`src/core/plugins/{talk,party,blood,society,soul,polish}.js`, each
  `export default []`, owned by its workstream alone). `game.js` registers every slot once,
  in one loop (`for (const p of [...TALK, ...PARTY, ...BLOOD, ...SOCIETY, ...SOUL, ...POLISH])`),
  so nobody edits `game.js` to add a plugin. An entry is either:
  - a **plugin object** (the `src/ai/plugins/registry.js` shape: `id`, `install(ctx)`,
    `update`, `onEvent`, `promptContext`, `serialize`/`deserialize`, `actions`, `intents`),
    registered when the Game is built and installed with the world (before village life,
    murder and party exist: reach those lazily or on `game_start`). It may carry
    **`order`** (a number, default 0, lower restores first); party honours it in game.js
    deserialize (blood's body re-lay before Lyra's companion state); or
  - an **installer function** `(game) => void`, run at the end of `game.buildWorld`, after
    village life, murder and party exist and before a save is applied (`game.slotInstallers`).
  The base's own plugins register beside the built-ins: missions, travel, the calendar and
  `provenance` (§35.4).
- **Sheets** (`src/styles/{talk,party,blood,society,soul,polish}.css`, a header comment each).
  `scripts/build.mjs` inlines `src/styles.css` and then every `src/styles/*.css` in sorted
  order; `index.html` links them in the same order; `tests/styles.test.mjs` and
  `tests/css_whole.test.mjs` check each sheet on its own (no conflict markers, braces balance,
  no spliced declarations). Each workstream adds CSS only to its own sheet; only party edits
  `src/styles.css` (the `.lyra-*` rename).

### 33.2 The rules every workstream keeps

- **Lyra the person, the companion role.** `game.companion` and `game.lyra` (a getter, and
  `lyraOf(game)` in `src/core/people.js` for code that may run on a test game) mean **Lyra
  herself**: her mind, her trunk, her parents. The ROLE is `game.party.holder` (§34.1), which
  may be Lyra, any adult, or nobody. Never read the holder where Lyra's own mind is meant, and
  never `game.companion` where "whoever walks with you" is meant. The rename of
  `game.companion` across the code waits until after this round.
- **Children** (`isMinor`, §34.2: under 16 by age) are never killable, never companions,
  never the Unkindling's target, never hurt when a village is emptied. Intimate acts need
  `canBeIntimate` (18 and over). Every workstream that touches killing tests it.
- **Sound and sight (Version 11).** Every new sound goes through the one rule for ears,
  `hears(game, listener, x, y, loudness)` → `'clear' | 'muffled' | null` (`src/ai/hearing.js`,
  §29.4: walls and shut doors muffle; hearing tells **what and where, never who**). Every
  new witness goes through the one rule for eyes (`src/ai/sight.js` over `murder/witness.js`
  `look`/`witnessesOf`, with `src/world/walls.js`, §29.2). Villagers act only on what they
  themselves know (`npc.knowsWanted`: saw it, came and saw, the victim told them, told face to
  face, or the bell); news travels only by meeting. Never a bare distance check for who hears
  or who knows. A person held silent (§37.2) makes loudness 0 through `voiceOf`.
- **Silence is shown, never a lock** (§23.3, decision D8). Every message is delivered and
  remembered first (memory, conversation, the said-today log, the Claude prompt or local
  rules); then they decide; silence is a visible act row ("Elda hears you. She says nothing
  and turns away."). Hate, fear, terror, grief, a murder, being hunted and cut ties never lock
  the chat; only death, being unconscious or downed, being out of earshot (`hears`) or a
  cutscene playing keep words from someone.
- No `alert()` or `confirm()`; every panel closable with a ✕ of at least 44 px; Lyra lives for
  herself and her lines never threaten.

### 33.3 Talk (workstream talk): the contracts

- **Talking to whoever is in front of you**: `ui.talkToNearest()` (nearest person in front,
  facing first, within earshot by `hears`) and `ui.talkTo(id)`. Party's HUD buttons call
  `this.ui.talkToNearest?.() ?? this.ui.chat.open(true)`. A tap or click on a person never
  opens talk (decision D3).
- **What a reply carries** (SAY_SCHEMA): `action` (null | turn_away | walk_off | flee | glare |
  cry | shove_past) and `act` (null | join | leave | follow | wait | fight | hold_back).
  `afterPlayerSays` calls `game.party?.onVillagerAct?.(e, act, reply)`.
- **The invite is decided before it is worded** (as `commitments.detect`/`decide`, §23.2).
  `playerSays` detects an invite (come with me, travel with me, join me) before any Claude
  call and asks `game.party?.weighJoin?.(e)`. Online the verdict goes into the task ("You
  have decided: you will come / you will not, because {why}. Say it your way."); offline its
  `.line` is spoken. On accept, `afterPlayerSays` calls `party.take(e)`. An `act: 'join'` with
  no detected invite is re-weighed by `weighJoin`: Claude never says yes while the game says
  no. `act: 'leave'` goes to `party.release`.
- **Personas**: a profile may carry `mind: { rules, brief(game, said), local(game, said) }`;
  `playerSays` uses it in place of VILLAGER_RULES and `sayBrief` (society's tempter).
- **Cited memories**: `chat.attachMemories` emits `memories_shared { who: 'lyra', ids }`;
  party keeps them in `mind.shared`.
- **Lines other workstreams add**, feature-detected in talk's prompts: `game.calendar?.
  briefLine?.(id)` (§36.3), `game.reputation?.titles?.({ knownTo })` (§36.1),
  `game.unkindle?.briefLine?.(id)` (§37.1).
- **Say aloud** (sound): who hears is `heardFrom(game, P.x, P.y, LOUD.talk, people)` by the
  hearing rule. Those who hear it `'clear'` get the words (memory, said-today, one batched
  Claude call for them all); `'muffled'` is a voice over there (what and where, never the
  words or who). A cry of "HELP!" said aloud is a cry for help: `cryLoudness(severity)` through
  `hears()`, telling what and where, and who only to those who see the caller.
- ***Acts* between asterisks**: `parseActs`; the game decides consent and outcome, the minds
  only word the reaction (D6). Intimate verbs need `canBeIntimate(game, target)` or the game
  refuses ("You don't."). A text act never kills and deals at most 1–3 hp. An assault act goes
  through `combat.assault(attacker, target, kind, { amount })` (a wrapper on `_recordCrime`):
  known only to those who see it (the sight rule, `murder.screenCrime`), its cry heard by the
  hearing rule.
- **Cut ties and the parting scene**: words still reach a gone Lyra within 16 tiles (D9) and
  she answers as she feels; her leaving is a scene with her reasons and a letter; the village
  learns of it from those who heard her words clearly (`hears`, `LOUD.talk`) and then by
  meeting, never all at once.

### 33.4 Every place a talk could lock, and why it no longer does (talk, T-A0)

The audit of round 14b (grep of `src/` for lock wording, and every `return` in the chat's
send, sendToVillager, selectTarget and applyTarget). Each row is fixed, a spoken line (their
own words, allowed), or a physical reason. `tests/talk_gates.test.mjs` keeps it so: a matrix
of feelings (terror, dread, wanted near, mourning, wronged, cold, opinion 0, asleep, a
"Butcher" title, Lyra left and gone) in which the words are always kept and an answer or a
shown act always comes; only dead, downed, far, walls and a cutscene give a reason; and a
static grep for "won't talk to you", "will not talk", "beyond a word", "can't talk",
"catch that", `refusesTalk`, `'refuses'`.

| Where | Was | Now |
|---|---|---|
| `chat_target.whyNotHeard` | 'gone', 'downed', 'far', 'walls' (distance and roof) | only `dead`, `downed` (or unconscious), `cutscene`, `far`, `walls`; words carry by the hearing rule (`hears`) as well as the roof; asleep is never a reason; `notHeardText` words each as a body, never a feeling |
| `village.playerSays`, terror and dread | an early return with a local fear line: no Claude, no `afterPlayerSays` | `heard()` first (their talk row, and a note when asleep), then their own mind: Claude is told "you are terrified of them…" / "never at ease"; a warm line in a frightened mouth falls back to their fear; offline the fear banks; `afterPlayerSays` always; the flee is their `action` |
| `TalkSession` | "X doesn't seem to catch that." / "seems lost in thought" | silence is an answer (`ok`, `silent`, the act as the line); a fault or a timeout reads "X hears you, and takes a moment over it without a word" / "…is a long while finding an answer"; the words were already theirs |
| `chat.send` (Lyra) | "Lyra didn't catch that. Try again in a moment." | the brain records the words before anything else; a fault shows her hearing it (`silenceAct` kind 'heard') |
| chat toasts and `partingLine` | "is hurt and can't talk" | "is down and can't hear you now", "is dead", "can't hear you through the walls" |
| `brain._unreachable` | 'gone' for a removed Lyra | `dead` ("Lyra is dead."), `far`, `downed`, `cutscene`; gone hears within 16 tiles (D9); `reflect` keeps no diary for a dead Lyra |
| `autonomy_consent` gone veto | above the talk pass-through: promises and notes to a gone Lyra were refused | words between them land first; requests still get her `no_gone` |
| `npc_dialogue.mainOptions` afraid | `[Back away]` only | `Say something` (focuses the free field), `Give yourself up` (wanted, at the watch; or hunted, anywhere), `Back away` |
| `npc.interact` on someone fleeing you | a shout, nothing else | `ui.talkTo(id)`: the chat opens to them; they answer in fear as they run, until out of earshot |
| `murder/lines.js` mournGreet | "I can't talk. Not today." | "{who}… we buried {him} {when}. What is it?" |
| `village_view.canTalkTo` | unused feature test | deleted |
| `voices.js` Hobb | "Didn't catch that. This is my bad ear." | "Say it into this ear, the other one's gone to wax." |
| Spoken refusals (allowed) | Mira wronged: "I can't… I can't talk to you."; Pip grave; `left_reply` | their own words, an answer, not a lock |
| `ui.js` STATE_LINES gone, `lyra_view` blurb, `hud.js` farewell, `mind_panel` | "has cut you out of her life" | descriptions, not locks (party owns the HUD and the People view; the words say she still hears you) |

Silence (§23.3) now also has **actions**: a reply may carry `action` (turn_away, walk_off,
flee, glare, cry, shove_past); an empty say with an action is a silence shown as that action
("Bram hears you. He says nothing, and walks off without looking back."), done in the world
(`village.doAction`); with words, the action is a narration row after them. An empty say
with no action is no answer: their own words instead. A silence is remembered by them ("you
said … to me, and I gave you nothing back").

**Lyra cut off (gone), the way back** (T-A2, item 4): she hears within 16 tiles (she keeps
12 away, so walking up is always heard); `gone_reply` (mostly silence, "No.", "Go.", "I
heard you.") offline; her gone bark is never a reply (only when the player has not spoken
in 10 s). An apology is weighed harder than a companion's (`_goneApology`: never believed
within two days of the last blow); a believed apology, two days, and a good deed she sees
(any positive ledger entry since) move gone to **left** (`goneWayBack`, the one step
`setCompanionship` allows out of gone: `flags.lyra_gone` is cleared and her words stay in
`flags.lyra_farewell`); from there the old amends path applies. She never rejoins on her
own while gone. `answerGone(game)` (her_state.js) gives her spoken no for asks made while
she is gone or left. An old save's `lyra_gone.farewell` moves to `lyra_farewell`.

### 33.5 What talk built (round 14b)

- **Say aloud** (item 2; `village.sayAloud`, the chat's "Everyone (n)" chip, `'@near'`):
  who hears is the hearing rule (`heardFrom` at 120 px in the open, a shout, all capitals
  or "!", twice that; a wall leaves a voice, never the words, and a shout heard that way
  leaves them uneasy of a place). Everyone who heard it clearly keeps it (their talk, a
  note "you said aloud…", an opinion move for a threat, an insult or a kindness; a threat
  said aloud is a `threat` rumour with every hearer a witness). At most four answer, chosen
  named first, then the strongest feeling, then the nearest, in ONE batched quick call
  (`buildAloudTask`, `ALOUD_SCHEMA`, `coerceAloud`; at most every 6 s and 60 a session), else
  their own rules; the one named answers as if spoken to (commitments apply). Lyra hears
  through her mind and answers once, through her brain, when named or your companion.
  "HELP!" shouted is `call_for_help { victim: 'player', attacker: null }` through
  `npc.onCallForHelp` and `hears()`: what and where, never who.
- ***Acts*** (item 3; `src/ai/social/acts.js` `parseActs`, `acts_effects.js` `decideActs`):
  kinds affection, intimate, respect, offence, assault, threat, neutral. The game decides
  consent (villagers by opinion, familiarity and fear; Lyra by trust and affinity, and only
  together) and outcome before any mind words it; the brief says "They do (an act, not
  words): *…*. It was unwelcome to you."; Lyra's context has "# {player} does". Intimate acts
  need `canBeIntimate` (18+): below it, "You don't." and no mind is asked. Every assault by
  hand goes through `combat.assault(attacker, target, kind, { amount, knockback })`: 1–3 hp,
  never the last of it (no one is ever downed by a text act, a child least of all), the
  'damage' event so they react as hit (their own onHurt), and the crime known only to those
  who see it (`murder.screenCrime`), blood's rules either way. A lethal verb is only a threat. Rumours by sight:
  `unwelcome`, `spat_at`, `slapped_lyra`, `threat`. Lyra's deeds: `affection_welcome`,
  `kissed_unwelcome`, `touched_unwelcome`, `slapped_lyra`, `shoved_lyra`, `bowed`. The chat
  shows an italic act row and an act bubble over the player (bubbles kind `'act'`).
- **Cut ties, for anyone** (item 4): `village.noteCutTies(id, why)` (party calls it when a
  villager companion leaves in anger) makes them cold (standing) and says so in their brief;
  they still hear every word. `amend`: an apology, then help or a gift, mends it. Saved as
  `village.cutTies`.
- **The parting scene and the letter** (item 5; `src/ai/mind/autonomy_parting.js`): on a
  move to left or gone she walks up (follow close, then stays), says 2–4 lines with her
  real reasons (her ledger, her reason; Claude's within 15 s, else hers), the chat opens to
  her for 25 s (`ui.talkTo('lyra')`), the player's answer reaches her mind and changes her
  last line, never the decision; then `lyra_letter` (a `'letter'` item, unsellable; text in
  `flags.lyra_letter`) into the bag, and she goes home. Afraid, in a fight, downed, or the
  player far off: the letter on the Wayhouse table. Walking 8 tiles off ends it; a save
  mid-scene ends it on load; a killed Lyra has neither. The bag's "Read" opens
  `letter_view.js` (a paper panel, the panel's 48 px close). It runs only in a world with
  the player's screen (`ui.talkTo`) or with `settings.partingScene` (tests).
- **Lyra's voice follows sight and hearing**: a place line only when the player is there
  with her and hears her clearly (`barks.withYouAt`); quiet while the player lies downed
  unless she sees them or is coming for them; a sound she hears and did not see (a cry, a
  blow) turns her and she says so (`heard_sound`, `heard_muffled`), never who.
- **Lines from other workstreams**, feature-detected in talk's prompts: the calendar's and
  the Unkindling's `briefLine(id)` (villagers and Lyra), `reputation.titles({ knownTo })`
  (villagers), and `npc.uneasy` (blood saves it): "Earlier today you heard a scream from
  the Ember Kettle, and never saw what it was… You do not know who.", and in their own
  offline answer to "how are you?".

## 34. Party and People (workstream party; the author: "I want to be able to take anyone as my companion")

### 34.1 The companion role (`src/core/party.js`, `game.party`)

Built in `game.buildWorld` after the people exist (`installParty`), saved as `party` and
restored last in `game.deserialize`.

- **Now (the base):** `holder` (the entity holding the role, or null when you walk alone),
  `holderId`, `isCompanion(e)` (entity or id), `canHold(e)` (a person, Lyra or one of the
  eighteen; alive, present, not absent or dead, an adult by `isMinor`, not the player),
  `set(id, why, by)` (the one place the holder changes), `serialize()` → `{ v, holderId }`,
  `deserialize(d)` (no block: an old save; the holder is Lyra while her companionship is
  together or wary, else nobody; a saved holder who can no longer hold it is dropped).
- **Bus:** out `companion_changed { from, to, why, by }` (ids or null). In:
  `companionship_changed` (Lyra together or wary takes the role when it is free; apart, left
  or gone releases it when she holds it; she never takes it from someone else),
  `villager_killed` and `villager_died` (the holder's death releases it, why `'died'`).
- **Built by party** (contract, feature-detected by everyone):
  - `invite(e, { text, by })` → `{ decision, why, line, terms, narration, ok }`: their own
    mind decides. Lyra by her own will (`mind.evaluateRequest({ action: 'rejoin' })`, then
    `autonomy.rejoin({ asked: true })`); her yes takes the role even from someone else, who
    goes home (`'replaced'`). A villager by `weighJoin` (§34.4); on a yes, `take`.
  - `take(e, { why, by, terms })`: one at a time; the previous holder is released with
    `'replaced'` (Lyra goes her own way: "You walk with Bram now. I have my own day to get
    on with."). A villager gets a `CompanionDuty` (§34.4) and is marked away in village life
    (`markAway(id, { reason: 'companion' })`, renewed each day) so no missing chain starts.
  - `release(why, { line, by, quiet })`: whys `dismissed`, `left`, `gone`, `died`, `night`,
    `hurt`, `fear`, `opinion`, `grievance`, `work`, `replaced`. A villager says their line
    and their day resumes; `gone` also calls `village.noteCutTies(id)` (talk, feature-detected).
  - `ask(cmdId)` → `{ ok, refused, verdict: { decision, message }, message }` (alone:
    `{ ok: false, alone: true }`, nothing shown): Lyra through her own `evaluateRequest` and
    the action registry; a villager through `duty.request(cmd)`.
  - `weighJoin(e)`; `canTake(e)` (the role is free or theirs); `onVillagerAct(e, act, reply)`
    (talk's `act`: `join` is weighed again by the game, never taken on a mind's word;
    `leave` releases; `follow`, `wait`, `fight`, `hold_back` are orders to the holder).
  - `guardLyra()`: Lyra's own plans may bring her back (`setCompanionship` to together or
    wary); while someone else holds the role her return is turned aside (she says so if
    near, once a day). Talk's own `party.canTake(lyra)` check in autonomy makes it redundant.
  - `bouncing(state)`: the UI asks it so a turned-aside return is never announced.
  - `update(dt)` (stepped by the party slot plugin, `src/core/plugins/party.js`): the
    catch-up watchdog. Lyra holding the role, following, more than 40 tiles behind and out
    of sight for 4 s blinks to a spot near you out of view (`steering.teleportNear`).
  - Listens also to `crime` (a villager companion who SEES you assault or kill someone, by
    the witnesses list or `canSee`, walks off: `fear`, or `gone` for a killing or a blow on
    them), `damage` (struck by you on purpose: `gone`; a weave's splash, `accident` or
    `magic` without `deliberate`, is not a blow), `memories_shared` (§34.5), `new_day`.
  - Saves `{ v: 2, holderId, duty }` (the duty: directive, stance, terms, since, missed work).
  - Helpers: `holderOf(game)` (the holder; a game without a party reads Lyra while she walks
    with you), `isParty(game, e)` (the player or the holder), `isLyra(game, e)`,
    `lyraDead(game)` (`flags.lyra_dead`, `murder.isDead('lyra')`).
- **NPC hooks** (`src/entities/npc.js`, the only lines party needs there):
  - `npc.duty` (null, or `{ step(npc, dt, tick) }`): `think()` runs
    `if (this.duty?.step?.(this, dt, tick) !== undefined) return;` before the day's routine
    and social life (after flee, fight and help, and after standing still for a talk).
  - `startFight(target, { anchor, leash })`: `fightAnchor` (a point or an entity that moves,
    like the player a companion guards) and `fightLeash` (px) replace the post and
    `GUARD_LEASH` for that fight; `fightStep` measures the leash from `fightAnchor ?? post`.
  - `endFight()` returns to mode `'duty'` when `this.duty` is set, else `'routine'`; mode
    `'duty'` makes village life and pair talk leave them be, as any busy mode does.

### 34.2 Who is a minor (`src/core/people.js`, decision D1)

- `ageOf(game, who)`: the calendar's age (`game.calendar.ageOf`), else the profile's, else
  Lyra's base age; null for the stranger, who does not know their own. (An actor's own `age`
  field is seconds alive, for its animations, and is never read.)
- `stageOfAge(age)` / `lifeStage(game, who)`: `'child'` under 13, `'teen'` 13–15, `'adult'`
  16–64, `'elder'` 65–79, `'frail'` 80 and over.
- `isMinor(game, who)`: age under `MINOR_UNDER` (16). Build `'child'` or `'teen'` counts only
  while the age is unknown, so Tansy (build `'teen'`) is a minor at 15 and an adult at 16.
  `npc.isChild` (helpRole's "children run", `nearestChild`) calls it; murder's `canKill` and
  the finishing blow's refusal read it; party's `canHold` reads it.
- `isAdult(game, who)`: a person who is not a minor (the player is one).
- `canBeIntimate(game, who)`: `INTIMATE_FROM` (18) and over: Tansy at 16 and 17 and Tilly at
  17 are adults to every system but this one.
- Each cut-off is one constant: raise `MINOR_UNDER` to 18 and every rule follows.

### 34.3 What party shows (`src/ui/companion_view.js`, `hud.js`, `bubbles.js`, `world_map.js`)

- `companionView(game)` (pure) → null when you walk alone, else `{ id, name, portraitKey,
  expr, hp, maxHp, downed, status, stance, isLyra, cs, standing, rel, barTitle, jobs,
  askLabel, cardTitle }`. Lyra's standing is her companionship (with trust and fear);
  a villager's is their opinion of you (`opinionLevel`).
- The HUD card (`.companion-card`, `.companion-wrap`; the old `.lyra-*` classes and the
  fold are gone) is drawn from it; alone there is no card, no Ask bar and no orders, and
  the UI root carries `no-companion` (else `has-companion`). The corner Talk (T) button
  (`.hud-talk`) stays in every state and calls talk's `ui.talkToNearest`.
- A tap on the card, or Tab, opens People at the holder (`ui.openPeople(id)`; `openMind`
  stays as an alias for scripts).
- The off-screen edge badge, the map's dot (`kind: 'companion'`), the bubbles pinned to the
  edge, the bodies bubbles keep clear of, the toasts' avoidance and the fallen-carry home
  follow the holder. Nothing of Lyra's is pinned on screen while she is not with you: her
  level-up, down and revived toasts, overheard talk and unprompted lines show only while
  she walks with you or is near (16 tiles), and her morning diary page only if she slept
  under your roof (it is then marked read: `flags.diary_read`).
- Sleep heals the player, Lyra and the holder; the holder wakes beside you only if within
  20 tiles when you lay down; Lyra far away slept at home (`comeHome`).
- The clock reads `game.calendar?.dateLabel?.()` (§36.3) when society brings it.

### 34.4 A villager companion (`src/entities/npc_companion.js`, `npc_companion_lines.js`)

- `weighJoin(game, npc)` (the game decides before any mind words it): refused for a child
  (the game says so: "Pip is a child. Children do not go on the road with you."), the dead,
  the downed or absent, terror or dread (`murder.fearOf`), a player they know is wanted, a
  fresh grievance (weight 6+) or a wrong today, the night (their own schedule says sleep,
  or 21:00–6:00), a post kept (Rowan and Wys on watch, Elda with Pip), the frail (80+),
  under half health. Else a score: opinion + familiarity × 0.15, −10 for an elder, +5 for
  the trained, −15 during their working hours: 65+ accept, 50+ accept on terms ("home by
  dark"), else refuse (busy, or not with you).
- `CompanionDuty` (`npc.duty`, through the F5 hook): follows a little behind you (running
  to keep up: speed ×1.6–2.3), waits where asked, steps out of the sword arc
  (`swordArcPush`), catches up from 30+ tiles behind out of sight, and fights what threatens
  you both (`foe()`: hostile to you or them, within 150 px, seen through the sight rule;
  `defend` only what comes at you): provoked by the foe and `startFight(foe, { anchor:
  player, leash: 200 })`. Their own `perceive` is wrapped while on duty so a fighter holds
  their ground beside you instead of fleeing (`attachDuty` / `detachDuty`).
- `fightAbility`: 2 trained (the watch, the huntress, profile combat), 1 able (an adult),
  0 none (elder, frail, the chapel's keeper). "Fight" from a non-trained, non-strong person
  becomes "Defend"; anyone with no ability stays out of it.
- `wantsToLeave()` every two seconds: bedtime (or dark, on terms), under 30% health after a
  fight, opinion under 35, a fresh grievance or a wrong today, fear, being known wanted, six
  game hours of missed work. They say a line in their own voice and `release(why)`.
- Missions ask whoever walks with you along (`askCompanion`: saved as `s.companion { id,
  answer, why }`; an old save's `s.lyra` migrates); a boss fight asks them
  (`companionJoins`); the bag's right column gives them gifts (`npc.receiveGift`); the
  Oath price binds to them; the holder answers first when you fall and carries you home.
- A villager companion is in the party and stays lawful (`combat.isParty` vs
  `combat.isLyra`): hitting them is assault.

### 34.5 People (`src/ui/people_panel.js`, `src/ui/people_view.js`)

- Tab, M, a card tap or Menu → People. A list (left on a computer, a strip on a phone): You,
  Lyra (first while she matters most, a memorial once dead), the holder, then everyone met
  (familiarity, facts told, talk, a gift, or having walked with you), with ages.
- You: how Hearthvale sees you (`villageFeeling`), what people say (`rumorsAboutPlayer`),
  each villager's view, titles (`reputation.titles`, feature-detected).
- Lyra: you and her (ledger, promises), how she sees you, her life (timeline, goals she said
  aloud), what she shared, "N things she keeps to herself", her knowledge as told (her
  theories and rumours counted), secrets she told at the bond they need, diary pages read
  (closed dates for the rest), who she is (read only). Dead: her last page, her last words,
  how the village speaks of her.
- A villager: what they told you, talk, a grievance, their last gift; how they see you;
  their life (role, age, what they are doing now; never the profile's private description).
- Actions: Talk (`ui.talkTo`, feature-detected), Invite to travel / Ask her to travel with
  you again (`party.invite`), Go home, thank you (`party.release('dismissed')`), and the Ask
  row (orders; Jobs while it is Lyra).
- `privacyOf(entry, ctx)` (private by default): a memory shows when it is about you and in
  `mind.shared` (saved) or cited in the chat; a secret once told and at its `revealAtBond`;
  knowledge you or someone told her, or lore; a diary page once read. Left or gone, nothing
  new becomes shared (talk's `memories_shared { who, ids }` is ignored); what was stays.
- No soul editing: the Mind panel's Soul and Data tabs, the import and `ui.resetMind` are
  gone; Settings → Minds → Back up saves her mind as a file.

### 34.6 A dead Lyra (the person side of item 7; the killing itself is blood's, V-7)

When `game.murder` records her death (`murder.dead.lyra`) or `flags.lyra_dead` is set:
`Companion.update` runs nothing of hers (no mind, plans, behavior or light) and never
knocks her out or gets her up; her body is knelt by and lifted through murder's body rules;
the role is released (`'died'`); scenes that need her (`lyraState` → reason `'dead'`),
her lessons (`lyraWith` → `'gone'`), her eyes (`missions/lyra.js sees`), boss fights and
the carry home skip her; the Maren quest's state is the game's (keyed by game), so the
story goes on; People shows her memorial.

## 35. Violence (workstream blood; the author: "the people should fight me, not just let me kill their whole village")

As built by blood (round 14b). Every new sound or witness rule goes through the one rule for
eyes (`src/ai/sight.js`, `murder/witness.js`) and ears (`src/ai/hearing.js`); nobody acts on
a bare distance. Children (`isMinor`, under 16) are never killable, never hurt.

### 35.1 The record of a death, and who can die (`src/murder/murder.js`)

- `kill(v, killer = player, opts)` or `kill(v, opts)` (opts with `killer` to name another).
  `opts.cause` (default `'killed'`), `opts.silent` and `opts.unmarked` (§37.2), `opts.by` (an
  id when no killer entity is given). Returns the record, or null.
- **Who can die.** `UNKILLABLE` is gone. `isPerson(e)`: a villager, Lyra herself
  (`lyraOf`), or whoever holds the companion role. `canKill(v)`: a person, not dead, **not a
  minor** (`isMinor`, by age; Tansy at 16 can). `finishTarget` takes any downed person (a
  downed lock-on target first); `onAttackPress` refuses only a child ("No. Not a child.").
  Lyra has her own first warning (`flags.finisherWarnedLyra`); the last stand's burning
  minute (`prices.burning()`) asks nothing.
- **A dead Lyra.** Every `murder/lyra.js` entry does nothing (`lyra(m)` is null): she never
  learns, grieves or is asked about her own death; scenes, grief's line-up, the hearing and
  telling loops skip her. `layBody` holds a killed non-villager still (instance `update`,
  `interact`, no light) unless the companion has `isKilled()` of its own (party's
  companion.js). `village_life.markGone` takes PEOPLE (an unseen killing of Lyra makes her
  missing). `HEIRS.lyra` (the far lamps to Hobb), `KEEPSAKES.lyra` (her trunk to Wenna:
  containers.js `ownerOf`), `STAND_INS.lyra = []`: her own missions close (status
  `'closed'`, never offered again; missions/system.js) and a talk step to her passes.
  `murder.deserialize` runs after the companion's and re-lays her body (game.js order).
- **She can be caught.** Running from the stranger Lyra goes 1.45 x 80 = 116 px/s against the
  stranger's 76; after 6 s she is winded to 0.55 of her pace (about 64 px/s) until she has
  stopped running 10 s (`murder.tireFlight`). Villagers already run slower (40 x 1.75 = 70).
- The record (`murder.dead[id]`) carries `by`, `cause`, `provoked`, `silent`, `unmarked`,
  `natural` (the base), and from blood: `loot { rolled, items }`, `searched`, `finisher`,
  `newsWaits`, `caseWaits`, `mournedBy`, `lyraSawCarry`. Old saves read safely.
- **Events:** `villager_killed { id, entity, killer, by, cause, provoked, silent, unmarked,
  witnesses, place, x, y }` (Lyra and companions included); `villager_died { id, entity,
  cause, place, x, y }` (§36.3). Grief, the funeral and heirs listen to both; the tempter,
  reputation and the hunt only to `villager_killed`.
- **Telling, by meeting (round 14b).** An unseen victim still standing tells whoever they
  meet face to face (`hearsWords`) and walks to the watch on their own feet; one of the watch
  knows what happened to them. Lyra seeing the stranger carry a body knows; her news goes by
  meeting and the alarm rises when she reaches the watch. A body found is known to its finder
  at once, to everyone else as the `found_dead` news reaches them (`knowsDead(id, who)`,
  `Grief.mournAs`), or with the bell and the chapel within the hour (`knownDead` waits on
  `rec.newsWaits`). The watch's case opens when the news reaches the watch (`rec.caseWaits`),
  with the finder's clues. Found by the watch itself, or a killing seen and told: everyone's
  at once.

### 35.2 Finishers (`src/murder/finishers.js`)

- `registerFinisher({ id, label, score(build, game), duration, draw(ctx, sx, sy, k, scene),
  mark(ctx, sx, sy) })`; `unregisterFinisher`, `finishers()`, `chooseFinisher(game)` (the
  highest score). Built in: `sword`, `magic`, `hybrid`. A future bow or class registers its
  own.
- `buildOf(game) -> { melee, magic, ranged, kind, why }` blends the attribute points (might
  vs weave and focus x0.6; free points too), the blade in hand, the recent blows by kind
  (the player's melee vs weave hits in the last 120 s, `trackDamage`) and the slotted
  weaves; `hybrid` when the two are within 0.16.
- `murder.strike` kills at the strike (witnesses and the record unchanged) and
  `playFinisher` lays the scene over the next second (an fx entity: hit-stop, a slowed beat
  on a real-time clock, shake; a slash across the neck, a bolt in the slotted weave's
  palette, or both; a tap or key skips). `rec.finisher` (saved) leaves a stylised mark on
  the ground where they fell (`drawFinisherMark`: a clean line and dark drops, or a scorch).
- Settings → Game → Your journey → **Finishers**: `full` (default) | `brief` | `off` (the
  same outcome, no scene); reduce motion plays `brief`. Bus: `finisher { id, victim, mode }`.

### 35.3 The village fights back; a known killer is hunted

- **Defenders** (`src/entities/defenders.js`): the watch, Hess, and Bram, Tobias, Garrick,
  Sabeth and Tilly (`DEFENDER_COMBAT`: stats and a tool, read in place of a missing
  `profile.combat`; no profile is edited), aged 17–65 (`lifeStage` adult), on their feet,
  not terrified (`murder.fearOf`). `isDefender(game, npc)`, `defendsAgainst(kind)` (assault,
  knockout, murder; never theft or an accident), `DEFENDER_LINES`.
- A defender fights only someone they KNOW did it: one who SAW the blow (`npc.onCrime`,
  `sawBlow`), or knows who from a call (`helpRole`'s attacker is only ever a known one: seen,
  come and seen, or told). A cry only heard brings them to `look`. Combat lets them strike
  through Hess's 'provoked' rule (`npc.provoke(target, { known })`), let go when the fight
  ends. A child near is shielded first. Defenders take on a beast that comes into the
  village (danger <= 1).
- **Per knower.** `combat.knowsCrime(knower, actor)`: a guard is hostile to the stranger only
  if he knows (`npc.knowsWanted`); `player.crime` is the watch's record, not everyone's
  knowledge. survival: the 1400 px reach, the arrest role, the cell and a patrol's arrest
  only for a guard who knows (`rescue.knowsWantedFallen`); the rest come to help as for
  anyone. `lethal_attack` counts as crime news.
- A carer who only heard holds back (at the door, or ~120 px off) while the unknown culprit
  is still at the victim's side, until they see who (`npc.heardRisk`, `holdBack`).
- **The hunt** (`src/murder/hunt.js`, `murder.hunt`, saved): on the bell a posse (the watch,
  Hess, the defenders who saw it) goes to where the killer was LAST SEEN: a posse member's
  own eyes at once; anyone else who knows and sees the stranger tells the posse when they
  meet (64 px, `hearsWords`). `murder.entryFor` sends each posse member to the spot (spread
  out); `murder.chaseOf(npc, target)` lifts their leash (`CHASE { far: 420, leash: 2400 }`);
  losing the stranger marks a new last-seen (`lostSight`). Two hours with nothing new: cold;
  no longer wanted: over. "Run" from an arrest starts the chase. Bus: `hunt_started`,
  `hunt_over`.

### 35.4 Loot, theft if seen, and where goods came from

- **Search.** A body offers "Search or lift" (`src/ui/body_view.js`: two 48 px buttons, a
  44 px close; headless games lift). `murder.search(v, actor)` opens the chest panel on their
  pockets (`src/murder/loot.js`); what they carried (`src/murder/carry_data.js`: a purse,
  tools, Rowan's footlocker key, Lyra's trunk key) is rolled once at the death into their own
  inventory, so the save keeps it. Lyra's is "Lyra's pack".
- **Theft only if seen** (D10; `containers.js theftIfSeen`): every hand in a body's pockets
  or an owned chest writes the provenance ledger (`how: 'body' | 'chest' | 'forced'`,
  `seenBy`); seen, one `crime { kind: 'theft', witnesses, dead, owner }` per object per day
  (`npc.onTheft`: an opinion drop, a shout, no fight, not a blow of the day; village
  `'stole'` or `'robbed_the_dead'`; Lyra's `stole` deed only if she is among the witnesses
  or sees the stranger), and from a body a `'searched'` clue (`WEIGHTS.searched` 0.45).
  Unseen: no crime, no toast; the owner who next sees their chest is uneasy
  (`ownersNotice`, `goods_missing`). Forcing a lock is a sound (`hears`: uneasy, never who).
- **A blow on a locked chest** (`game.chestBlow`, from magic.hitProps and the player's
  swing): a Strike's fist or a heavy weave forces the hasp (D10), the panel not opened; a
  lighter blow says "Iron-bound…". Contents never move.
- **`game.provenance`** (the base): `add`, `take` (first in, first out), `of`, `qtyOf`,
  `all`, `settle`; the shop calls `take()` before removing an item.

### 35.5 Lock-on (`src/core/lock_on.js`, `game.lock`)

- `{ target, set, clear, cycle(dir), valid, pickAt, nearestInFront, press(at), aimTarget(range),
  update }`. Valid: alive or downed, not hidden, within 240 px of the player, reachable
  (`canReach`), never whoever walks with you by default. It re-targets the next foe when the
  lock dies, and lets go on distance or a wall. Bus `lock_changed`.
- Controls: the middle button locks what is under the cursor (an empty spot lets go; no
  autoscroll), G the nearest in front (or lets go), R3 on a pad; while locked the wheel
  cycles the lock (`input.takeLockWheel`; Q and R still pick slots). Phone: hold the sword
  button still 0.45 s to lock or let go; swipe across it to cycle. Never a tap on the world.
- `weaving.aimFor` aims at the lock for every source; the sword turns to it in reach;
  `murder.finishTarget` prefers a downed lock; soul reads `game.lock.target`. The reticle is
  `src/render/lock_layer.js` (an fx entity).
- A quick weave tap on a phone auto-aims only `TAP_REACH` (110 px).

### 35.6 Nothing hits through walls (V-16)

- `walls.BLOCKS_BLOW` (rubble): a hand-to-hand blow stops at it, an arrow flies over
  (`canReach(..., { melee: true })`, `blowTile`; `wallBetween` takes a tile test). Small
  actors measure from their own height.
- Boss blows and hazards (`bosses/kit.strike`) land only with no wall between the shape's
  origin and the target. Creatures notice prey only with a sight line, keep a lost target
  4 s, and wind up only for a blow that can land.
- Stagger: a boss reels from a heavy blow, then is proof against another for 3.5 s; a
  mission leader ("Scarred") takes 0.55 of every stun (`ccResist`).

### 35.7 The village under the stranger's hand (`src/world/occupation.js`, `game.occupation`)

- `burned(locId)`, `claimed(locId)`, `emptied()`, `canClaim`, `claim`, `shopClosed(npcId)`,
  `fireAt(x, y, r, blow)`, `placeName(id, name)` ("Hearthvale (yours)"), `entryFor`. Saved as
  plugin `occupation`.
- A fire weave's blow on a store or home sets it alight: smoke for a day, a blackened roof
  (`ScorchLayer`), its shop closed (`murder.refusesTrade`). Arson is a crime only if seen
  (`'arson'`, no fight; `'burned_store'` news).
- A house whose household is dead or gone can be claimed: its chests and beds are the
  player's. When nobody grown is left, the bell rings once, every house is claimed and
  `village_emptied` fires (society's villain ending reads `emptied()`).
- Children: a child who sees a stranger they know to be a killer hides at home; once every
  grown person of their household is dead, kin (Tansy) or a carter from Saltmere (Pip) takes
  them the next morning (`markGone` cause `'taken_away'`), unharmed; their missions pass on.
  Bus: `child_hides`, `child_taken_away`, `store_burned`, `house_claimed`.

## 36. Society (workstream society; the author: "should they forgive me?")

Everything registers through `src/core/plugins/society.js` (plugin objects: reputation,
villain, aging, trade; installers: `installVillainHooks`, `installAging`). Nobody's profile is
edited: tastes, wares, stock and the tempter live in their own tables.

### 36.0 Days (`src/core/time.js`)

A night slept through midnight is a new day like any other: `clock.skipTo(hour)` and
`clock.skipDays(n)` go through one `advance(hours)` that emits `new_day { day, skipped: true }`
once per midnight crossed, before `time_skip`. So the village's morning, the quests, Lyra's
day plan, the murder's morning (Hess walks the woods), old age and the shops' restock all
hear a slept night exactly once (round 14b leftover).

### 36.1 Reputation (`src/society/reputation.js`, `game.reputation`)

Derived from the truth, never a stored score: the murder records, the rumours' `heardBy`,
the provenance ledger's `seenBy`, the trial's caught lies, and a short list of oaths.
- `counts({ knownTo })` → `{ killedKnown, killedSecret, proven, unkindledKnown, thefts, lies,
  oathsBroken, oathsKept, rescues }` as that person knows them (no `knownTo`: as anyone does).
- `knows(rec, id)` / `knowsDeed(m, rec, id)`: they saw it (`knowsKiller`), the bell rang, the
  Moot's verdict (its heads, and whoever heard its `convicted` news), Lyra's own belief, or
  soul's `rec.knownBy` for a linked Unkindling.
- `knownAsKilling(m, rec)`: a blade's death is a killing once seen or found; an Unkindling
  (`cause 'unkindled'`) only once seen (`known 'witnessed'`), linked (`rec.linked` /
  `rec.knownKilling`, bus `killing_known { id }`) or proven. Deaths nobody did
  (`rec.natural`) are never deeds.
- `titles({ knownTo })` → `[{ id, title, bad, why }]`: the Butcher of Hearthvale (3 known
  killings), a killer (1–2), the Unkindler, Oathbreaker (a broken oath: betraying the
  tempter), a thief (2 seen), a liar (2 caught), the one who carries the fallen (3 rescues,
  no killings), the one who kept the ward (the hero ending) — and any title they have HEARD
  (rumour kinds `title_*`, by meeting).
- `look()` (on deaths, verdicts, rumours, each morning): a title newly known goes out as a
  rumour with `heardBy` = those who know (`title_known { id, title, knownBy }`); the first day
  anyone knew it starts the road's clock: `roadWord()` after `ROAD_DELAY_DAYS` (2), and a
  carter's line at the road's places (`enter_location` at the fork, the Long Mile…;
  `road_word`).
- `briefLine(id)` (≤ 220 chars) for prompts; talk's `sayBrief` reads `titles({ knownTo })`.
- Listens to `villager_killed`, never `villager_died`. Saved: oaths, heroes, when titles were
  first known; the rest is rebuilt on load.

### 36.2 The shop (`src/world/trade.js`, `game.trade`; UI `src/ui/dialog.js` renderShop)

- Merchants: Garrick (anything of worth, ~0.45), Bram (weapons, armour, boots, ore, ~0.55),
  Mira (potions, herbs, moonpetal, slime, bat wing, 0.6), Elda (food, 0.5); `TASTES`, and a
  profile's own `shop.buys` overrides. `shopOf(game, npc)` merges a profile's wares with
  `WARES` (Bram's gear, Mira's potions and tonics, Elda's soups). `isMerchant(npc)` gives the
  Trade option (Mira has it now).
- `priceFor(game, npc, id, 'buy'|'sell', { haggled, markup })`: by mood (opinion and
  familiarity bands), a won haggle (a tenth), a blood price. Never a loop: anyone pays at most
  `SELL_CAP` of the least anyone asks after every discount.
- One stock: `DAILY` per merchant; where the village's errand stock names the item it is the
  same stock (`villageLife.stock`); sold out is said; the morning restocks and tops up purses
  (`PURSE`); selling adds to their stock and is paid from their purse.
- `haggle(npc)`: once a day each, by nature (Garrick welcomes it, Wenna never) and mood.
- Stolen goods: a sale reads `game.provenance` (`stolenOf`), and `take()`s the entries it
  sells before the pack loses the item (§35.4). The owner, kin or someone who cares, or a
  unique piece may know it (seeded): refused in their words, colder, a `stole` rumour
  (`theft_recognized`). A fond Garrick, or Garrick after the Butcher, fences what is not his
  at half ("I don't ask").
- One graded refusal (`stance(game, npc)` → `{ refuse, markup, fence, why }`, read by
  `npc_dialogue.refusesTrade` and `grief.refusesTrade`): kin of someone they know you killed
  never; anyone who knows, not for `FRESH_DAYS` (3); then a blood price (+25% a death, at most
  double); after the Butcher, nobody but Garrick's fence; a case they believe of about one of
  theirs. A refusal is always their line; Trade stays on the list.
- UI: n left / sold out, price against worth, buy steppers, Sell 1 / All, the stolen mark, a
  mood and discount badge, Haggle, an inline "Sure?" before selling gear, a rare piece or your
  last one, a tap on a row for what it is; 44 px on touch; one pane at a time on a phone.

### 36.3 Ages and deaths nobody did (`src/world/calendar.js`, `src/world/aging.js`, `src/art/age_look.js`)

- `murder.die(v, { cause })` (the base, D13): the record and body of a killing with none of
  its consequences. Found (`found()`), a death of age is owned by aging's `onFound` handler:
  the finder's own words ("In his sleep"), no case, no blade, no Moot (`grief.onFound` skips
  the Moot for `rec.natural`), "Died of old age" on the epitaph, Lyra's grief without
  suspicion (her prompt says "died of old age", never murdered).
- The calendar: day 1 early autumn; four seasons, each early, mid and late (`season()`,
  `seasonName()`); `dateLabel()` ("Day 1, early autumn, year 1"); `briefLine(id)` (the date,
  their age, a birthday; ≤ 200 chars). Settings → Game → The years: `yearDays` (12 / 24 / 48 /
  96; ages kept by anchors when it changes; an old save reads at twelve) and `oldAge`.
  Lyra's birthday is at midsummer; the dead stop aging and get no birthday; the stranger's
  age is Petra's reckoning (25 at a new game; the waking morning is the birthday). A
  birthday: `birthday { id, name, age, day, adult? }`, a toast ("Tansy is sixteen today:
  grown, to the village."), a `birthday` rumour for kin, a word of their own when you are
  near, Lyra's notice (`mind.noticeText`).
- `isMinor` follows the calendar, so a child grows into an adult the game treats as one;
  `text.isChild`, Lyra's `protectWorth`, the errands' `CHILDREN` and `toneFor` go by age.
- Looks: `ageLook(appearance, age, baseAge)`: greying from 50, grey 65, silver 80; lines from
  50; stooped 75, bent 85; child → teen at 13 → grown at 16. Painted lazily once per stage
  (`id~key`), `spriteKey` set on load and birthdays; portraits follow it. A grown child gets a
  grown body (health and pace).
- Old age (`game.aging`): a seeded daily chance from 77 (`chanceOf`), never in the first year,
  never a child, never Hobb, Wenna or Petra while the Maren thread is open, off by setting;
  a failing day abed at home (Mira and Aveline visit: `entryFor`), death in the small hours
  through `murder.die(v, { cause: 'age' })`, found by kin in the morning.

### 36.4 The villain path (`src/story/villain.js`, `src/story/tempter_data.js`)

- The tempter, Isembard (LORE §9.11): a visitor NPC (`profile.visitor`, a `Tempter` subclass
  with his own dialogue), at night outside the ruins gate once a boss has fallen or a killing
  of the stranger's is known; a cold blue lamp; gone at dawn. Talkable like anyone: the chat
  reaches him (`village.playerSays` is wrapped for him alone), his words are heard and kept
  first; online his persona rules (`TEMPTER_RULES`, `profile.mind`), offline his lines.
- The offer: the village's grown souls (never the children) for gravelight. The game decides
  a pact or a refusal before anyone words it (dialogue options, or clear words in the chat:
  "teach me after", "teach me now", "no").
- `seal('before'|'after')` → `pact_sealed { gifts, pact }`: before gives the dark essence,
  bloodprice and the Unkindling now (a debt); after lends the Unkindling now and pays the rest
  (`pact_paid`: every weave) when the village is empty. `hasPact()`: sealed and not broken.
  Soul listens and calls `game.unkindle.learn()` (§37.4).
- Kills: from `villager_killed` with `by 'player'` only, counted once known as killings
  (`knownAsKilling`); never `villager_died`. `livingAdults()` (adults, alive, not fled, and a
  blow could take them); `emptied()` reads `game.occupation.emptied()` when blood provides it.
- Endings: **villain** (pact kept, village empty): the last flame goes out, the ward lets go,
  the ruins wake; a scene, his wages; the life closes (`save.closeLife`, an end page in the
  memorial's shape; `life_closed { ending: 'villain' }`). **Hero**: warn the watch, Reeve,
  chapel or huntress (`murder:villain:warn`, carried by the murder's dialog hook), fight him
  (struck, he turns: `FACTION.UNDEAD`, leash at the gate); downed, he comes apart into blue
  light: the ward holds, the save continues, a hero's name; beating him after a pact, or
  warning after it, is Oathbreaker (`reputation.oath('tempter')`, `pact_broken`).
- Saved in `plugins.villain`; he is never saved as a villager (`serialize()` → null).
- **The dark path you can leave** (the round 14b follow-up, plan §13c): end the pact any
  time, go back at a higher price, his single asks one at a time, what is done stays done.
  Contracts in §38.7.

### 36.5 The trial (`src/murder/defence.js`, `src/murder/jury.js`, `grief.trial`; UI `murder_view.js`)

- The watch's account, then `MurderView.defence({ about, chair })` → `{ text, quick }`: a
  field (with dictation) and three chips (I did it / It was not me / Say nothing); closing it
  is a silent plea; the tap that skipped the scene cannot send it.
- `parseDefence(text)` → claims (alibi with its place, not there, never met, self-defence,
  accident, blame, character, mercy, confess, deny); `checkClaim(m, rec, claim)` →
  `{ lie, knownBy, proof }` from the record (who, where, when, provoked), the sightings near
  the hour, the eyes that saw it, the one blamed; an unknown place is unverifiable; what the
  watch said aloud to the Moot is known to the whole room (`checkDefence(…, { room, spokenBy })`).
- `jurorsOf` (the chair and the living heads, at most 7); `jurorBrief` holds only that juror's
  knowledge (what they saw, what the watch said to the room, the rumours they heard, their
  opinion and familiarity, their care for the dead, fear, the day's unease (`npc.uneasy`),
  the other deaths they know of, and the claims they can catch); `deliberate`: one quick
  Claude call each, in parallel, one 25 s budget (`BUDGET_MS`), the rest `localJuror`
  (deterministic); a `caught` id counts only if that juror is in `knownBy`.
- "The Moot weighs it" (`MurderView.weighing`): each face fills in with a word and a vote;
  "Hear the verdict". `tally`: guilty + mercy against not proven, the chair breaks a tie;
  mercy outnumbering guilty is a lighter sentence (one day outside, a quarter of the coin, the
  flame left lit). Each juror's reason is spoken (`verdictFor`), then the chair's verdict.
- Caught lies: `lie_caught` in the record's answers, a `lied_about` rumour. The result
  `{ guilty, mercy, plea, suspicion, votes, claims, tally }` reaches `applyVerdict`, Lyra's
  `onVerdict` and `moot_verdict { …, mercy, votes }`.
- Saved: `case.trial { defence, quick, claims, votes, t, day, state, sentence }` and
  `trialPending.deliberating`: a reload re-runs it without the defence asked again and without
  Claude asked again (the votes already in are kept; the rest weigh it alone).
- `opts.plea` alone is the old arithmetic (`judge`), for the absent and for tests.

## 37. Soul (workstream soul; the author: "I kill him with no sound, with nothing… even if they find him, they will be shocked how is he dead")

The Unkindling (working name kept; LORE §2, "The Unkindling — the cold that takes"): a dark
spell from the tempter's pact that puts out a person's flame from the inside. Built by soul as
below: S20-1 to S20-5 (§37.1–§37.8) and §13b, S20-6 (replaced) to S20-11 (§37.9–§37.12: the
taken flame, the signs, the faithful who read them, known dark magic as dangerous and not
evil, beasts and bandits as prey).

### 37.1 `game.unkindle` (`src/magic/unkindle.js`, registered through `src/core/plugins/soul.js`)

- **The slot** (`src/core/plugins/soul.js`): `unkindlePlugin` (a plugin object: `game.unkindle`,
  stepped with the world, saved as `plugins.unkindle`) and `installSoul` (an installer run at
  the end of `buildWorld`: the village side, and in a browser the look and the controls).
  `installUnkindle(game, { fx, view })` does the same on any game (tests).
- **State, saved:** `learned`, `learnedFrom` (`'pact'`), `learnedDay`, `tally` (every unkindled
  death: the truth), `deaths [{ id, t, day, hour, seen }]`, `attempts [{ id, t, day, outcome:
  'broken' | 'resisted', knows, why }]`, `mark` (§37.9), `lastTakenDay`, and the village's
  `village` block (§37.8). A hold in progress is never saved: whoever was held is free on load.
  An old save has none of it: nothing learned.
- **The gift:** `learn(from)`, called on `pact_sealed` when its `gifts` include `'unkindle'` (or
  carry no list). Never otherwise. `available()`: learned, or a magic trial (Settings → Practice
  → "Try all magic", `magic.trial`), which lends it for **training dummies only**.
- **Targets:** `kindOf(e)` → `'person'` (a villager, Lyra, whoever walks with you, any actor with
  a profile), `'tempter'`, `'boss'`, `'undead'`, `'bandit'`, `'beast'` (a hostile one),
  `'harmless'` (a hen, the cat, a deer), `'dummy'`, `'self'`. `check(e)` → null or `{ reason,
  line }`: `'child'` (`isMinor`: "No. Not a child."), `'self'`, `'wall'` (`walls.canReach`),
  `'far'` (`REACH` 26 px: close enough to touch; a boss at its edge), `'undead'` ("Nothing in
  there to take."; bats too, what gravelight wears), `'harmless'` ("Not a harmless thing."),
  `'dead'`, `'carried'`, `'dummy'` (a trial lends it for straw only). Hostile beasts and bandits
  may be taken: §37.12. `targetInReach()` → `{ target, refusal }`: `game.lock.target`
  first (blood, feature-detected), else the nearest in front within touch.
- **Strength:** `powerOf(P)` (max health, attack, the weave in you (`spellPower`), `resist`, level,
  times how whole you are now, times coldfire's `powerMul()`: a fuller bar takes stronger souls) against `strengthOf(e)` (max health, attack, defence, the watch or
  the hunt, a will in their traits, Lyra's weave and level; times how whole they are; asleep
  ×0.6, downed ×0.45). `verdict(e)` → `{ ratio, kind, dur, peak, struggle }`:
  `'easy'` (ratio < 1: a 2.5–3.5 s pull), `'close'` (1–1.6: 3.5–5 s, harder jerks that win back
  ground, more time to be broken), `'resists'` (≥ 1.6, and anyone `murder.canKill` refuses: it
  comes only so far, then snaps back). A boss (strength at least 90) or the tempter (600) is
  taken only when the ratio is ≤ 1/1.6 (a hand much stronger: a long 'close' pull); otherwise
  it shrugs the spell off at once, never held (no stun to chain). A pull's length is divided
  by coldfire's `1 + 0.4·bar` (§37.9). At level 1 Elda and Bram are
  easy, Wys awake is close (asleep, easy), Hess and Rowan break free; a hurt stranger is weaker.
- **The hold:** `begin(target?)` → `{ ok, reason, line }`, `release(why)`, `channel` (read by the
  look and the controls), `update(dt)`. While it lasts the target is **held and silent**:
  `silence(game, e, 0.6)` refreshed each frame (loudness 0), `lockTime`/`rootTime`, no wind-up,
  no walking, facing you (a creature's own controller is set aside while it is held and given
  back after: `HELD`). **The hold plants you** (the author: "I can move while I'm doing spells;
  it should stop me"): from the first pull to the last of it drawn into your hand you stand
  (`lockTime` refreshed, your velocity zeroed), turned to the one you hold with a raised hand
  (`P.castPose`); the stick or the keys do not walk you. A roll (the dodge) is the way out: it
  breaks the hold and you roll. (§14, the general rule for every weave, is the follow-up
  stage's; this is the Unkindling's channel under it, `castMoveMul 0` in effect.) Phases:
  `pull` (k 0→1, with jerks), `tear` (0.22 s), `sag` (0.55 s: the kill falls at its end),
  `drawn` (0.45 s), or `snap` (0.4 s, a stronger soul) or `slip` (0.32 s, a broken hold). It
  breaks on: a hit on you (`damage` with an amount), you down, the target gone, carried or moved
  more than `HOLD_SLIP` (10 px) from where it was held, out of reach (`REACH + 14`), a wall
  between, a panel opened, a roll, or letting go. A hold broken past `KNOW_AT` (15% of the pull) is felt:
  they know what you tried (§37.8); before it, only a chill. `COOLDOWN` 2.5 s between holds.
- **The death:** at the end of the sag, `murder.kill(v, player, { cause: 'unkindled', silent:
  true, unmarked: true })` (no record, no death: the soul goes back). `tally++`, `deaths`, and
  coldfire takes it (§37.9). Prey (a beast, a bandit) dies as creatures die (`combat.kill`: the
  `death` event, drops and XP; its clash and spray muted; `unmarked`), `prey[kind]++`; a boss
  taken plays out its own defeat (`beginDefeat`). Neither is a murder record (§37.12).
- **Bus out:** `unkindle_learned`, `unkindle_begin { id, kind }`, `unkindle_end { id, outcome:
  'taken' | 'resisted' | 'broken' }`, `unkindled { id, seen }`, `unkindle_resisted { id, kind }`
  (the tempter's amusement: society may listen), `unkindle_attempt { id, knows, outcome }`,
  `killing_known { id, cause, knownBy }` (§37.8); `unkindled` carries `kind` ('person',
  'beast', 'bandit', 'boss'); coldfire emits `coldfire { bar, add, kind, mark }`; the faithful
  `dark_asking { id, phase }`, `dark_verdict { id, verdict, caught, killer }`, `dark_rite`.
- **`briefLine(id)`** (≤ 220 chars, feature-detected by talk's `sayBrief` and Lyra's prompt):
  only what that person saw, was told or can feel: during the faithful's asking, her knowledge
  and the verdict only (§37.11); else what they know of the deaths (§37.8), then the signs as
  they perceived them or the dark magic they know of (§37.11).

### 37.2 Silent and unmarked killings (the base)

- `murder.kill(v, { cause: 'unkindled', silent: true, unmarked: true })`.
- **silent**: no cry, no call for help, no scream. `src/ai/hearing.js` `silence(game, e,
  seconds)` (Infinity: for good), `isSilenced(game, e)`, `voiceOf(game, e, loud)` (0 while
  silenced). The channel holds its target with `silence(game, v, seconds)`; a silent killing
  silences the victim for good (restored from the save). Routed through it: `npc.say` (no word
  at all), `npc.callForHelp` (no `call_for_help` event), the accident yelp, `npc.onCrime`'s
  blow (loudness 0), `npc.onCallForHelp` (a cry at loudness 0), `npc.knowsWho` (no words from
  the hurt), the village's alarm for Lyra (`installVillageHooks`), `murder.heardBy` (false),
  and a fallen victim's telling (`murder.tick`). So `hears()` hears nothing a tile away
  behind nothing. **Eyes are not ears**: a witness who SEES it is a witness (the sight rule;
  `witnessesOf` is untouched), and `seenMurder` runs for them as for any killing seen (their
  own scream carries by the hearing rule). Lyra's own cry lives in talk's autonomy
  (`autonomy.callForHelp`): talk adds the same guard there (return at once while
  `isSilenced(game, lyra)`); until then her cry is already heard by nobody, since every
  listener hears it at `voiceOf(…)` 0.
- **unmarked**: no blood, smear or wound on the body. The record keeps it (saved); `layBody`
  sets `v.unmarked`; the blood trail under the body is cleared (`trail.clearNear`);
  `drawBody` draws a dried stain under a marked killing and none under an unmarked one or a
  natural death; any finisher or wound art reads `rec.unmarked`.

### 37.3 Who owns a discovery (`murder.onFound(handler)` → `off()`)

`handler(rec, ctx)`, `ctx = { finder, finderEntity, body, place, witnessed, lake, cause,
murder, defaults }`. When a body is found, handlers run in order; the first that returns
true owns it and takes over the discovery lines (the finder's cry, the event note, the
toast), the case and Lyra's learning; `ctx.defaults` (`cry`, `note`, `openCase`, `lyra`,
`toast`, `grief`) lets it reuse any of them. Either way the record is marked found, the
village life's news of the body runs (`onBodyFound`: the `found_dead` rumour, by meeting),
`body_found { id, finder, place, murder, cause, owned }` goes out, and grief, the funeral and
the Moot follow. A handler that declines (or throws) leaves the default; with no handler,
`found()` is unchanged. A finder's cry is their own voice (the hearing rule); Lyra learns as
§29.4 says unless the owner says otherwise.

### 37.4 The pact

Society emits `bus 'pact_sealed' { gifts }` and exposes `game.villain?.hasPact?.()`; soul listens
and calls `game.unkindle.learn('pact')`. "Before" or "after", the Unkindling comes with the pact.
A failed hold emits `unkindle_resisted`; a resisting tempter is only amused ("Ha. Not me, little
flame. Never me.").

### 37.5 Sound and sight in the Unkindling (Version 11's hearing rule)

- **Loudness 0.** The held one makes no sound for any ear (`hearing.js`: `silence` → `voiceOf` 0
  for `say`, `callForHelp`, a blow's cry, a scream); `murder.kill`'s `silent` keeps them so. A
  sleeper a tile away, who would hear any scream from there, sleeps on. The spell's own sound is
  the player's alone: `audio.play` with no position and no bus event (§37.7).
- **Seen, by the sight rule only.** Who saw it is `murder.kill`'s `witnessesOf` at the moment of
  death; who saw a failed hold is `sight.js` `watchersOf` from the victim and from you. Never a
  bare distance.
- **Unseen:** a mysterious death (no suspect, no wanted, no alarm, no case), found through
  `onFound` (§37.8). It counts for the tempter and reputation only once known as a killing
  (`rec.linked`, `rec.knownKilling`, `rec.knownBy`, `killing_known`).
- **Seen:** the witness saw the soul pulled out: their own words over the generic alarm, the
  `'unkindled_seen'` rumour (by meeting), and every earlier death is linked by whoever has it.
- **Breaking free:** the victim KNOWS; they fight (the watch, Hess, anyone with combat) or run
  for the watch; their account (`'unkindle_attempt'`) travels by meeting; the attack is a crime by
  sight or by their telling (`combat.assault` when talk's wrapper is there, else the same steps).

### 37.6 How it looks (`src/render/unkindle_fx.js`)

- **The soul** is a pixelfx effect (`'unkindle'`, layer `top`, defined on the host at install): a
  pale, cold-blue, dithered translucent copy of the target's own sprite frame (`actorOf`: the
  pose they stand in), each pixel a step of a cold ramp by its own brightness, the rim palest. It
  rises out of the body and leans toward the raised hand, the crown leading, the legs thinning to
  a tail still held in the body, swelling a little, smeared behind, shivering. Thin wisps run
  from crown, chest, both sides and waist of the body to the soul: slack while it is drawn, taut
  and bright when it **jerks back** (the channel's `jerk`); the body's rim flares as it does.
  The body darkens as its light goes out. At the tear the wisps snap and curl back; the soul
  flares paler, then **gutters like a snuffed candle** (shrinking, flickering, its top leaning
  and licking, shedding smoke) and is **drawn into the hand**, which gathers cold light, flares
  and goes out. A stronger soul **snaps back** with a cold ring at the chest.
- **The body** (a draw wrapper on the target for the hold only): trembles and rises onto its toes,
  jolts at the tear, **sags at the knees** (squashed, sideways from you) until the death lays it
  down (`murder.layBody`: lying, unmarked, no blood). A stronger one staggers back (knocked).
- **Nearby** (wrappers on the renderer's last pass and on the lighting's composite): the colours
  drain and go cold round the two of them (one 'color' blend and one cold multiply of a ring
  texture painted once; the two of them and the soul keep their colours), deepest at the tear;
  every lamp, window and hearth within 200 px gutters and sputters (this frame's `_seen` share
  only, never a light itself), and dips at the tear; the household's flame on the chapel altar
  gutters at the moment of death (`gutterAltar`).
- **Reduce motion:** the still version: no shiver, jerk, flicker or ring; the soul eases out and
  back; the drain is gentler and steady; the host draws it smaller with half the glow and no
  white pixels.
- **Cost:** one 88×88 effect painted at 30 fps under the host's paint budget (about 1 ms a frame
  at 4× CPU), two stretched blits, one pass over the frame's lights. `scripts/soul_check.mjs`
  measures the throttled phone holding it.

### 37.7 Controls and sound (`src/ui/unkindle_view.js`, `src/styles/soul.css`)

- **Desktop:** hold **F** (no other binding uses it; letting go before the tear lets it slip back).
  A small dark hint above the use prompt ("F Hold Bram") while someone it may take is in reach;
  pressing F at a child, a wall or the undead says why in a toast ("No. Not a child.").
- **Phone:** a dark hand in the right-thumb cluster (appended to `touch.anchor`, placed by the
  cluster's own geometry left of the dodge, mirrored for a left hand, at least 44 px, named for
  the target), only while the spell is known and someone it may take is in reach; held, it holds
  the spell; lifted, it lets go. It hides with the touch layer under any panel.
- **No pad binding this round** (seam: a free pad button, L3, would be blood's `input.js`).
- **Sound:** recipes added to `SFX` (`unkindle_drone`, `_jerk`, `_tear`, `_gutter`, `_snap`):
  a faint cold drone with a slow beat while it is held, a catch at each jerk, a breath drawn in
  at the tear, a snuffed wick as it gutters, a thump when it snaps back. Played with no position:
  only the player hears them, and nothing in the world does.

### 37.8 What the village comes to know (`src/murder/unkindled.js`, `game.unkindle.village`)

- **The discovery** (`murder.onFound`, cause `'unkindled'`). Unseen: `rec.mystery`; no case, no
  wanted, no alarm; the finder is shocked in their own voice ("…No mark on him. Not a scratch.
  And he is cold as stone."); the note and the toast say no mark, no blood, cold as stone (never
  a blade); Lyra learns as anyone does (`defaults.lyra`); within the hour **Mira** looks him over
  ("No mark on him. Cold as stone… like the hollow wind took him, but there's been no wind.");
  grief and a funeral as for any death. Seen: the case opens with the witness's word, as a murder.
- **The flame's hour.** At the death `rec.flame = { hour, day, house }` ("the Ironhand flame",
  "Aveline's flame"); the first time **Aveline** is awake in the chapel after it she finds it
  guttered and knows the hour (an event), and once the body is found she says it ("The Ironhand
  flame guttered just before midnight. That is when he went.").
- **The pattern** (`fearLevel()`: unkindled bodies found). At **2**: the `'hollow'` rumour (by
  meeting), "doors barred after dark": a wrapper on `villageLife.entryFor` sends the grown home
  after 20:30 (`'rest'` at home), and the watch walks the night (Rowan to midnight, Wys after);
  barks in their own voices near you, offline. At **3**: the Moot meets afraid (an event); the
  briefs say so.
- **Linking.** Knowers (`knowers`, saved) are those who saw an Unkindling (`rec.seen`), who heard
  a witness's account (`'unkindled_seen'` rumour's `heardBy`) or a failed attempt's
  (`'unkindle_attempt'`), and its victim. A knower links every unkindled death they know of
  (found, or seen) to the stranger: `rec.knownBy`, `rec.linked`, `rec.knownKilling` (society's
  reputation and the tempter read them; `killing_known` once per record); a found mystery's case
  reopens with the count (`rec.answers` gains `'linked'`, weight 0.85). Lyra, a knower, keeps it in
  her memory and her belief.
- **Horror.** Lyra seeing it: her own words (her mind's `horrorLine` if talk or party give one,
  else ours), a memory, fear. Whoever walks with you (`party.holder`): `party.horrorLine` or
  `village.horrorLine` if given, else ours. Lines never threaten the player.
- **A failed attempt:** `attempted(e, { knows })`: unknown, a chill; known: the crime, the
  rumour, opinion −45, their words ("Your hand— you were pulling me OUT of myself!"), and they
  fight or flee for the watch.
- **`briefLine(id)`**: a knower: "You SAW the stranger draw Wys's life out…", or "heard it from
  one who saw…", with the names of the dead they now attribute; a victim who broke free: "you
  broke free. You know what they are."; otherwise, by the deaths they know of: one ("found dead
  with no mark… nobody can say what took him"), two ("whisper of the Hollow; you bar your door"),
  three ("The Moot is frightened"). Never "souls" unless they know it.

### 37.9 Coldfire, the taken flame (S20-6 as replaced, S20-7: `src/magic/coldfire.js`, `game.unkindle.coldfire`)

No health is lost: the price is that it shows (§37.10, §37.11). Two measures, saved in
`plugins.unkindle.coldfire`:
- **`bar`** 0–100, shown. Each soul adds `FILL[kind]` × its strength against a typical one
  (0.6–1.5): a person 36, a bandit 20, a beast 8, a boss 60; straw nothing. It **ebbs** 14 a day
  by the clock (sleep too): a full bar is gone in about a week. What it gives (`b` = bar/100):
  Sword and Weave power **+30%·b** through the one stat pipeline (`stats.addProvider('coldfire')`:
  `pct { atk, spellPower }`, label "Coldfire"; nothing in `magic.js` or `combat.js` changes;
  a full bar is strong, never a one-shot on a boss); the Unkindling pulls `1/(1 + 0.4·b)` as
  long; your power in its strength check × `(1 + 0.5·b)`.
- **`mark`**, hidden: what you have taken over time (+1 a person, +0.5 a bandit, +0.3 a beast,
  +1.5 a boss; at most 8). `settled` follows it up 0.5 a day (the signs come on over days) and
  down at once; after 5 days without taking the mark fades 0.1 a day (weeks). `tier()` from
  `settled`: **faint** ≥ 0.4, **clear** ≥ 1, **strong** ≥ 4 (three wolves and a bandit are
  clear after about two days; four people and more, strong). An older save's `mark` carries
  over, settled.
- `rite()` (Aveline's, §37.11): the bar emptied, the mark × 0.4.
- **On screen** (`src/ui/coldfire_view.js`, `src/styles/soul.css`): a thin cold-blue meter right
  under health in the HUD's player card, only once the first soul is taken, its text the boost
  now ("+19%"); it is a meter of the card, so it follows both phone orientations and the
  Interface size. The Character panel gets a **Coldfire** box after "Running now": the bar,
  "Sword and Weave +x%", how much faster the pull is, how fast it ebbs, the souls taken, and
  what shows on you now. Both are added on instances (the card's health meter, the character
  view's `render`), feature-detected.

### 37.10 The signs (S20-8: `src/render/soul_signs.js`, `game.unkindle.signs`)

By coldfire's tier: **faint** — breath that fogs at night (a warm one too), hands ice-cold (felt
only: §37.11); **clear** — flames and lamps lean away from you and gutter as you pass (warm
lights within 60 px, this frame's light only, nudged away and sputtering; a tongue of flame bent
from you drawn over the night's light), hens, the cat and the wild things shy (`creature.scare`,
within 46 px), frost in your footprints at night (a print each step, melting in 26 s);
**strong** — a pale cold glint in your eyes at night (on the sprite's own eyes), your shadow slow
to follow (a second shadow that lags), the wildflowers in a cup by your bed (Wayhouse) droop and
die. The world part runs anywhere (tests too: `shyAt`, `frostAt`, `leaningNear()` are what the
faithful see); the drawing installs only on a browser game: a `drawShadow` on the player (the
renderer's ground pass), and a wrapper on `lighting.composite` (the lean, then breath, eyes and
flame tongues over the light). Reduce motion: the still version (a steady haze, no sputter, no
lag: the shadow a fixed step behind). Cost: a few rects a frame and one pass over the lights.

### 37.11 The faithful read the signs; dangerous, not evil (S20-9, S20-10: `src/society/dark_suspicion.js`, `game.unkindle.suspicion`)

- **Perceiving.** Each grown person (never a child) builds their own `s` (0–100) only from what
  they see (`sight.js`: breath and the eyes within 3 tiles at night, the leaning flames, the hens
  shying, frost at night, the lagging shadow by day) or feel (a touch in an act, `*hugs*`,
  `*takes her hand*`, within 40 px; whoever tends you when you are helped up, `revived`). Each
  sign counts once an in-game hour. **Faith** weighs it: Aveline 1.6, anyone whose day has
  `'pray'` (Wenna, Bram) 1, the superstitious (Corran) 0.7, the ordinary 0.15 and capped at 40
  ("You're cold as a well stone. Are you ill?", their own barks). Aveline joins the household
  flames she found guttered (`rec.flame.known`) to the signs (+15 each). Worry travels **by
  meeting** (`village_talk`): only to the faithful and the teller's friends (bond tags). It falls
  3 a day, 12 once the signs are gone.
- **The asking.** At **60**, Aveline (else another of the faithful) comes **by day** (8–19),
  **in private** (no other grown eyes on you within 7 tiles, `watchersOf`; whoever walks with you
  may stay): a duty step walks her to you (`helpMove`), then she asks in her own words, built from
  what she saw ("I've seen it: the candles lean away from you when you come in… And the Ironhand
  flame guttered on the altar the hour Bram died… What are you carrying?"); the chat opens to her
  with the field open (`ui.talkTo`, else `chat.selectTarget`), her line in the thread. Gone if you
  walk off or after 2 minutes ("Another time, then."), again in 3 days.
- **The verdict, first.** `village.playerSays` is wrapped on the instance: the original hears and
  remembers your words first, as always; while her asking is open the game decides the verdict
  before any wording (`decideVerdict(knowledge, answer)`, pure): a confession (dark magic,
  souls, the beasts, the pact) → **knows**; a confession naming a dead person → knows, and it is
  murder (she becomes a knower; §37.8 links it). A denial, an excuse or an evasion against what
  she knows (`evidenceOf`: a faint sign 1, clear 2, strong 3, a guttered flame 3, being told 1):
  she knows of the dark magic already (saw or told) → **knows, caught**; evidence ≥ 9 → knows
  (undeniable); ≥ 6 → **doubted**; an illness against only the faint signs → **believed**;
  evidence ≤ 2 → believed; else doubted. Her brief during the reply (`askingBrief`) carries only
  her knowledge and the verdict, so one Claude call words it; offline her own lines.
- **What follows.** Believed: `s` −45 and quiet 4 days (a sign weighs 0.35). Doubted: `s` +10,
  opinion −2, quiet 2 days. Knows: **known dark magic** (`learnDark`): opinion −4 (caught in a
  lie −6 more, `s` +20), wary; she asks you to stop (`askedStop`) and Aveline offers the **rite**
  at the chapel flame: your choice, by saying so to her (at the chapel: `coldfire.rite()`, "Kneel
  with me…"; elsewhere: "At the chapel…"). Known dark magic is never a crime: no case, no wanted,
  no hunt, no grievance; reputation and the trial read only murder records.
- **Seen.** A beast or a bandit taken before someone's eyes (`watchersOf` from where it fell and
  from you): they saw dark magic (their own shaken words), the `'dark_magic'` rumour (valence
  −0.15, severity 0.3: by meeting, never a grievance), and whoever hears it knows (`told`).
  A PERSON unkindled before someone's eyes is murder (§37.8): the line holds in the game and
  in the briefs ("Dangerous, not evil" for dark magic; "They are a killer" for a killing).
- **Stopping and going on.** Once you have stopped (7 days without taking) and the signs have
  dropped below where they were when she asked, one who asked you to stop says so ("You're
  warmer. Thank you."). A soul taken after being asked: on their next sight of a sign, worry
  becomes fear (+20; "You didn't stop."); never a crime without a killing.
- **Lyra** perceives as anyone does (faith 0.5, her own memory of each sign); knowing your dark
  magic she keeps it, feels fear, trusts a little less (her relationships), and her brief says
  so: what she does about it (frightened, pleading, leaving if it goes on) is her own mind's.
- Saved in `plugins.unkindle.suspicion` (per person: `s`, `signs`, `told`, `dark`, `asked`,
  `askedStop`, `fear`, `flames`, `riteOffered`, `warmerSaid`); an asking in progress never is.

### 37.12 Prey that is not murder (S20-11)

Hostile beasts (`'beast'`: wolves, boars, slimes; anything not wildlife, not a pet) and bandits
(`'bandit'`) are held like a person (their controller set aside) and taken: smaller souls for
the bar, no murder record, no tally, no Hollow. Harmless things (`'harmless'`: hens, the cat,
deer, rabbits) are refused and never offered; skeletons and bats have nothing to take; a boss
or the tempter only by a hand much stronger (§37.1); training dummies only in practice. Never
a child, never the player, never through a wall.

### 37.13 Seams

- Read, feature-detected: `pact_sealed` / `villain.hasPact` / `villain.tempter` (society),
  `game.lock.target` (blood), `murder.kill` options, `onFound`, `canKill`, `isPerson` (base and
  blood), `combat.assault` (talk), `party.holder` / `party.horrorLine` (party),
  `lyra.mind.horrorLine` (talk), `magic.trial`.
- Wrapped at install, on instances (no file edited): `renderer.deathFx.draw` (the drain),
  `lighting.composite` (the guttering lamps), `villageLife.entryFor` (the night), a held
  target's `draw` (tremble and sag, restored after).
- Society reads `rec.linked`, `rec.knownKilling`, `rec.knownBy` and `killing_known` (its
  reputation and the tempter); talk reads `briefLine`.
- §13b, also on instances: `village.playerSays` (the touch and the verdict: the original runs
  first and unchanged, so every word is heard and remembered), `ui.character.render` (the
  Coldfire box), the HUD card's health meter (the bar after it), the player's `drawShadow`
  (the ground signs), `lighting.composite` again (the lean and the lit signs). A creature's
  `controller` while held. The stat pipeline's `addProvider('coldfire')`. Read: `village_talk`
  (worry by meeting), `revived` (who tends you), `npc.duty`/`helpMove` (the walk-up),
  `ui.talkTo` (talk) or `chat.selectTarget`, `creature.scare`, `murder.fearOf`.
- **For §13c (the dark path you can leave, the follow-up on society's files):** ending the pact
  touches nothing here: `game.unkindle.learned` stays true (you keep what you learned), the
  bar ebbs and the mark fades on their own, and the faithful's suspicion and known dark magic
  stay what people know. Society may listen to `coldfire`, `dark_verdict` and `dark_rite`.
- **For §14 (casting stops you, the follow-up, built: §38.6):** the Unkindling's hold plants
  the caster (lockTime each frame, velocity zeroed, a roll breaks it), the same rule as
  `castMoveMul 0` for every other channel; nothing in it needed to change.

## Polish (r14b)

Workstream polish takes the small things the checks left. As built:

- **The down countdown** (`src/ui/death_view.js`, `src/styles/polish.css`). The ring and its
  words sit on one solid panel (readable over pale crowns, snow, lamplight). While you are
  down the UI root carries `sv-down` (and `sv-lefty` when the stick is on the right). On an
  upright phone the countdown goes above the body under the top strip, so the floating
  stick's zone (the lower half) never holds it: just under the top cards however tall the
  price chips have grown them (`--sv-top`, measured by `place()`); the mission line makes
  way and the toasts come below it (`--sv-below`). Sideways it takes the half the stick does
  not. On a computer the weave bar steps aside while you are down, and the countdown is
  drawn at the Interface size (`ui._uiz`) as far as it fits between the body and the
  screen's foot (`place()`, four times a second); the ring's canvas follows the pixels it
  is shown at.
- **The ember-ring's marks** follow Interface size (CSS: the arrow and its words by `zoom`,
  the tag by its sizes). Turned toward the ring, the grown arrow reaches about 14 px × the
  size from its point, so `ember_ring_view.js hudClear()` keeps a gap from the mission line
  and the corner cards of `14 + 18 × (size − 1)` px (14 at size 1, as before).
- **The Last Stand's fire** (`src/render/death_fx.js`): each edge is one strip (scorched rim,
  glow, pixel flames in four frames) painted once per window size; a frame is four copies.
- **Snow under a warm light** (`src/render/lighting.js snowLight`): where `weather.localSnow`
  says the ground is snow (eased), a warm ambient is pulled toward a cool pale light of
  about its own brightness. Noon and night are unchanged.
- **The Leech preview** (`src/ui/weave_sandbox.js`): each draw of life is drawn in the
  Spellbook's sandbox as a stream of green motes from the dummy to the caster, a red wisp,
  and a glow as it lands.
- **Prices played** (§25, `scripts/price_sim.mjs`): overdraw's drought 20 s and not lifted by
  casting it again; emberblood's weaves cost 30% less while it burns. On a phone the price
  chips wrap to a second row.
- **Mending** (`src/world/broken.js peopleLiveAt`, the mend rule in `mendTick`): a broken prop
  is mended only where people live, the vale while anyone is still in it (and not once
  `game.occupation.emptied()`, when blood provides it). Elsewhere the debris stays and the
  mend is asked again a day later; a bush grows back anywhere.
- Not done here: the hearing rule's trees, props and second doorways. It was not cheap:
  the second doorway that matters is a partition's open gap (the Kettle's back rooms, out
  through the front door), and `worldgen.partition()` records no gap anywhere, so it needs
  worldgen to keep them and a two-leg search in `hears()`; trees and crates let sound round
  them in life, and making them muffle would change `hears()` (§33.2) under the four
  workstreams that build on it. Left for after the merge. Also not here: the 844×390 prompt
  over a speech bubble (bubbles.js belongs to party and talk).
- Its CSS is in `src/styles/polish.css`; `src/core/plugins/polish.js` stays empty (nothing
  here needs a plugin). Tests: `tests/polish.test.mjs`; the check: `scripts/polish_check.mjs`.

## 38. The round 14b merge: where the workstreams meet

The six workstreams (talk §33, party §34, blood §35, society §36, soul §37, polish) were
merged in that order onto `r14b/base`. Each kept its own hunks (plan §4). These are the
contracts that only exist once they are together, and how the merge holds them
(`tests/r14b_merge.test.mjs` checks each; `scripts/r14b_story.mjs` plays the author's list on
all three screens):

- **Cited memories** (talk → party): the chat emits `memories_shared {who: 'lyra', ids}`
  whenever a line of Lyra's carries memory chips (shown at once or attached later); party
  keeps them in `mind.shared`, which People shows. A left or gone Lyra confides nothing new.
- **Pair talk and the companion** (party → talk): `village.endTalk(e)` ends whatever chat
  by the well the new holder was in; `village.walksWithPlayer(e)` keeps the holder out of
  new pair talk and out of Lyra's chats while they walk with you.
- **The hunt in the afraid dialog** (blood → talk): `murder.isHunted()` (the posse is out,
  `hunt.active`) adds "Give yourself up" to anyone's afraid options.
- **The fallen village on the map** (blood → party): the map's place labels and title go
  through `occupation.placeName(id, name)`: "Hearthvale (yours)".
- **One refusal for every shop** (society, with blood and talk): `trade.stance(game, npc)`
  also refuses for a burned store (`occupation.shopClosed`, why `'burned'`, said in their
  words); `village.standing().refusesTrade` reads the same rule; a frightened merchant keeps
  Trade on the afraid list (answered in their fear).
- **A child who knows** (blood → society): `occupation.knowsKiller(child)` asks reputation's
  per-knower count (`reputation.counts({knownTo}).killedKnown`), not a guessed shape.
- **News before the funeral** (blood → society): a death of age found by kin is known to the
  village within the hour (blood's news by meeting, or the bell and the chapel); the funeral
  is planned then, still with no case and no Moot.
- **The pact and the Unkindling** (society → soul): checked together, not changed:
  `pact_sealed` teaches it; an unseen Unkindling counts for the tempter and the reputation
  only after `killing_known`.
- **Not built by anyone, left open**: a merchant companion's shop while they walk with you
  (party's open note). D3's forgiven first swing was built by verifier A (§38.8). Casting that plants you for every weave was built by the follow-up
  stage (§38.6), and the dark path you can leave too (§38.7).

### 38.6 Casting stops you (the follow-up stage, plan §14; the author: "I can move while I'm doing spells; it should stop me")

The rule is fixed; the numbers are what play tunes (`src/magic/balance.js`).
- **You stand to weave.** From the press of a weave (`magic.castStart`), and for as long as a
  charge builds or a beam pours, the caster's walk is `castMoveMul = CHARGE_MOVE = 0`
  (`magic._holdStill`, refreshed every frame of `_updateHolds`): no step and no drift
  (velocity zeroed). The move stick or WASD only turns you, and with it every aim that follows
  your facing (a tap's auto-aim, a key with the mouse away); with the stick at rest you face
  the weave's own aim (the mouse, a drag, the lock). The hands stay up while it gathers.
- **A cast plants you for the pose.** When a weave leaves the hands (`magic._emit`, once per
  cast: an echo or a volley a moment later turns the hands again but never re-plants), the
  caster is planted for `plantFor(plan, castSpeed)`: the shape's weight (`PLANT_SHAPE`: the
  Spark 0.24 s, strike 0.26, blast and throw 0.3, bind 0.32, summon, nova and wall 0.36, rain
  0.4; a dash 0, it moves you itself), +0.03 s for each price, +0.004 s per mana past 12, held
  in 0.24 to 0.4 s, then divided by cast speed (never under 0.16 s). The player plants through
  `Player.castPlant(s)` (`castPlantT`; `player.planted`); anyone else through `lockTime`,
  which every walker and steering already honours.
- **The way out is the roll** (`Player.tryDodge` → `magic.breakCast(caster, 'roll')`): a charge
  breaks and costs nothing, a beam already poured keeps its cooldown (`castCancel`), the
  plant ends; bus `cast_broken {caster, why, held}`. `magic.castingState(caster)` says which holds you:
  'beam', 'charge', 'plant' or 'channel' (the Unkindling). A knock-down or a freeze breaks it as
  before (`interruptHold`, a downed caster's hold is cancelled).
- **Every weaver.** Lyra, a companion and enemy casters cast their bolts, heals and binds
  through `combat.shoot`/`castHeal`/her bind with a state lock (`setState('cast', lock)`), so
  they already stood; anyone who casts through `game.magic` is planted by the pose and held by
  a charge or a beam (tests/cast_plant.test.mjs: no NPC weaver glides). The Unkindling's
  channel holds you by its own lock each frame (§37.13), the same rule in effect.
- **Said once.** The coach's hold step and, the first time the stick pushes against a stance
  (`cast_stand`, once: `flags.standHintShown`), a toast: "You stand still to weave. Roll to
  break off." The Spellbook says it under the weave's numbers; CONTROLS and How to play too.
- **Tuning by play** (a weaver bot kiting with the Spark and a Blast over three wolves, a
  bandit camp and Varek, the rule on and off, at 1280x720 and on a sideways phone;
  `scripts/followup_check.mjs` for the feel by hand-held input): wolves 3.5–9.8 s standing
  against 4.8–5.4 s walking, the camp 5.2–10 s against 9.5–9.8 s, no more damage taken; Varek
  64.5 s standing against 58–73 s walking, with about a third more damage taken (299 against
  214–233: a weaver who stands is easier to hit, as meant). Nothing there is miserable, so the
  plant (0.24–0.4 s) and CHARGE_TIME (1.5 s) stay as they are; if hand play finds the boss
  harsh, shorten CHARGE_TIME first (the exposure is the charge, not the plant).

### 38.7 The dark path you can leave (the follow-up stage, plan §13c; the author: "when I want, I can stop and say no")

`src/story/villain.js`, `src/story/tempter_data.js`, `src/story/stays_done.js`.
- **Say no at any time** (`villain.endPact(how)`): in your own words in the chat (`END_RE`:
  "I'm done", "the pact is over", "I won't kill for you anymore"…, read before anything is
  worded) or the option "I'm done. The pact is over." The pact ends without warning anyone;
  you keep what you learned (`game.unkindle.learned` and any essence or price stay); he turns
  cold (`state.hostile`, his opinion of you drops: the chat's header says so) and is your
  enemy: on a later night, come within `STAND_RANGE` (84 px) and say nothing for
  `STAND_AFTER` (3 s) and he stands against you (`fight()`; a word to him holds him off for 8
  s). The hero ending stays open (downed, he comes apart). The broken word is Oathbreaker to
  whoever knows (`breakWord`: only he, unless you tell someone; warning someone afterwards
  teaches them). Warning the watch with a pact ends it the same way (`how: 'warned'`). Bus
  `pact_ended {how, kept, again}`.
- **Go back later at a higher price** (`offerReturn` → `acceptReturn`/`declineReturn`):
  "I want the pact back", "take me back"… He names the price: a named adult first (the toll),
  one more for each time you come back. Yes restores the pact with the toll as accepted asks;
  refusing a toll is refusing the pact (it ends again). Bus `tempter_return`.
- **His single asks, one at a time** (`offerAsk`, at most one a night, never the night of the
  pact; `acceptAsk`, `refuseAsk`): the game picks (`pickAsk`, in turn a person, a soul, a
  flame) and his persona or his lines word it. A person (`ASK_PEOPLE`, with his reasons: the
  captain, the huntress, the chapel keeper…; never a child, never Lyra, never whoever walks
  with you): done when they die by your hand (`villager_killed` by the player; he feels that
  flame go out), void if they die otherwise. A soul brought: the next soul you take (soul's
  `unkindled`) is carried for him and handed over when you next speak with him (the coldfire
  bar gives back what it gave). A flame put out: while agreed, the chapel altar's use is "Put
  out a flame" (an instance wrapper); seen (`sight.js`) it is a `flame_snuffed` rumour by
  meeting and opinion drops with whoever saw; unseen, Aveline (or Petra) finds it dark at dawn
  (`flame_found_out`, nobody knows who). Refusing one never ends the pact. Done is paid: an
  "after" pact's wages early (dark, then the blood price), else a weave part. Bus
  `tempter_ask {state, ask, gift}`.
- **What is done stays done** (`stays_done.js`): the dead stay dead, pact or no pact. The
  systems already pass things on (missions: `murder.standIn`; work and shops: `HEIRS`; the
  Moot chair and the heads: `chairOf`, the living heads; juries: `jurorsOf`); this module says
  it in one place, for what the village KNOWS (`murder.knownDead`): `staysDone(game, id)` →
  their missions (passed on, or ended), their work and shop, their Moot seat and the chair,
  the rites, who mourns, their story lines, and his ask. The Missions journal shows it: a note
  on every card whose giver is gone ("Captain Rowan is dead. Wys sees it done now."), a "What
  is done stays done" section under Active, closed missions under Done; `missions` toasts a
  pass-on once (`flags.passed_<id>`) and emits `mission_passed`.
- **He keeps his post and hears you out.** The Tempter does not perceive the village (no
  flee from its killers, no coming to see its dead: `perceive()` is empty, a flee or help is
  put back to his post, the walker stopped each beat), so a killing the bell announces never
  walks him off the gate. He does not go at dawn while the chat is still answering or holds a
  line of yours for him (`hearing()`): every message is delivered first. A price named on an
  earlier night and never answered is off the table the next night.
- **Saved** in `plugins.villain`: `ended, endedDay, endedNight, endedHow, oathBroken,
  oathKnownBy, hostile, returns, returnOffer, asks, askNight, soulHeld, flamesOut`; an older
  save reads with none of it.

### 38.8 Verifier A: what playing the author's items on three screens fixed

- **D3, the old habit forgiven once** (`combat._forgivenHabit`): a click on a person is the
  sword wherever it lands. The first sword blow in a life that a *mouse click* started
  (`input.clickSwingAt`, carried as `habit` from `Player.attack` through `combat.melee`) and
  that lands on a calm, lawful person (standing, not fighting, fleeing or afraid of you, not
  your lock target) is an accident: it lands, they yelp ("Ow! Watch it!"), no crime and no
  grudge, and the coach says once "T talks to whoever is in front of you. Striking people is
  a crime." (`flags.habitForgiven`). Every blow after it is a real one. J, Space, the pad and
  the phone's sword button are meant (a phone's tap on a person does nothing at all); a
  weave, a slap or a finishing blow is never the habit.
- **Lyra judges an unscreened blow by her own eyes**: a blow that was no crime (an
  accident, the forgiven habit) is screened by nobody; `murder.saw` read that as "she saw
  it", so she cried "Hey — me, not them!" from a field away. Now `sawBlow` null falls back
  to `seesActor`.
- **A notice never eats a click** (`.is-touch .toast` alone takes the pointer): with a
  mouse, the right-button cast and the sword land on the wolf behind a notice.
- **The companion's edge badge and their edge words** (`bubbles._badgeRect`): the badge is a
  fixed rect the bubbles stack around, so their pinned words are never drawn under it.
- **Fear on reopening the chat** (§29.3 above): the note on each opening, and "terrified of
  you" in the header.

