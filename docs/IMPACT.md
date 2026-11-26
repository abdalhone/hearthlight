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
dark spell from the tempter's pact, DESIGN §37), **coldfire** (soul §13b: the taken flame, a
bar that boosts Sword and Weave power and ebbs, DESIGN §37.9).

| System | What must react | Where |
|---|---|---|
| Finishing blows / kill scenes | Sword build: a slash across the neck; magic build: a bolt in the slotted weave's palette to the head; hybrid: both (`buildOf`: points, the blade in hand, recent blows by kind, slotted weaves). A new weapon or class brings its own finisher (`registerFinisher({ id, score, draw, mark })`, DESIGN §35.2) and its mark on the body; Settings → Finishers full/brief/off; never on a child (`isMinor`) | `src/murder/finishers.js`, `src/murder/murder.js` `strike`, `src/murder/draw.js` |
| Lock-on (round 14b) | Weaves and the sword aim at `game.lock` for every source; a new weapon (a bow) aims at it too; its control on each device (middle mouse, G, R3, a hold on the sword button) | `src/core/lock_on.js`, `src/ui/weaving.js` `aimFor`, `src/entities/player.js` `attack`, `src/ui/touch.js` |
| Locked chests (round 14b) | A Strike or a heavy weave forces a hasp (D10), a lighter blow says "Iron-bound"; a fire weave sets a store alight; a new heavy weapon decides which it is | `src/world/containers.js` `blowAtChest`, `src/world/occupation.js` `fireAt`, `src/magic/magic.js` `hitProps` |
| The Unkindling (`'unkindle'`, round 14b soul) | Learned only from the pact (`pact_sealed`; a magic trial lends it for dummies only), saved; touch range (26 px), the lock first; strength (`powerOf` vs `strengthOf`: easy, close, breaks free; a boss or the tempter only by a hand much stronger, else shrugged off) — a new build or stat that makes you stronger feeds `powerOf`, a new kind of character says its `kindOf` (person, bandit, beast, harmless, boss, undead, dummy); hostile beasts and bandits are prey, not murder (§13b); loudness 0 (`hearing.js` `silence`/`voiceOf`); witnesses by the sight rule; never a child (`isMinor`), never through a wall, never the undead (bats too); F held on desktop, a dark hand on the phone, no pad button yet; the hold plants you (a roll breaks it); the price is that it shows (`mark`, §37.9), never health | `src/magic/unkindle.js`, `src/render/unkindle_fx.js`, `src/murder/unkindled.js`, `src/ui/unkindle_view.js` (soul) |
| Coldfire, the taken flame (round 14b soul §13b) | Each soul taken fills the bar by its strength (a person a lot, a bandit a fair amount, a beast a little), it ebbs 14 a day; a full bar gives Sword and Weave power +30% (a live `stats` provider: never a one-shot on a boss), a faster pull and more power in the strength check. A new damage source reads `atk`/`spellPower` through the pipeline and gets it; a new kind of prey says how much it fills (`FILL`, `TYPICAL`); the HUD bar sits under health in the player card from the first soul, the Character panel shows its numbers | `src/magic/coldfire.js`, `src/ui/coldfire_view.js`, `src/styles/soul.css` (soul) |
| Combat damage and stun | Damage sources (sword arc, weave bodies, beams, future arrows) all go through the hit pipeline; walls stop each | `src/entities/combat.js`, `src/magic/*` |
| Stats, gear, prices | Stat points, gear slots and prices favour the build; a new class needs its stat, its gear and its prices. A new price is played in `scripts/price_sim.mjs` beside no price (round 14b: each gives more in a short fight and costs in a long one). Points follow one diminishing curve (round 14b, DESIGN §26): a new attribute or effect needs its soft cap in `ATTRS[id].cap` and a `main` effect for the sheet's "Next:" line (`tests/stat_curve.test.mjs` fails without them, and holds 50→70 > 3 × 180→200); a new source of speed (gear, potion, surge, price, a mount) is a pct on the pipeline and meets the speed knee (130 → 170 px/s), so check it with everything else stacked in `scripts/stats_check.mjs` | `src/progression/attributes.js`, `src/core/stats.js` (`STATS.speed.knee`), `src/ui/character_view.js`, `src/gear/*`, `src/magic/prices.js` |
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
| Walking pace | Snow, scree, heather and fords slow you (`SPEED`); a new ground gets a pace. It acts after the speed ceiling (DESIGN §26), in full; a ground that speeds you up (ice, a road bonus) would bypass the ceiling, so fold it into the pipeline instead | `src/world/tiles.js` `speed` |
| Footsteps | Each ground has its sound (`surfaceAt` → `step_<surface>`); a new ground picks one or adds a recipe | `src/world/footsteps.js`, `src/ui/sfx.js` |
| Pathfinding cost | Roads cheap, rough ground dearer (`cost`); solid and water block | `src/world/tiles.js`, `src/world/pathfind.js` |
| Ground art | A texture (`world_textures.js`), blending prio, the map chart color | `src/art/*`, `src/ui/world_map.js` |
| Weather on the ground | Rain soaks it (wet twin), puddles, reflections | `src/world/map.js`, `src/art/tiles_art.js` |
| Particles | Dust on dry ground, splashes in water, puffs in snow | `src/world/footsteps.js`, `src/entities/player.js` |
| Death and crawling | Blood smear and the ember-ring on each ground; drowning in deep water | `src/survival/*` |
| Kill scenes | Where the body falls (water, snow, floor): the dried stain and the finisher's mark are drawn on the ground under it, whatever the ground (round 14b) | `src/murder/draw.js`, `src/murder/finishers.js` |
| Blows across low ground (round 14b) | Rubble stops a blade or claws but not an arrow (`walls.BLOCKS_BLOW`); a new low obstacle (a fence, a cart, a hedge) says which it is | `src/world/walls.js` `blowTile`, `canReach({ melee })` |
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
bandits), **the faithful** (soul §13b: Aveline, keeper of the family flames; those who pray at
the chapel, Wenna and Bram; the superstitious, Corran: they read the cold signs as "the cold
that takes"; everyone else finds them odd), **companions** (anyone adult, `game.party`: the role is `game.party.holder`, Lyra
at a new game, nobody when you walk alone; `game.companion`/`game.lyra` stay Lyra the
person); **merchants** (Garrick, Bram, Mira, Elda: tastes, a daily stock, a purse, a haggle a
day; `src/world/trade.js`); **visitors** (round 14b: the tempter Isembard, `profile.visitor`:
talkable, never one of the eighteen, never in the Moot, errands or markGone); **the Moot's
jurors** (the chair and the living heads, at most 7); *future*: travellers, Owlsend's
survivors, new villagers.

