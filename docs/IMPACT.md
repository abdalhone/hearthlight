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
*future*: bow and arrows, other classes and weapons. Abilities beside a build (round 14b):
**finisher per build** (blood: `registerFinisher`), **the Unkindling** (`'unkindle'`: soul, a
dark spell from the tempter's pact, DESIGN §37).

| System | What must react | Where |
|---|---|---|
| Finishing blows / kill scenes | Sword build beheads with the blade; magic build ends it with a weave to the head; hybrid uses both; a new weapon brings its own finisher (`registerFinisher`, DESIGN §35.2); never on a child (`isMinor`) | `src/murder/*` (round 14b: adaptive finishers) |
| The Unkindling (`'unkindle'`, round 14b soul; stub) | Learned only from the pact (`pact_sealed`), saved; touch range; loudness 0 (`hearing.js` `silence`/`voiceOf`); witnesses by the sight rule; never a child, never through a wall; a dark button on the phone, a held key on desktop; its price shows in the Character panel | `src/magic/unkindle.js`, `src/render/unkindle_fx.js`, `src/murder/unkindled.js` (soul) |
| Combat damage and stun | Damage sources (sword arc, weave bodies, beams, future arrows) all go through the hit pipeline; walls stop each | `src/entities/combat.js`, `src/magic/*` |
| Stats, gear, prices | Stat points, gear slots and prices favour the build; a new class needs its stat, its gear and its prices. A new price is played in `scripts/price_sim.mjs` beside no price (round 14b: each gives more in a short fight and costs in a long one) | `src/progression/*`, `src/gear/*`, `src/magic/prices.js` |
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
| Mending (round 14b) | A broken prop is mended only where people live (`peopleLiveAt`: the vale while anyone is in it; never Brindlecombe, the wilds or an emptied village); a bush grows back anywhere. A new place where people live (a camp, a resettled village) says so there | `src/world/broken.js` |
| Promises and errands | Villagers keep their word inside the vale; a message for someone out past it waits for them to come home | `src/ai/social/commitments.js` |
| Performance | Chunked ground, far objects update in turns, near-only spawns | `src/world/map.js`, `src/world/objects.js` |

## 4. Characters

Values: **Lyra**, the **eighteen villagers**, **children** (minors by age: `isMinor`, under
16, `src/core/people.js`; Pip 9 and Tansy 15 today, Tansy an adult at 16; never killable,
never companions; intimate acts only from 18, `canBeIntimate`),
**guards** (Rowan, Wys), **bosses** (Varek, Greyjaw, the Mother of Slimes, the Lake's Hum,
the Bone Warden), **creatures** (wolves, boars, deer, rabbits, slimes, bats, skeletons,
bandits), **companions** (anyone adult, `game.party`: the role is `game.party.holder`, Lyra
at a new game, nobody when you walk alone; `game.companion`/`game.lyra` stay Lyra the
person); *future*: travellers, Owlsend's survivors, new villagers.

| System | What must react | Where |
|---|---|---|
| Lines and voice | Every character's own words for a new event (barks, dialogue, Claude persona) | `src/ai/social/*`, `src/entities/npc_data*.js` |
| Knowledge and rumors | What they know of places and bosses (`TRAILS.tellers`, `ROAD_TALK`, facts) | `src/world/boss_trails.js`, `src/entities/npc_data*.js` |
| Killability and crimes | Adults can be killed, children (`isMinor`) cannot; theft and assault are crimes others learn of by eyes or by meeting someone who knows; every death records `by`, `cause`, `provoked` (DESIGN §35.1); a death nobody did goes through `murder.die` (no case, no alarm) | `src/murder/*`, `src/world/containers.js`, `src/core/people.js` |
| The companion role (round 14b) | Any adult may hold it (`party.canHold`); the HUD slot, the Ask bar, missions that count "with you", follow on foot, stand-ins when they die; a new kind of person says whether they can hold it | `src/core/party.js`, `src/entities/npc.js` (`duty`, `startFight` anchor and leash) |
| Senses | Every eye and ear goes through one rule each: sight (`src/ai/sight.js`) and hearing (`src/ai/hearing.js`: walls muffle, a cry tells what and where, never who; a beast's snarl is a what, a person a who). A new kind of character (a deaf one, a hound) gets its exception there, as Wenna's blindness does in `witness.js` | `src/ai/sight.js`, `src/ai/hearing.js`, `src/entities/npc.js` |
| Ownership | Their beds, chests and keys (`owner`, `keeper`, `keyId`) | `src/world/containers.js`, `src/world/objects.js` |
| Combat and AI | Fight back, flee, stun, finishers per body size | `src/entities/*`, `src/bosses/*` |
| Footsteps and crawling | Others' steps near you; the downed crawl for anyone | `src/world/footsteps.js`, `src/survival/*` |
| Missions | Givers, turn-ins, foes that scale with your level (`toughen`) | `src/missions/*` |
| Age | Everyone grows a year older on their birthday (`game.calendar`); who is a child is decided by age (`isMinor`, under 16; the build only when the age is unknown); a new character needs a base age | `src/world/calendar.js`, `src/core/people.js` |
| Trade | Who buys and sells what (`shop.buys`, `shop.buysAll`) | `src/entities/npc_data*.js`, `src/ui/dialog.js` |
| The map | Lyra's dot; future companions; bosses once heard of | `src/ui/world_map.js` |

## 5. States

Values: walking, running, rolling, fighting, casting/charging, fallen (down, crawling,
bleeding out), carried, sitting, sleeping, dead (kept flame, home waking, final), last
stand (round 14 D4), talking (a panel open), in a cutscene, trading. Round 14b: **locked
on** (blood), **saying aloud** (talk), **parting scene** (talk), **on duty** (an NPC holding
the companion role: mode `'duty'`), **held silent** (`hearing.js` `silence`: no sound at
all), **unkindling** (the player channelling the Unkindling; the target held and silent),
**unkindled** (a body with no mark: dead, silent, unmarked; soul's stub), **dead of age**
(`murder.die`: natural, no case).

| System | What must react | Where |
|---|---|---|
| Input and HUD | Which buttons show; panels pause; no fight buttons while down | `src/ui/*` |
| Senses | Asleep: a third of a cry's reach (the loudest, 0.6) and no eyes; down, carried or dead: neither; held silent (unkindling, a silent killing): their every cry and blow is loudness 0 (`voiceOf`), while eyes still see them | `src/ai/hearing.js`, `src/murder/witness.js` |
| Death states (round 14b) | `unkindled` and `dead of age` lie unmarked (no blood: `rec.unmarked`, `drawBody`); a found body's discovery belongs to the cause's owner (`murder.onFound`) | `src/murder/murder.js`, `src/murder/draw.js` |
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
| Interface size | Desktop panels and HUD are drawn at `--uiz` (1.2 Normal, 1.45 Large); anything that reads pointer positions inside them must divide by its own zoom. The down countdown follows it as far as it fits under the body (`death_view.js place`); the ember-ring's arrow and tag follow it (`polish.css`) | `src/ui/ui_scale.js`, `src/ui/death_view.js`, `src/styles/polish.css` |
| Down on a phone (round 14b) | The countdown and Call for help never share ground with the floating stick's zone: above the body on an upright phone (just under the top cards, however many price chips they hold), the other half sideways (mirrored left-handed); the UI root carries `sv-down` / `sv-lefty` while you are down | `src/ui/death_view.js`, `src/styles/polish.css` |
| Performance | Chunk painting, fog/overlays (one flat wash, not full-screen textures), object updates | `src/render/*`, `src/world/*` |
| Text | Toasts and signs readable at phone size | `src/ui/toast.js` |

## 7. Time, day and night, weather

Values: dawn, day, dusk, night; clear, cloudy, rain, fog; drift-weather (glimmer, the
grey, hollow wind, brightfall); the wilds' own weather (the grey over Brindlecombe, snow
on the Hollowcrown).

| System | What must react | Where |
|---|---|---|
| Spawns | Night-only and day-only zones; bosses that only come out at night | `src/entities/spawner.js`, `src/bosses/*` |
| Light | Lamps, waystones, windows, fires; darkness. Snow keeps cool and pale under a warm dawn or dusk (`snowLight`, where `weather.localSnow` says the ground is snow); a new ground that should not take the sun's colour (ice, salt flats) gets its own path there | `src/render/lighting.js`, `src/world/objects.js` |
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
| Death causes in prompts (round 14b) | A death's `cause` reaches the minds as people know it: `'killed'`, `'age'`, and `'unkindled'` (soul's stub: "no mark on him… like the hollow wind", the village's fear of "the Hollow" through `game.unkindle.briefLine(id)`); offline lines say the same | `src/murder/*`, `src/ai/social/village_prompt.js`, `src/ai/brain/prompt.js` |

## 9. Saves and permadeath

Values: a fresh game, a loaded save (older versions too), the kept flame, home waking,
final death, Settings resets.

| System | What must react | Where |
|---|---|---|
| Save size | Only differences from the generated world; bitsets for big maps (the fog) | `src/world/objects.js` `serialize`, `src/world/travel.js` |
| Old saves | Missing fields default; ids stay stable (object ids are positional, so the vale keeps its coordinates) | everywhere `deserialize` |
| Death modes | The ember-ring, the flame, the end | `src/survival/*` |
| Generated world | Same seed, same world: never move vale objects (saves refer to them by position) | `src/world/worldgen.js` |
| Round 14b blocks | `party` (`{ holderId }`, restored last; old saves derive it from Lyra), `plugins.provenance` (old saves start empty), murder records' `by`, `cause` (old: `'killed'`), `provoked` (old: unknown), `silent`, `unmarked`, `natural`; soul's `unkindle` (`learned`, `tally`) | `src/core/party.js`, `src/world/provenance.js`, `src/murder/murder.js` |
| Death causes | `'killed'`, `'age'` (`murder.die`), `'unkindled'` (soul): each saved on the record and the body (`absent.cause`); a new cause says who owns its discovery (`onFound`) and whether it is a killing (`villager_killed`) or not (`villager_died`) | `src/murder/murder.js` |

## 10. Story branches

Values: hero, villain (round 14b: the stranger who offers power for the village; the pact,
`pact_sealed`, `game.villain.hasPact()`), Lyra with you or gone (or dead), who walks with you
(`game.party.holder`), villagers alive or dead (killed, of age, unkindled), bosses beaten or
not, Owlsend's arrival.

| System | What must react | Where |
|---|---|---|
| Lines and lore | People speak of what you did; the Book records it | `src/ai/*`, `src/lore/*` |
| Missions | Some close, some open with the branch | `src/missions/*` |
| The world | Places that change (a relit wardstone, a lit waystone, an empty house) | `src/world/*` |
| Map and markers | What you know is marked; what is gone is greyed | `src/ui/world_map.js` |
