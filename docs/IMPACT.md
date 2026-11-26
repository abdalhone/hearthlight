# What a change can ripple across

The author asked for this file (round 14): *"when I give you stuff like this … that could
really need a difference if we added other things into the game, like other places, other
floors, other terrain, or other characters. Put it in a file. So each time that you edit
something, you say, hey, should this thing that I'm editing affect any of those things?"*

**How to use it.** Before you call a change done, walk every axis below and ask: *does what
I changed behave right for each value on this axis, and does each system listed react to
it?* Then say in your commit or report which axes the change touches and what you did about
each (or why it does not apply). When you add a new value to an axis (a new class, a new
floor, a new place, a new kind of character), walk the systems in its row and teach each
one about it. Keep this file current: a new axis or a new system that reacts gets a line.

The source of truth for the canon is `docs/LORE.md`; for contracts, `DESIGN.md`.

---

## 1. Player builds and classes

Values: **sword** (Might-heavy), **magic** (Wits/Spirit-heavy, weaves), **hybrid**,
*future*: bow and arrows, other classes and weapons.

| System | What must react | Where |
|---|---|---|
| Finishing blows / kill scenes | Sword build beheads with the blade; magic build ends it with a weave to the head; hybrid uses both; a new weapon brings its own finisher | `src/murder/*` (round 14b: adaptive finishers) |
| Combat damage and stun | Damage sources (sword arc, weave bodies, beams, future arrows) all go through the hit pipeline; walls stop each | `src/entities/combat.js`, `src/magic/*` |
| Stats, gear, prices | Stat points, gear slots and prices favour the build; a new class needs its stat, its gear and its prices | `src/progression/*`, `src/gear/*`, `src/magic/prices.js` |
| Mission objectives | An objective that asks for a weave must have a sword-friendly way, and the reverse (or say why not) | `src/missions/data.js` |
| Lyra's lessons and reactions | She teaches magic; she reacts to how you fight | `src/missions/lyra.js`, `src/ai/mind/*` |
| HUD / controls | Each build's buttons fit phone and desktop (sword, weaves, a future bow's aim) | `src/ui/hud.js`, `src/ui/touch.js`, `src/core/input.js` |
| Footsteps, animations | A heavier armour or a new class may walk differently | `src/world/footsteps.js`, `src/art/characters_*` |

## 2. Terrain and floors

Values: grass, tall grass, forest floor, heath, grey grass, dirt and roads, farmland,
cobbles, gravel, scree, stone floors and flags, wood floors, bridges, the dock, rugs, sand,
snow, shallow water (fords), deep water, walls, thicket, rock and cliffs; *future*: ice,
mud, marsh, lava, dungeon floors, upper floors of a house.

| System | What must react | Where |
|---|---|---|
| Walking pace | Snow, scree, heather and fords slow you (`SPEED`); a new ground gets a pace | `src/world/tiles.js` `speed` |
| Footsteps | Each ground has its sound (`surfaceAt` → `step_<surface>`); a new ground picks one or adds a recipe | `src/world/footsteps.js`, `src/ui/sfx.js` |
| Pathfinding cost | Roads cheap, rough ground dearer (`cost`); solid and water block | `src/world/tiles.js`, `src/world/pathfind.js` |
| Ground art | A texture (`world_textures.js`), blending prio, the map chart color | `src/art/*`, `src/ui/world_map.js` |
| Weather on the ground | Rain soaks it (wet twin), puddles, reflections | `src/world/map.js`, `src/art/tiles_art.js` |
| Particles | Dust on dry ground, splashes in water, puffs in snow | `src/world/footsteps.js`, `src/entities/player.js` |
| Death and crawling | Blood smear and the ember-ring on each ground; drowning in deep water | `src/survival/*` |
| Kill scenes | Where the body falls (water, snow, floor) | `src/murder/*` |
| Spawns | What lives on it (slimes by water, wolves in wood) | `src/world/wilds.js`, `src/world/worldgen.js` |

## 3. Places and regions