| System | What must react | Where |
|---|---|---|
| Lines and voice | Every character's own words for a new event (barks, dialogue, Claude persona) | `src/ai/social/*`, `src/entities/npc_data*.js` |
| Knowledge and rumors | What they know of places and bosses (`TRAILS.tellers`, `ROAD_TALK`, facts) | `src/world/boss_trails.js`, `src/entities/npc_data*.js` |
| Killability and crimes | Adults can be killed (Lyra and any companion included: `murder.isPerson`, `canKill`), children (`isMinor`) cannot; theft and assault are crimes others learn of by eyes or by meeting someone who knows (theft only if seen, D10; never an assault); every death records `by`, `cause`, `provoked` (DESIGN §35.1); a death nobody did goes through `murder.die` (no case, no alarm). A new kind of person says what they carry (`carry_data.js`), who inherits their work (`HEIRS`), and who gives their missions (`STAND_INS`) | `src/murder/*`, `src/world/containers.js`, `src/core/people.js` |
| Fighting back (round 14b) | The watch, Hess and the defenders (`DEFENDER_COMBAT`: Bram, Tobias, Garrick, Sabeth, Tilly; 17–65, not terrified) fight only someone they know did it; the posse hunts from where the killer was last seen; a new character says whether they defend and with what | `src/entities/defenders.js`, `src/entities/npc.js` `helpRole`/`onCrime`, `src/murder/hunt.js` |
| Children (round 14b) | Hide at home from a stranger they know to be a killer; taken away (kin or a carter) when every grown person of their household is dead; never hurt; their missions pass on | `src/world/occupation.js`, `src/murder/grief.js` `standIn` |
| A dead Lyra (round 14b) | Her body lies like anyone's (searched for her pack, lifted); she learns nothing more; her parents mourn a month; her missions close; her trunk is her mother's | `src/murder/lyra.js`, `src/murder/murder.js` `stillBody`, `src/missions/system.js`, `src/world/containers.js` |
| The companion role (round 14b) | Any adult may hold it (`party.canHold`; children never). Built: the HUD slot (`companion_view.js`, nothing when alone), the Ask bar and Alt+1..5 (`party.ask`), the edge badge, the map dot, People (`people_panel.js`), missions that ask them along (`askCompanion`), boss fights (`companionJoins`), the bag's gifts, the Oath price, the carry home, sleep, the catch-up watchdog, follow and fight on foot (`CompanionDuty`), leaving (bedtime, hurt, fear, a blow), stand-ins when they die (blood). A new kind of person says whether `canHold` takes them, writes their lines in `npc_companion_lines.js` and their fight ability (`fightAbility`) | `src/core/party.js`, `src/entities/npc_companion.js`, `src/entities/npc.js` (`duty`, `startFight` anchor and leash), `src/ui/companion_view.js` |
| Reading the cold signs (round 14b soul §13b) | Each person's suspicion comes only from what they see (`sight.js`) or feel (a touch in an act, tending you); faith weighs it (`faithOf`: Aveline most, those whose day has `'pray'`, the superstitious; the ordinary are capped below the asking and ask if you are ill); worry travels by meeting only to the faithful and the teller's friends. A new character with faith in their profile is read the same way; a child is never part of it | `src/society/dark_suspicion.js` |
| Senses | Every eye and ear goes through one rule each: sight (`src/ai/sight.js`) and hearing (`src/ai/hearing.js`: walls muffle, a cry tells what and where, never who; a beast's snarl is a what, a person a who). A new kind of character (a deaf one, a hound) gets its exception there, as Wenna's blindness does in `witness.js` | `src/ai/sight.js`, `src/ai/hearing.js`, `src/entities/npc.js` |
| Ownership | Their beds, chests and keys (`owner`, `keeper`, `keyId`) | `src/world/containers.js`, `src/world/objects.js` |
| Combat and AI | Fight back, flee, stun, finishers per body size; creatures notice and wind up only with a sight line and a blow that can land (round 14b); bosses stagger then are proof a while; mission leaders resist part of a stun | `src/entities/*`, `src/bosses/*` |
| Footsteps and crawling | Others' steps near you; the downed crawl for anyone | `src/world/footsteps.js`, `src/survival/*` |
| Missions | Givers, turn-ins, foes that scale with your level (`toughen`) | `src/missions/*` |
| Age | Everyone grows a year older on their birthday (`game.calendar`, at the pace of Settings → "A year lasts"); who is a child is decided by age (`isMinor`, under 16; the build only when the age is unknown): `text.isChild`, Lyra's `protectWorth`, the errands' `CHILDREN`, grief's `toneFor` all go by age; looks follow the years (`src/art/age_look.js`: greying, lines, a stoop, a child's build grown; painted once per stage as `id~key`, portraits follow `spriteKey`); a grown child gets a grown body; the dead stop aging; the very old may die of age (`src/world/aging.js` → `murder.die`); a new character needs a base age and an appearance | `src/world/calendar.js`, `src/core/people.js`, `src/art/age_look.js`, `src/world/aging.js` |
| Trade | Who buys what and at what share (`TASTES`), their extra wares and daily stock (`WARES`, `DAILY`, the village's errand stock where it names the item), their purse (`PURSE`), haggling (`TASTES.haggle`), stolen goods (`provenance`), one graded refusal (`stance`: a burned store (blood's `occupation.shopClosed`), kin never, fresh blood not for three days, then a blood price, the Butcher none but Garrick's fence; read by the shop, the dialog and `village.standing().refusesTrade` alike; a frightened merchant keeps Trade on the list). A new merchant gets a row in each table, never a profile edit | `src/world/trade.js`, `src/ui/dialog.js`, `src/entities/npc_dialogue.js` |
| Reputation (round 14b) | What each person calls the stranger, from what they know (`reputation.titles({ knownTo })`): killings known, an Unkindling only once known, thefts seen, lies caught, oaths, rescues; titles spread as rumours by meeting and reach the road after two days. A new kind of deed says who knows it | `src/society/reputation.js` |
| The map | The holder's dot (`kind: 'companion'`, Lyra only while she walks with you), none alone; opens on you, zoomed out until the ember-ring or the objective shows; bosses once heard of | `src/ui/world_map.js` |