Values: the vale (Hearthvale, the square, homes, the chapel, the inn, the farm, the quarry,
Whisperwood, the camp, the lake, the ruins, the meadow, the King's Road), the wider world
(the western heath, the dead waystone, Bracken Ford, the Long Mile, the west fork, the
Saltmere road, the Greyford, the Brindle lane, Brindlecombe, the deep Whisperwood, the
marker stone, the treeline camp, the Hollowcrown, the Crown Ring, the far shore, the
Cinderwick fork, the bandits' lookout, the oil track, the Owlsend track, the far fields);
indoors and out; *future*: dungeons (the Weeping Cut), other villages, other floors.

| System | What must react | Where |
|---|---|---|
| Locations index | Every place has an entry (name, kind, danger, aliases, description) | `src/world/world_content.js`, `src/world/wilds_content.js` |
| Lore and knowledge | A place page in the Book (`STORY.places` + a chapter), villagers' road talk, Claude's context | `src/lore/story.js`, `src/world/boss_trails.js` `ROAD_TALK`, `src/world/travel.js` |
| The map | Its fog cell, its name label once reached, its marks (waystones, bosses) | `src/ui/world_map.js`, `src/world/travel.js` |
| Spawns and safety | Spawn zones (near-only in the wilds), lit waystones as safe spots, the village's no-spawn rule | `src/entities/spawner.js`, `map.safeSpots` |
| Senses | Walls, rock and shut doors (`walls.js wallTile`) stop sight and blows and muffle a cry (`hearing.js`); an open door lets it out. A new building's walls and doors do this with no more work; a new kind of opening (a window, a gap) must say what it lets through | `src/world/walls.js`, `src/ai/hearing.js` |
| Weather and light | Local weather (the grey, snow), lights, indoors/roofs | `src/render/weather.js`, `src/render/lighting.js` |
| NPC travel | Paths reach it (long journeys route on `map.roadGraph`); people can be sent there | `src/world/pathfind.js` |
| Missions | Objectives can point there (`at`, `where`), markers and the edge arrow find it | `src/missions/*` |
| Death and rescue | How far the sickroom is; whether anyone can carry you back from there | `src/survival/*` |
| Saves | Only what differs from the generated world is saved (dirty objects, fog bits) | `src/world/objects.js`, `src/world/travel.js` |
| Walls, sight, the use button | A new building, ruin or wall tile stops a blow, an eye and "use" by `map.blocksProjectile` and shut doors; lights under its roof stay inside | `src/world/walls.js`, `src/murder/witness.js`, `src/render/lighting.js` |
| Breakables | A new prop kind gets a `BREAKABLE` toughness or stays whole; a prop a story needs is `story: true` (a boss's trail sign is spared by `trailBoss`); anything holding an inventory never breaks | `src/world/breakables.js` |
| Promises and errands | Villagers keep their word inside the vale; a message for someone out past it waits for them to come home | `src/ai/social/commitments.js` |
| Performance | Chunked ground, far objects update in turns, near-only spawns | `src/world/map.js`, `src/world/objects.js` |

## 4. Characters

Values: **Lyra**, the **eighteen villagers**, **children** (Pip, Tansy; unkillable),
**guards** (Rowan, Wys), **bosses** (Varek, Greyjaw, the Mother of Slimes, the Lake's Hum,
the Bone Warden), **creatures** (wolves, boars, deer, rabbits, slimes, bats, skeletons,
bandits), **companions** (Lyra today; round 14b: anyone); *future*: travellers, Owlsend's
survivors, new villagers.

| System | What must react | Where |
|---|---|---|
| Lines and voice | Every character's own words for a new event (barks, dialogue, Claude persona) | `src/ai/social/*`, `src/entities/npc_data*.js` |
| Knowledge and rumors | What they know of places and bosses (`TRAILS.tellers`, `ROAD_TALK`, facts) | `src/world/boss_trails.js`, `src/entities/npc_data*.js` |
| Killability and crimes | Adults can be killed, children cannot; theft and assault are crimes others learn of by eyes or by meeting someone who knows | `src/murder/*`, `src/world/containers.js` |
| Senses | Every eye and ear goes through one rule each: sight (`src/ai/sight.js`) and hearing (`src/ai/hearing.js`: walls muffle, a cry tells what and where, never who; a beast's snarl is a what, a person a who). A new kind of character (a deaf one, a hound) gets its exception there, as Wenna's blindness does in `witness.js` | `src/ai/sight.js`, `src/ai/hearing.js`, `src/entities/npc.js` |
| Ownership | Their beds, chests and keys (`owner`, `keeper`, `keyId`) | `src/world/containers.js`, `src/world/objects.js` |
| Combat and AI | Fight back, flee, stun, finishers per body size | `src/entities/*`, `src/bosses/*` |
| Footsteps and crawling | Others' steps near you; the downed crawl for anyone | `src/world/footsteps.js`, `src/survival/*` |
| Missions | Givers, turn-ins, foes that scale with your level (`toughen`) | `src/missions/*` |
| Age | Everyone grows a year older on their birthday (`game.calendar`); a child stays a child by build; a new character needs a base age | `src/world/calendar.js` |
| Trade | Who buys and sells what (`shop.buys`, `shop.buysAll`) | `src/entities/npc_data*.js`, `src/ui/dialog.js` |
| The map | Lyra's dot; future companions; bosses once heard of | `src/ui/world_map.js` |

## 5. States

Values: walking, running, rolling, fighting, casting/charging, fallen (down, crawling,
bleeding out), carried, sitting, sleeping, dead (kept flame, home waking, final), last
stand (round 14 D4), talking (a panel open), in a cutscene, trading.

| System | What must react | Where |
|---|---|---|
| Input and HUD | Which buttons show; panels pause; no fight buttons while down | `src/ui/*` |
| Senses | Asleep: a third of a cry's reach (the loudest, 0.6) and no eyes; down, carried or dead: neither | `src/ai/hearing.js`, `src/murder/witness.js` |
| Footsteps and pace | Steps only while walking; crawling is slower and smears | `src/entities/player.js`, `src/survival/*` |
| Spawns and AI | Creatures do not spawn in view; foes leave the fallen to the bleed-out | `src/entities/spawner.js` |
| Travel | Places are reached and the map's fog lifts only while you move about | `src/world/travel.js` |
| Missions | Objectives that need you standing, awake, at a place, at an hour | `src/missions/*` |
| Saves | What is saved mid-state (down, carried, asleep) | `src/core/save.js`, `src/survival/*` |
| Sleep | Any hour, any bed that is nobody's; never while down, carried, fighting or burning (the last stand); the clock's jump moves promises' due times and turns the calendar before the save | `src/world/rest.js`, `src/core/game.js` `sleep` |

## 6. Devices

Values: **phone upright** (about 390×640–844), **phone sideways** (about 844×340–390),
**desktop** (1280×720 and up, mouse and keyboard), **pad** (gamepad); touch vs mouse;
slow phones (test at 4× CPU throttle).

| System | What must react | Where |
|---|---|---|
| Panels | Fit the screen, a ✕ of at least 44 px, close by tap outside, finger-sized controls | `src/ui/*`, `scripts/phone_check.mjs` |
| Controls | Every action reachable by touch, by keys (and the map's N), by pad | `src/core/input.js`, `src/ui/touch.js` |
| The map | Drag, pinch, wheel, +/−; tools over the chart on a phone held sideways; with a mouse the panel is zoomed (Interface size), so pointer math divides by the canvas's zoom | `src/ui/world_map.js` |
| Interface size | Desktop panels and HUD are drawn at `--uiz` (1.2 Normal, 1.45 Large); anything that reads pointer positions inside them must divide by its own zoom | `src/ui/ui_scale.js` |
| Performance | Chunk painting, fog/overlays (one flat wash, not full-screen textures), object updates | `src/render/*`, `src/world/*` |
| Text | Toasts and signs readable at phone size | `src/ui/toast.js` |

## 7. Time, day and night, weather

Values: dawn, day, dusk, night; clear, cloudy, rain, fog; drift-weather (glimmer, the
grey, hollow wind, brightfall); the wilds' own weather (the grey over Brindlecombe, snow
on the Hollowcrown).

| System | What must react | Where |
|---|---|---|
| Spawns | Night-only and day-only zones; bosses that only come out at night | `src/entities/spawner.js`, `src/bosses/*` |
| Light | Lamps, waystones, windows, fires; darkness | `src/render/lighting.js`, `src/world/objects.js` |
| Missions | `when` windows (evening, night) | `src/missions/*` |
| Footsteps and ground | Wet ground after rain | `src/world/map.js` |
| Lines | People speak of the weather and the hour | `src/ai/*` |

## 8. Claude online or offline

Values: Claude (in the claude.ai Artifact or with a key), the offline mind.

| System | What must react | Where |
|---|---|---|
| Every mind and line | Works offline with local lines; online gets the same facts in its prompt | `src/ai/*`, `src/platform/claude_runtime.js` |
| Prompt context | Plugins' `promptContext` (missions, travel: where you are in the wider world) | `src/ai/plugins/*`, `src/world/travel.js` |
| Trials and judgement | Round 14b: villagers weigh your words with Claude; offline they still decide | `src/murder/*` |

## 9. Saves and permadeath

Values: a fresh game, a loaded save (older versions too), the kept flame, home waking,
final death, Settings resets.

| System | What must react | Where |
|---|---|---|
| Save size | Only differences from the generated world; bitsets for big maps (the fog) | `src/world/objects.js` `serialize`, `src/world/travel.js` |
| Old saves | Missing fields default; ids stay stable (object ids are positional, so the vale keeps its coordinates) | everywhere `deserialize` |
| Death modes | The ember-ring, the flame, the end | `src/survival/*` |
| Generated world | Same seed, same world: never move vale objects (saves refer to them by position) | `src/world/worldgen.js` |

## 10. Story branches

Values: hero, villain (round 14b: the stranger who offers power for the village), Lyra
with you or gone, villagers alive or dead, bosses beaten or not, Owlsend's arrival.

| System | What must react | Where |
|---|---|---|
| Lines and lore | People speak of what you did; the Book records it | `src/ai/*`, `src/lore/*` |
| Missions | Some close, some open with the branch | `src/missions/*` |
| The world | Places that change (a relit wardstone, a lit waystone, an empty house) | `src/world/*` |
| Map and markers | What you know is marked; what is gone is greyed | `src/ui/world_map.js` |