## 5. States

Values: walking, running, rolling, fighting, casting/charging, fallen (down, crawling,
bleeding out), carried, sitting, sleeping, dead (kept flame, home waking, final), last
stand (round 14 D4), talking (a panel open), in a cutscene, trading. Round 14b: **locked
on** (blood), **saying aloud** (talk), **parting scene** (talk), **on duty** (an NPC holding
the companion role: mode `'duty'`), **held silent** (`hearing.js` `silence`: no sound at
all), **unkindling** (the player channelling the Unkindling; the target held and silent),
**unkindled** (a body with no mark: dead, silent, unmarked; soul's stub), **dead of age**
(`murder.die`: natural, no case). Party (built): **walking alone** (no holder: no card, no
Ask bar, no badge, no map dot), **waiting** / **fighting beside you** (a villager's duty),
**dead Lyra** (nothing of hers runs; the role released; People a memorial; §34.6). Blood (round 14b): **winded** (Lyra after running from
you a while), **hiding** (a child at home from a known killer), **taken away** (a child of
an emptied house: `absent.cause 'taken_away'`), **searched** (a body), **burned** (a store),
**claimed** (a house), **hunted** (a posse searching from where you were last seen), **news
waiting** (a body found but not yet known to the village). Society: **failing** (abed at home before a death of age),
**deliberating** (the Moot weighing a defence: `case.trial.state`, saved), **mercy** (a lighter
sentence: one day outside), **haggled** and **sold out** (a merchant's day), **pact** (sealed
before or after; betrayed), **fighting the tempter**. Soul: **cold signs** (soul §13b: coldfire's tier, faint / clear /
strong, on the player), **known dark magic** (a person who knows you use it: wary, asked you
to stop; never a crime), **asking** (a faithful NPC on her way to you or waiting on your
answer: a duty step).

| System | What must react | Where |
|---|---|---|
| Input and HUD | Which buttons show; panels pause; no fight buttons while down | `src/ui/*` |
| Senses | Asleep: a third of a cry's reach (the loudest, 0.6) and no eyes; down, carried or dead: neither; held silent (unkindling, a silent killing): their every cry and blow is loudness 0 (`voiceOf`), while eyes still see them | `src/ai/hearing.js`, `src/murder/witness.js` |
| Death states (round 14b) | `unkindled` and `dead of age` lie unmarked (no blood: `rec.unmarked`, `drawBody`); a found body's discovery belongs to the cause's owner (`murder.onFound`) | `src/murder/murder.js`, `src/murder/draw.js` |
| The Unkindling's hold (round 14b) | `unkindling`: the target held (no walking, no wind-up, silent, facing you), the player standing with a raised hand; any of a hit, a fall, a shove, distance, a wall, a panel or letting go ends it (known past 15%); a save never keeps it; reduce motion draws the still version. A new state that moves or hides an actor (carried, hidden, a cutscene) must end a hold on them | `src/magic/unkindle.js`, `src/render/unkindle_fx.js` |
| Cold signs (round 14b soul §13b) | Faint: breath that fogs at night, ice-cold hands (to a touch or to whoever tends you). Clear: flames lean from you and gutter (this frame's light only), hens and the cat shy (`creature.scare`), frost in your footprints at night. Strong: a cold glint in your eyes at night, a shadow slow to follow, the flowers by your bed wilt. They come on over days (`settled`) and leave over weeks; a still version under reduce motion. A new light source must be a `getLight` light (it then leans); a new tame animal joins `SHY_SPECIES`; a new sleep spot for the player may want its own flowers | `src/render/soul_signs.js`, `src/magic/coldfire.js` |
| Footsteps and pace | Steps only while walking; crawling is slower and smears | `src/entities/player.js`, `src/survival/*` |
| Spawns and AI | Creatures do not spawn in view; foes leave the fallen to the bleed-out | `src/entities/spawner.js` |
| Travel | Places are reached and the map's fog lifts only while you move about | `src/world/travel.js` |
| Missions | Objectives that need you standing, awake, at a place, at an hour | `src/missions/*` |
| Saves | What is saved mid-state (down, carried, asleep) | `src/core/save.js`, `src/survival/*` |
| Talk (round 14b) | Only the body keeps words from someone: dead, downed or unconscious, a cutscene, out of earshot, a wall (`chat_target.whyNotHeard`); asleep they still get the words. A new state that should keep someone from hearing is a body's state and goes there, never a feeling. Saying aloud reaches whoever the hearing rule lets hear it; the parting scene holds Lyra's body (her keep-away steps aside) and ends if the player walks 8 tiles off | `src/ui/chat_target.js`, `src/ai/social/village.js`, `src/ai/mind/autonomy_parting.js` |
| Sleep | Any hour, any bed that is nobody's; never while down, carried, fighting or burning (the last stand); the clock's jump moves promises' due times and turns the calendar before the save | `src/world/rest.js`, `src/core/game.js` `sleep` |

## 6. Devices

Values: **phone upright** (about 390×640–844), **phone sideways** (about 844×340–390),
**desktop** (1280×720 and up, mouse and keyboard), **pad** (gamepad); touch vs mouse;
slow phones (test at 4× CPU throttle).

| System | What must react | Where |
|---|---|---|
| Panels | Fit the screen, a ✕ of at least 44 px, close by tap outside, finger-sized controls | `src/ui/*`, `scripts/phone_check.mjs` |
| Controls | Every action reachable by touch, by keys (and the map's N), by pad | `src/core/input.js`, `src/ui/touch.js` |
| Talk controls (round 14b) | No tap or click on a person opens talk; T / Enter / pad Y and the Talk buttons talk to whoever is in front (`ui.talkToNearest`); the phone's round button names the person ("Talk to Bram") and opens the chat to them; a villager within reach gets "Trade · Give · Work" (44 px) | `src/ui/ui.js`, `src/ui/touch.js`, `src/ui/chat.js`, `src/ui/chat_target.js` |
| The map | Drag, pinch, wheel, +/−; tools over the chart on a phone held sideways; with a mouse the panel is zoomed (Interface size), so pointer math divides by the canvas's zoom | `src/ui/world_map.js` |
| Interface size | Desktop panels and HUD are drawn at `--uiz` (1.2 Normal, 1.45 Large); anything that reads pointer positions inside them must divide by its own zoom. The down countdown follows it as far as it fits under the body (`death_view.js place`); the ember-ring's arrow and tag follow it (`polish.css`), and the arrow's gap from the mission line and cards grows with it (`ember_ring_view.js hudClear`) | `src/ui/ui_scale.js`, `src/ui/death_view.js`, `src/ui/ember_ring_view.js`, `src/styles/polish.css` |
| Down on a phone (round 14b) | The countdown and Call for help never share ground with the floating stick's zone: above the body on an upright phone (just under the top cards, however many price chips they hold), the other half sideways (mirrored left-handed); the UI root carries `sv-down` / `sv-lefty` while you are down | `src/ui/death_view.js`, `src/styles/polish.css` |
| Performance | Chunk painting, fog/overlays (one flat wash, not full-screen textures), object updates | `src/render/*`, `src/world/*` |
| Text | Toasts and signs readable at phone size | `src/ui/toast.js` |
| The Unkindling's control (round 14b) | Desktop: F held, a dark hint above the hotbar while someone is in reach; phone: a dark hand in the right-thumb cluster (44 px, left of the dodge, mirrored for a left hand), only while it is known and someone it may take is in reach; a new cluster button must keep clear of it (`handSpot`); its fx at 4× CPU is measured by `scripts/soul_check.mjs` | `src/ui/unkindle_view.js`, `src/styles/soul.css` |

## 7. Time, day and night, weather

Values: dawn, day, dusk, night; clear, cloudy, rain, fog; drift-weather (glimmer, the
grey, hollow wind, brightfall); the wilds' own weather (the grey over Brindlecombe, snow
on the Hollowcrown).

| System | What must react | Where |
|---|---|---|
| Spawns | Night-only and day-only zones; bosses that only come out at night; the tempter at the ruins gate from 20:30 to 05:00 | `src/entities/spawner.js`, `src/bosses/*`, `src/story/villain.js` |
| Days and seasons (round 14b) | A night slept through midnight is a `new_day` like any other (once per day crossed: `clock.skipTo`, `skipDays`); the year is four seasons, each early, mid and late (`calendar.season()`, `dateLabel()`), day 1 early autumn; the morning restocks the shops and tops up purses; old age comes in the small hours | `src/core/time.js`, `src/world/calendar.js`, `src/world/trade.js`, `src/world/aging.js` |
| Light | Lamps, waystones, windows, fires; darkness. Snow keeps cool and pale under a warm dawn or dusk (`snowLight`, where `weather.localSnow` says the ground is snow); a new ground that should not take the sun's colour (ice, salt flats) gets its own path there | `src/render/lighting.js`, `src/world/objects.js` |
| Missions | `when` windows (evening, night) | `src/missions/*` |
| Footsteps and ground | Wet ground after rain | `src/world/map.js` |
| Lines | People speak of the weather and the hour | `src/ai/*` |
| The Hollow (round 14b) | With two no-mark deaths found the grown keep home after 20:30 and the watch walks the night (Rowan to midnight, Wys after); the Unkindling's drain and guttering lamps read at night and by day; Aveline learns a death's hour at her next rite in the chapel | `src/murder/unkindled.js` (`entryFor`), `src/render/unkindle_fx.js` |
| The cold signs and the asking (round 14b soul §13b) | Breath, the eye glint and frost in your steps show at night (drawn over the night's light); flames lean whenever lit; the faithful come to ask only by day (8:00–19:00) and in private; the bar ebbs and the mark settles and fades by the clock, sleep included | `src/render/soul_signs.js`, `src/society/dark_suspicion.js`, `src/magic/coldfire.js` |

## 8. Claude online or offline

Values: Claude (in the claude.ai Artifact or with a key), the offline mind.

| System | What must react | Where |
|---|---|---|
| Every mind and line | Works offline with local lines; online gets the same facts in its prompt | `src/ai/*`, `src/platform/claude_runtime.js` |
| Prompt context | Plugins' `promptContext` (missions, travel: where you are in the wider world) | `src/ai/plugins/*`, `src/world/travel.js` |
| Trials and judgement | Round 14b: one quick Claude call per juror (at most 7, in parallel, one 25 s budget), each with only their own brief (`jury.jurorBrief`); late or offline jurors weigh it by local rules (`localJuror`, deterministic); a caught lie counts only if that juror knows the fact (`checkClaim().knownBy`). The tempter speaks through his own rules online, his own lines offline; the pact is the game's decision | `src/murder/jury.js`, `src/murder/defence.js`, `src/story/villain.js` |
| Talk (round 14b) | Fear, silence and acts reach Claude in the brief (terror, dread, "They do: *…*", cut ties, uneasy, the other workstreams' `briefLine`s); offline every one has its own lines (fear banks, `gone_reply`, act reactions, more shrugs). Saying aloud is ONE batched quick call for up to four, else local; her farewell waits 15 s for Claude, else her own words | `src/ai/social/village_prompt.js`, `src/ai/social/acts_effects.js`, `src/ai/brain/prompt.js`, `src/ai/mind/autonomy_parting.js` |
| Dates, ages and names in prompts | `calendar.briefLine(id)` (the date, their age, a birthday) and `reputation.titles({ knownTo })` reach every villager's task (talk's `sayBrief`) and Lyra's; a death of age reads "died of old age", never "murdered" | `src/world/calendar.js`, `src/society/reputation.js`, `src/murder/lyra.js` |
| Death causes in prompts (round 14b) | A death's `cause` reaches the minds as people know it: `'killed'`, `'age'`, and `'unkindled'` (`game.unkindle.briefLine(id)`: only what that person saw, was told or can feel — one, two ("the Hollow"), three ("the Moot is frightened") no-mark deaths they know of; the stranger as the Unkindler only once they saw it or heard it from one who did; the cold signs only as they perceived them, never "souls"; known dark magic as "dangerous, not evil"; during Aveline's asking only her knowledge and the verdict the game decided first); offline the finder, Mira, Aveline and the frightened say it in their own barks, and Aveline her verdicts | `src/murder/unkindled.js`, `src/ai/social/village_prompt.js`, `src/ai/brain/prompt.js` |

## 9. Saves and permadeath

Values: a fresh game, a loaded save (older versions too), the kept flame, home waking,
final death, Settings resets.

| System | What must react | Where |
|---|---|---|
| Save size | Only differences from the generated world; bitsets for big maps (the fog) | `src/world/objects.js` `serialize`, `src/world/travel.js` |
| Old saves | Missing fields default; ids stay stable (object ids are positional, so the vale keeps its coordinates). Stat points are stored as counts by attribute id and what they add is worked out on load (round 14b: old saves simply follow the curve, no respec) | everywhere `deserialize`, `src/progression/progression.js` |
| Death modes | The ember-ring, the flame, the end | `src/survival/*` |
| Generated world | Same seed, same world: never move vale objects (saves refer to them by position) | `src/world/worldgen.js` |
| Round 14b blocks | `party` (`{ holderId }`, restored last; old saves derive it from Lyra), `plugins.provenance` (old saves start empty), murder records' `by`, `cause` (old: `'killed'`), `provoked` (old: unknown), `silent`, `unmarked`, `natural`; soul's `plugins.unkindle` (`learned`, `learnedFrom`, `tally`, `deaths`, `attempts`, `prey`, `coldfire` {bar, mark, settled, taken}, `suspicion` {per person: s, signs, told, dark, asked, askedStop, fear}, the village's `knowers`, the Hollow's rumour; a hold or an asking in progress is never saved; old saves: nothing learned, an old `mark` carries over) and its fields on the murder record (`flame`, `mystery`, `miraSaw`, `seenSoul`, `soulRumor`, `linked`, `knownKilling`, `knownBy`) | `src/core/party.js`, `src/world/provenance.js`, `src/murder/murder.js` |
| Death causes | `'killed'`, `'age'` (`murder.die`), `'unkindled'` (soul): each saved on the record and the body (`absent.cause`); a new cause says who owns its discovery (`onFound`) and whether it is a killing (`villager_killed`) or not (`villager_died`) | `src/murder/murder.js` |
| Blood's blocks (round 14b) | `murder.hunt` (last seen, posse, reports, state), records' `loot`, `searched`, `finisher`, `newsWaits`/`caseWaits`/`mournedBy`, `lyraSawCarry`; a dead Lyra's record (her body re-laid after the companion's own load); what each body carries in its own inventory; plugin `occupation` (burns, claims, children taken, the fallen village); chests' `missingSince`; villagers' `uneasy`, `missingGoods`, `hideUntil` (the day's only); `flags.finisherWarnedLyra`; Settings `finishers`. The lock is not saved | `src/murder/*`, `src/world/occupation.js`, `src/world/containers.js`, `src/entities/npc.js` |
| Society blocks (round 14b) | `plugins.calendar` gains `yearDays`, `anchors`, `player` (an old save reads at twelve days, no anchors); `plugins.aging` (`failing`, `toFind`); `plugins.trade` (the day's haggles, stock, paid); `plugins.reputation` (oaths, heroes, when titles were first known); `plugins.villain` (the pact, kills, warned, ending); `case.trial` (defence, claims, votes, sentence) and `trialPending.deliberating` (a reload resumes the Moot without asking again). The villain ending closes the life (`save.closeLife`, an end page); the hero ending continues it | `src/world/*.js`, `src/society/reputation.js`, `src/story/villain.js`, `src/murder/grief.js` |

## 10. Story branches

Values: hero, villain (round 14b: the stranger who offers power for the village; the pact,
`pact_sealed`, `game.villain.hasPact()`), Lyra with you or gone (or dead), who walks with you
(`game.party.holder`), villagers alive or dead (killed, of age, unkindled), bosses beaten or
not, Owlsend's arrival.

| System | What must react | Where |
|---|---|---|
| Lines and lore | People speak of what you did; the Book records it | `src/ai/*`, `src/lore/*` |
| Missions | Some close, some open with the branch | `src/missions/*` |
| The world | Places that change (a relit wardstone, a lit waystone, an empty house; round 14b: a burned store, a claimed house, the fallen village `occupation.emptied()`) | `src/world/*`, `src/world/occupation.js` |
| The law (round 14b) | Wanted is per knower (a guard fights or arrests only if he knows); the hunt goes to where you were last seen; a found body is the village's news by meeting, or the bell within the hour | `src/entities/combat.js` `knowsCrime`, `src/survival/rescue.js`, `src/murder/hunt.js`, `src/murder/murder.js` |
| Map and markers | What you know is marked; what is gone is greyed | `src/ui/world_map.js` |
| The villain path (round 14b) | The tempter waits at the ruins gate at night once a boss falls or a killing is known; the pact (`pact_sealed { gifts: [..., 'unkindle'] }`, `villain.hasPact()`) before (everything now, a debt) or after (the Unkindling now, the rest when the village is empty); kills count from `villager_killed` only, once known as killings; children never counted or required; endings: villain (the village's adults gone: `occupation.emptied()` when blood provides it; the life closes) or hero (warn the watch, fight him: he comes apart; Oathbreaker if a pact was broken; the save goes on) | `src/story/villain.js`, `src/story/tempter_data.js` |
| The trial | A verdict emerges from the jurors' votes (guilty, not proven, mercy: a lighter sentence); the reasons are spoken; `moot_verdict` carries the votes; Lyra's `onVerdict` gets them | `src/murder/grief.js`, `src/murder/jury.js`, `src/murder/scenes.js` |
| Reputation | Titles (the Butcher of Hearthvale, the Unkindler, Oathbreaker, thief, liar, the one who kept the ward) shape merchants (`trade.stance`), villagers' prompts and the road's word | `src/society/reputation.js` |
| The Unkindling (round 14b) | The pact's gift; an unseen Unkindling is a mystery (no case, the Hollow), counted for the tempter and reputation only once linked (`killing_known`, `rec.knownBy`); one seen links every death by meeting and reopens their cases (the trial's counts); a failed one is known by the victim, who fights or tells | `src/murder/unkindled.js`, `src/magic/unkindle.js` |
| Known dark magic (round 14b soul §13b) | Taking beasts and bandits is prey, not murder; anyone who sees it (or hears it by meeting, the `'dark_magic'` rumour) knows you use dark magic: dangerous, not evil (opinion a few points, wariness, a request to stop, Aveline's rite at the chapel flame); stopping fades it all ("You're warmer"), going on turns worry to fear; never a crime, a case or a hunt. A person unkindled and seen or linked stays murder. The pact's end (§13c) leaves the Unkindling learned and the bar and signs as they are | `src/society/dark_suspicion.js`, `src/magic/unkindle.js` |
