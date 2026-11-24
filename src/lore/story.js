// The story of Hearthlight: the world of Halcyre, the village of Hearthvale, its people and
// Lyra's life from her birth until the day the game begins. This is the author's canon
// (docs/LORE.md) in the STORY shape of DESIGN §17.1. The lorebook (lorebook.js), Lyra's
// life memories, what she knows, who she can learn things from, the mysteries she chases,
// the cutscenes and The Book of Halcyre (src/story/*, DESIGN §20) are all built from it.
//
// ---------------------------------------------------------------- the shape
//
// export const STORY = {
//   placeholder: false,            // true only for the old stand-in story
//   title: 'Hearthlight',
//   premise: string,               // two sentences: the book's opening blurb
//   world:    [{ id, title, text, tags: [string], aliases: [string],
//                knownBy: ['everyone'] | ['lyra', npcId, ...], secret: bool }],
//   timeline: [{ id, when, title, text, tags }],          // oldest first ('Beyond counting' → 'Now')
//   places:   [{ id, locationId, title, text, tags, knownBy }],
//   people:   [{ id, npcId|null, name, title, text, tags, knownBy }],
//   lyraLife: [{ id, age, title, text, people: [ids], places: [locationIds],
//                feeling: emotion name, importance: 1..10 }],   // birth → today, oldest first
//   mysteries:[{ id, question, clues: [{ text, foundAt }], truth, knownBy: [ids] }],
// };
// export const STORY_VILLAGERS   // the eighteen villager ids
// export const BOOK_CHAPTERS     // the Book of Halcyre's chapters (see the end of the file)
//
// Ids are stable: saves, the lorebook and other modules refer to them. Every entry text is
// short (one to four sentences, at most about 350 characters; a mystery's `truth` runs
// longer) and plain enough to be read aloud or shown on a phone-width page.
//
// The same text is shown in the Book and spoken by Lyra offline (mind/voice.js firstPerson
// and toListener turn "Lyra" into I/me/my and "the stranger" into you/your). So a text she
// may tell names her as "Lyra" (never "she" or "her" for her), names the player as "the
// stranger" (never "they" or "them", except in entries tagged 'player', which speak of the
// stranger alone), and writes the name of the lamplighter's star in quotes: 'Lyra'.
// lyraLife is already in her own words (first person).
//
// - world: what people know of Halcyre: the Drift and its weathers, wards, magic, dungeons,
//   the other villages, Hearthvale's customs, laws, worries and talk. Tags group them:
//   'drift', 'ward', 'magic', 'dungeon', 'village', 'hearthvale', 'law', 'customs',
//   'festival', 'history'.
// - timeline: LORE §4, the history people know, with `when` as said in the valley.
// - places: one per map location (locationId is a location id from src/world/locations.js;
//   several entries may share one, e.g. the ruins outside and in).
// - people: the eighteen villagers (npcId set), then the absent and the dead (npcId null).
//   `title` is a role ("the lamplighter"). The text is the village's version of them.
// - lyraLife: her life in her own words (first person), LORE §7.
// - mysteries: LORE §9. `clues[].foundAt` is a villager id, a location id, an item id or a
//   story beat ('maren_journal', 'waygate', 'ruins_carvings', 'garrick_alone', ...).
//   `truth` is the author's: never indexed, searched, spoken or shown until the game
//   reveals it. `knownBy` names who holds that truth in full (usually nobody; never Lyra).
//
// Who knows what (LORE §9.10) is the rule this file is written around:
// - knownBy: 'lyra', 'everyone', or villager ids. Anyone listed may tell it to anyone, so
//   world, place and people entries hold only what their knowers could say aloud. A
//   person's text is the village's version of them, never their secret.
// - A character secret that Lyra does not know never appears here as an entry: a villager
//   who knows it would tell her once they were close (recollection.loreFrom). Those live
//   on the villagers' facts with `knownBy` / `hiddenFrom: ['lyra']` (npc_data*.js).
// - entries with `secret: true` are things only their knowers say, and only to people they
//   are close to (familiarity 45 and up).
//
// Canon since DESIGN §19.7: Hearthvale is Lyra's home and she never leaves it. If the
// stranger hurts her past forgiving she cuts them out of her life and lives with her
// parents at the chandlery (her room at the Kettle is hers too), and the village stands
// with her. The road to Saltmere and the waystones is a dream, never a departure.

// The eighteen villagers of Hearthvale (DESIGN §7, §19.1).
const VILLAGE = [
  'bram', 'elda', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick',
  'hobb', 'wenna', 'hess', 'sabeth', 'alder', 'petra', 'tilly', 'tansy', 'corran', 'wys',
];
// Common knowledge in the valley: every villager, and Lyra, who was born here.
const ALL = ['everyone'];

export const STORY = {
  placeholder: false,
  title: 'Hearthlight',
  premise:
    "Halcyre is a world of loose magic where people live close together inside wards, because the open land is not safe. Every village is a lamp in a large dark room. In the village of Hearthvale lives Lyra Ambrel, the lamplighter's daughter and a lumencrafter, who lives her own life by her own light; three months ago her teacher Maren walked into the Sunken Ruins, and two days later Lyra carried a stranger down from a mountain.",

  world: [
    // ---------------------------------------------------------------- the world
    { id: 'halcyre', title: 'Halcyre', text: "The world's name, older than any kingdom: Lanternwright speech for 'the lit hall'. They kept its lamps burning. Then the lamps went out, and now the light lives only in small, kept places.", tags: ['world', 'history', 'lanternwrights'], aliases: ['the lit hall', 'the world'], knownBy: ALL, secret: false },
    { id: 'lowmarch', title: 'The Lowmarch', text: "The long middle country the King's Road crosses from the sea to the mountains: valleys, forests, moors and marshes, with villages scattered through it like coals in a dark grate. About thirty still keep a ward.", tags: ['world', 'geography'], aliases: ['the March', 'Lowmarch'], knownBy: ALL, secret: false },
    { id: 'crownfells', title: 'The Crownfells', text: 'A wall of grey mountains to the north. Their nearest and highest peak, the Hollowcrown, can be seen from Hearthvale\'s square on a clear morning, its broken summit white even in summer.', tags: ['world', 'mountains', 'north'], aliases: ['the mountains', 'Crownfells'], knownBy: ALL, secret: false },
    { id: 'hollowcrown', title: 'The Hollowcrown and the Crown Ring', text: "A day and a half's climb north, by a path that starts in Whisperwood. On its shoulder stands the Crown Ring: nine broken standing stones carved with Lanternwright script, in snow even at midsummer. Hearthvale calls it a dead waygate.", tags: ['mountains', 'waygate', 'stranger', 'north'], aliases: ['Hollowcrown', 'the Crown Ring', 'the stone ring', 'the ring on the mountain', 'the mountain'], knownBy: ALL, secret: false },
    { id: 'other_end', title: '"The other end"', text: "Maren's notes and star charts called the Crown Ring on the Hollowcrown \"the other end\". That is why, the morning after Maren went into the ruins, Lyra paid Hess to guide the climb.", tags: ['maren', 'waygate', 'hollowcrown'], aliases: ['the other end', "Maren's notes", 'star charts'], knownBy: ['lyra', 'hess', 'aveline'], secret: false },
    { id: 'pale_reach', title: 'The Pale Reach', text: 'The land beyond the Crownfells: snow, aurora and silence. Most maps do not bother to draw it, and the King\'s Road gives up long before it gets there.', tags: ['north', 'world'], aliases: ['the Reach', 'the far north', 'the Pale'], knownBy: ALL, secret: false },
    { id: 'lanternwrights', title: 'The Lanternwrights', text: 'The mage-builders of the deep past. They sang their workings into stone and raised the wardstones, the waystones and the waygates. They vanished at the Unlighting; their script survives on ruins, and their stone still hums.', tags: ['history', 'magic', 'ruins'], aliases: ['Lanternwright', 'the old builders', 'the Lanternwright script'], knownBy: ALL, secret: false },
    { id: 'the_song', title: 'The Song and the Unlighting', text: "The Lanternwrights held the world's magic still in one great working, the Song. About a thousand years ago it broke: the Unlighting. Nobody knows why. The magic spilled over the land and ran down into the dungeons.", tags: ['history', 'magic', 'drift'], aliases: ['the Song', 'the Unlighting', 'the old Song'], knownBy: ALL, secret: false },
    { id: 'waygates', title: 'Waygates', text: 'Great stone rings of the Lanternwrights that once crossed the world in a single step. Most are dead stone now. Maren spent half her life studying them, and could read a little of their script.', tags: ['magic', 'travel', 'maren', 'waygate'], aliases: ['waygate', 'the old waygate', 'gate ring', 'stone ring'], knownBy: ['lyra', 'aveline', 'bram', 'hess'], secret: false },

    // ---------------------------------------------------------------- the Drift
    { id: 'the_drift', title: 'The Drift', text: "Loose magic, moving over the open land the way weather does since the Song broke. It is not evil; it is not anything. It changes what it touches. Nobody lives in the Drift for long, so people live inside wards.", tags: ['drift', 'magic', 'weather'], aliases: ['Drift', 'drift-weather', 'the loose magic'], knownBy: ALL, secret: false },
    { id: 'glimmer', title: 'Glimmer', text: 'The mildest drift-weather: a sparkling haze at dusk that makes lamps burn blue and dogs howl. It does little harm, and children love it.', tags: ['drift', 'weather'], aliases: ['the glimmer'], knownBy: ALL, secret: false },
    { id: 'the_grey', title: 'The grey', text: 'A drift-fog that makes things forget themselves. Fences forget to stand, people forget errands and names, and if it lasts long enough they forget why they kept their hearths lit. A long grey is how villages die.', tags: ['drift', 'weather', 'greywinter'], aliases: ['grey', 'a grey', 'the grey fog'], knownBy: ALL, secret: false },
    { id: 'hollow_wind', title: 'Hollow wind', text: 'A dry, cold drift-wind that steals warmth. It puts out candles and chills the blood, and leaves the strong shivering and the weak dead in their beds.', tags: ['drift', 'weather'], aliases: ['the hollow wind', 'hollow-wind'], knownBy: ALL, secret: false },
    { id: 'brightfall', title: 'Brightfall', text: 'The strangest drift-weather: light that falls like snow on still winter nights. Where it settles, odd things grow. Flowers bloom in frost, and beasts give birth out of season. Sometimes people do too.', tags: ['drift', 'weather', 'brightborn'], aliases: ['the Brightfall', 'brightfall winter'], knownBy: ALL, secret: false },
    { id: 'the_turning', title: 'The turning', text: "The Drift's effect on animals. Turned wolves grow bold and hunt in bigger packs; turned boars grow vicious; still water left in drift-weather thickens and crawls away as a slime.", tags: ['drift', 'wolves', 'boars', 'slimes'], aliases: ['turned wolves', 'turned beasts'], knownBy: ALL, secret: false },

    // ---------------------------------------------------------------- wards
    { id: 'wards', title: 'Wards', text: 'A boundary the Drift cannot easily cross. Inside it weather is just weather, wolves are just wolves and water stays water. Every village in the Lowmarch exists because it has one.', tags: ['ward', 'village', 'magic'], aliases: ['the ward', 'a ward', 'warding'], knownBy: ALL, secret: false },
    { id: 'wardstones', title: 'Wardstones and the Wellstone', text: "At the heart of every ward is a stone the Lanternwrights shaped, still humming with a fragment of the Song. Nobody alive can make one. Hearthvale's lies at the bottom of the well in the square and is called the Wellstone.", tags: ['ward', 'wellstone', 'town_square'], aliases: ['the Wellstone', 'wardstone', 'the stone', 'the well'], knownBy: ALL, secret: false },
    { id: 'kept_flame', title: 'Kept flame and the Hearthlight', text: "A wardstone is fed by fire kept with intent and never let go out. Every household keeps one family flame on the chapel altar; together they are the Hearthlight, and they hold the ward up. A stone can bear only so many.", tags: ['ward', 'chapel', 'faith'], aliases: ['the Hearthlight', 'family flames', 'family flame', 'flames'], knownBy: ALL, secret: false },
    { id: 'letting_in', title: 'Letting people in', text: "A household from outside can be given its own place on the stone, if one is spare, or be taken under a village household's flame as kin, its deeds now the household's. The first costs the stone; the second costs the neighbors.", tags: ['ward', 'law', 'greywinter'], aliases: ['taking people in', 'under a flame', 'under its flame'], knownBy: ALL, secret: false },
    { id: 'keepers', title: 'The keepers of a ward', text: 'A wardwright binds herself to a stone and feels it in her bones. A chapel keeper tends the family flames. A lamplighter walks the lamps at dusk, because a ward is weakest where it is dark. A wardrunner goes outside to check the edges.', tags: ['ward', 'wardwright', 'lamplighter', 'wardrunner'], aliases: ['wardwright', 'lamplighter', 'wardrunner', 'chapel keeper'], knownBy: ALL, secret: false },
    { id: 'marrying_the_stone', title: 'Marrying the stone', text: "A wardwright bound to a stone makes it bear four or five flames more, but feels every crack as an ache and cannot go more than a day's walk from it without falling sick. The old books say a stone married unwillingly holds badly.", tags: ['ward', 'wardwright', 'wellstone', 'stone_question'], aliases: ['marry the stone', 'the stone question', 'married the stone'], knownBy: ALL, secret: false },
    { id: 'bell_reach', title: 'The bell-reach and the hem', text: "Hearthvale's ward runs about as far as the chapel bell carries on a still day: the bell-reach. It covers the village, Reed Farm, Whisperwood's near edge, the lake's west shore and most of South Meadow. Its thin outer band is the hem.", tags: ['ward', 'hearthvale', 'chapel'], aliases: ['the bell-reach', 'bell reach', 'the hem'], knownBy: ALL, secret: false },
    { id: 'ward_customs', title: 'Ward customs', text: "Ward-chalk on every threshold, renewed at the new moon; cold iron nails over doors. Nobody leaves the ward alone or lets a hearth go out, and nobody spills blood inside the bell-reach: violence there thins the ward.", tags: ['ward', 'customs', 'law'], aliases: ['ward-chalk', 'chalk', 'iron nails'], knownBy: ALL, secret: false },
    { id: 'road_candles', title: 'Road-candles', text: 'A flame from a home hearth carried in a shuttered lantern. As long as it burns it keeps a small circle of ward around its carrier. Without one, nobody survives a night outside a ward.', tags: ['travel', 'ward', 'road'], aliases: ['road-candle', 'road candle', 'shuttered lantern'], knownBy: ALL, secret: false },
    { id: 'waystones', title: 'Waystones', text: "Tall pillars along the King's Road with a lamp niche at the top. A lit one throws a ward across the road, enough for a caravan to shelter under for a night. Perhaps one in three still works, and two more went dark this summer.", tags: ['road', 'ward', 'kings_road', 'waystone'], aliases: ['waystone', 'dead waystones', 'the waystones'], knownBy: ALL, secret: false },
    { id: 'kings_road_history', title: "The King's Road", text: "King Aldwin the Lampbearer laid it four hundred years ago, from Saltmere on the coast to the foot of the Crownfells, dreaming of joining the villages into one country again. The stretches between live waystones are where carts disappear.", tags: ['road', 'history', 'kings_road'], aliases: ['King Aldwin', 'the Lampbearer', 'the Bright Road', 'the Cinderwick fork'], knownBy: ALL, secret: false },

    // ---------------------------------------------------------------- magic
    { id: 'hearthcraft', title: 'Hearthcraft', text: "The magic of kept flame and boundaries: saying 'here, and not past here'. A chalk-mark over a door is hearthcraft; so is the chapel's ring of flames. It binds its user to a place. It is the only magic everyone trusts.", tags: ['magic', 'ward'], aliases: ['ward-craft', 'hearth magic'], knownBy: ALL, secret: false },
    { id: 'lumencraft', title: 'Lumencraft, the Lamp-art', text: "Shaping light into force, out of the caster's own warmth. A long fight leaves a lumencrafter blue-lipped and shaking (lamp-chill); past that she gutters, cold as stone. Good ones spend from a heartglass set in a staff instead.", tags: ['magic', 'lumencraft', 'lyra'], aliases: ['the Lamp-art', 'lumencrafter', 'lamp-chill', 'gutter', 'guttered', 'heartglass'], knownBy: ALL, secret: false },
    { id: 'lyra_workings', title: "Lyra's three workings", text: "Sparks: light thrown hard enough to strike, Lyra's violet where Maren's were white. Lending warmth: pouring warmth into someone else's body to speed its mending, the costliest thing Lyra does. And the Stillring.", tags: ['magic', 'lumencraft', 'lyra', 'healing'], aliases: ['sparks', 'arcane bolts', 'lending warmth', 'healing spell'], knownBy: ['lyra'], secret: false },
    { id: 'binding_light', title: 'The Stillring', text: "Maren's own invention, lumencraft shaped by hearthcraft: a ward drawn around one body. A ring of violet light closes around someone's feet and for a few heartbeats tells them 'not past here'. Maren called it the polite way to say stop.", tags: ['magic', 'spell', 'maren', 'lyra'], aliases: ['Binding Light', 'the binding spell', 'Stillring', 'binding'], knownBy: ['lyra'], secret: false },
    { id: 'lyra_staff', title: "Lyra's staff", text: "Ash wood shod in iron, re-shod three years ago after the old ferrule split on the lake ice (Tilly Ashby's first paid work), tipped with the heartglass Maren gave Lyra at sixteen. When it glows at night, the crystal is giving back warmth.", tags: ['lyra', 'staff', 'heartglass', 'tilly'], aliases: ['her staff', 'the staff', 'the ferrule'], knownBy: ['lyra', 'tilly', 'bram'], secret: false },
    { id: 'greenwit', title: 'Greenwit', text: "Hedge-magic: knowing which plants hold magic and brewing them so it wakes in a body. Moonpetals drink moonlight; silverleaf knits flesh. Herbs cut in drift-weather bring the weather home. Mira Fennick is the valley's best greenwitch.", tags: ['magic', 'herbs', 'mira', 'moonpetal'], aliases: ['greenwitch', 'hedge-magic', 'herb magic', 'silverleaf', 'moonpetals'], knownBy: ALL, secret: false },
    { id: 'forgesong', title: 'Forgesong', text: "Some smiths, mostly without meaning to, put something into iron as they work it. A forgesung blade bites slimes and turned beasts like cloth. The iron keeps what the smith felt while it was sung. Bram would grunt at the word.", tags: ['magic', 'smithy', 'bram'], aliases: ['forgesung', 'forgesinger'], knownBy: ALL, secret: false },
    { id: 'songcraft', title: 'The Old Song', text: 'Lanternwright songcraft. A few fragments can still be hummed or chanted, and they still do something. Maren believed the Song costs the singer not warmth but place: whoever sings deep enough becomes part of what is sung.', tags: ['magic', 'lanternwrights', 'maren'], aliases: ['songcraft', 'Lanternwright songcraft'], knownBy: ['lyra', 'aveline'], secret: false },
    { id: 'brightborn', title: 'The brightborn', text: "People touched by the Drift, born under brightfall or caught in glimmer as children. They come away with something: a knack for water, eyes that see in the dark, night-blue hair, magic that wakes too early. Old women make warding signs.", tags: ['magic', 'drift', 'brightfall'], aliases: ['brightborn', 'drift-touched', 'driftcraft'], knownBy: ALL, secret: false },
    { id: 'gravelight', title: 'Gravelight', text: "The dungeons' own magic: cold blue light that wears the bones of the dead and walks them as skeletons. It is borrowed from something that wants it back. Every Moot in the Lowmarch forbids it.", tags: ['magic', 'dungeon', 'undead', 'ruins'], aliases: ['the blue light', 'blue lights', 'grave light'], knownBy: ALL, secret: false },
    { id: 'small_charms', title: 'Small charms', text: "Everybody's magic: a knot in a hair-ribbon, salt across a sill, humming to the fish, a spoon of honey left out on Longwatch night, a ribbon on the heart oak. Most of it does nothing. All of it makes people braver in the dark.", tags: ['magic', 'customs'], aliases: ['charms', 'the heart oak'], knownBy: ALL, secret: false },

    // ---------------------------------------------------------------- dungeons
    { id: 'dungeons', title: 'Dungeons', text: "Places underground where spilled magic pooled thick enough to behave like something alive. They sleep for years, then wake: lights inside at night, stone that hums, slimes in nearby pools. Then they push their creatures out.", tags: ['dungeon', 'magic', 'ruins'], aliases: ['dungeon', 'a waking dungeon'], knownBy: ALL, secret: false },
    { id: 'dungeon_creatures', title: 'What lives in dungeons', text: "Dungeons make creatures from what they have. Slimes are water that sat too long in magic; bats are its darkness given wings; skeletons are the dead, worn like clothes. Glow crystals are its own light set hard, worth more than ore.", tags: ['dungeon', 'slimes', 'bats', 'skeletons', 'crystal'], aliases: ['slimes', 'skeletons', 'bats', 'glow crystals'], knownBy: ALL, secret: false },
    { id: 'delving', title: 'Delving', text: "Going into a dungeon on purpose and coming out with something. In the villages it is forbidden without the Moot's leave, because a delver who wakes a dungeon wakes it for everyone. The old rule: the deep pays the one who leaves first.", tags: ['dungeon', 'law'], aliases: ['delve', 'delvers', 'the deep pays the one who leaves first'], knownBy: ALL, secret: false },
    { id: 'weeping_cut', title: 'The Weeping Cut', text: "A small, old working under the north face of Stonecut Quarry, named for its dripping. It slept two hundred years until three young people went in without leave five years ago and woke it. The Moot sealed it with iron stakes Bram forged.", tags: ['dungeon', 'quarry', 'lyra', 'bryn', 'davin'], aliases: ['the Cut', 'Weeping Cut'], knownBy: ALL, secret: false },
    { id: 'famous_dungeons', title: 'The Deepvein and the Drowned Choir', text: 'The famous dungeons of the Lowmarch: the Deepvein under the Cinderwick hills, whose crystal-seams the Border Wars were fought over, and the Drowned Choir, which the Saltmere delvers work at low tide.', tags: ['dungeon', 'history'], aliases: ['the Deepvein', 'the Drowned Choir'], knownBy: ALL, secret: false },

    // ---------------------------------------------------------------- other villages
    { id: 'brightwater', title: 'Brightwater', text: "A river town three days south-east by the Bright Road, big enough for two chapels and a market. People who go there for a season tend to stay: June Reed is there 'visiting her sister', and Maudie Ashby went ten years ago.", tags: ['village', 'town'], aliases: ['the river town'], knownBy: ALL, secret: false },
    { id: 'saltmere', title: 'Saltmere', text: 'The walled harbor town on the coast, twelve days south-west: a guild of delvers, an old mint, a library and a sea-wall carved with the names of drowned sailors. Garrick\'s mother lives there, and so does Bryn Holloway, now a scribe.', tags: ['town', 'coast'], aliases: ['the harbor town', 'the coast'], knownBy: ALL, secret: false },
    { id: 'cinderwick', title: 'Cinderwick', text: "A mining village in the eastern hills at the end of the oil track. Its wardstone sits in a coal seam that has burned on purpose for two hundred years. It makes the best lamp-oil in the Lowmarch; every Hearthvale street lamp burns it.", tags: ['village', 'oil'], aliases: ['Cinderwick oil', 'the oil track'], knownBy: ALL, secret: false },
    { id: 'owlsend', title: 'Owlsend', text: "The last village before the mountains, small, stubborn and poor, three days up the north track. On clear nights its lamps could be seen from the shoulder of the Hollowcrown. Hess Morrow says that at midsummer they could not.", tags: ['village', 'north', 'owlsend'], aliases: ["Owlsend's lamps"], knownBy: ALL, secret: false },
    { id: 'brindlecombe', title: 'Brindlecombe', text: 'A dead village a day and a half west, its houses still standing with their doors open. Its ward failed in the Greywinter nineteen years ago, when a grey lasted a whole winter and its people forgot their flames.', tags: ['village', 'greywinter', 'history'], aliases: ['the dead village'], knownBy: ALL, secret: false },
    { id: 'glasswater_isles', title: 'The Glasswater Isles', text: "Islands far to the south-west across the sea, where the sand is like crushed glass and the lagoon glows on summer nights. Maren Ashgrove was born there. Nobody else in Hearthvale has ever been.", tags: ['islands', 'sea', 'maren'], aliases: ['Glasswater', 'the Isles'], knownBy: ALL, secret: false },

    // ---------------------------------------------------------------- Hearthvale
    { id: 'hearthvale_founding', title: 'The founding of Hearthvale', text: "Three hundred and twelve years ago a caravan sheltered from a hollow wind. Gerda Mead's kettle-fire never went out, and by morning they found a wardstone in a well-shaft. Wend the Grey woke it; Ansel Ambrel made the first candles.", tags: ['history', 'hearthvale', 'ambrel'], aliases: ['Gerda Mead', 'Wend the Grey', 'Ansel Ambrel', 'the founding'], knownBy: ALL, secret: false },
    { id: 'the_ambrels', title: 'The Ambrel lamplighters', text: "Every dusk since Ansel Ambrel's day an Ambrel has lit the lamps around Hearthvale's square and along its lanes. Hobb Ambrel has lit them for forty-one years. Lyra is the last Ambrel.", tags: ['hearthvale', 'ambrel', 'lamplighter', 'hobb', 'lyra'], aliases: ['the lamp-round', 'the lamplighter', 'Ambrels'], knownBy: ALL, secret: false },
    { id: 'hearth_faith', title: 'The Hearth faith', text: "Born in the years after the Unlighting: 'A candle does not ask the dark for permission.' One flame on the chapel altar for every household, and a road-candle in the window for whoever is still on the road.", tags: ['faith', 'chapel', 'village'], aliases: ['the Hearth', 'the candle in the window', 'the road-candle in the window'], knownBy: ALL, secret: false },
    { id: 'flame_count', title: 'The flames on the altar', text: 'Thirty-eight family flames burn on the chapel altar, and anyone can count them: thirty-seven households and the Wayhouse. How many the Wellstone can bear is the most important secret a village keeps, and the Moot keeps it.', tags: ['ward', 'chapel', 'flames'], aliases: ['thirty-eight flames', 'the flame-count'], knownBy: ALL, secret: false },
    { id: 'hearthmoot', title: 'The Hearthmoot', text: "Hearthvale's council: the head of every household that keeps a flame, meeting in the Ember Kettle's back room. It elects a Reeve, Alder Ashby, to keep its ledgers. Captain Rowan Vale keeps the watch and the peace.", tags: ['law', 'hearthvale', 'alder'], aliases: ['the Moot', 'Moot', 'the Reeve'], knownBy: ALL, secret: false },
    { id: 'moot_laws', title: 'The laws of Hearthvale', text: "Keep your flame. No one goes outside the ward alone, and no one past the wall of the Sunken Ruins at all. No blood inside the bell-reach. No delving without leave. Strangers keep threshold night and a season of hearthwatch.", tags: ['law', 'hearthvale'], aliases: ['the laws', 'the second law', 'no blood inside the bell-reach'], knownBy: ALL, secret: false },
    { id: 'ruins_fine', title: 'The ruins wall', text: "This summer Lyra climbed the wall of the Sunken Ruins alone on Hess's rope, and Rowan put it before the Moot. The fine was ten silver, paid the same day, with a promise to do it again if need be, and to tell the captain first next time.", tags: ['law', 'ruins', 'lyra', 'rowan', 'hess'], aliases: ['the fine', 'ten silver'], knownBy: ALL, secret: false },
    { id: 'the_stone_question', title: 'The question for Lyra', text: "With Maren gone and the ward thinning, the Moot means to ask Lyra Ambrel, formally at the Sheaf Moot, to marry the Wellstone. Every hearth in the valley has chewed it over. Lyra's answer has always been: not yet.", tags: ['ward', 'wellstone', 'lyra', 'sheaf_moot', 'stone_question'], aliases: ['the stone', 'marry the stone', 'the Moot question'], knownBy: ALL, secret: false },
    { id: 'looks_after_its_own', title: 'Hearthvale looks after its own', text: "Nobody leaves the ward alone, and nobody inside it is left alone. When someone shouts for help, the watch comes running, the nearest doors open and the healers come with them. The village remembers who hurt one of its own, and for a long time.", tags: ['hearthvale', 'customs', 'law', 'watch'], aliases: ['call for help', 'the village answers', 'her village'], knownBy: ALL, secret: false },
    { id: 'hearthwatch', title: 'Hearthwatch', text: "Someone let in from outside is not left alone under a roof for their first season. A villager holds the key, looks in every day and sleeps under that roof when they judge it right, for a Moot stipend, and may hand the key back.", tags: ['customs', 'stranger', 'law'], aliases: ['the hearthwatch', 'the key', 'the stipend'], knownBy: ALL, secret: false },
    { id: 'threshold_night', title: 'Threshold night', text: "Anyone let in from outside spends their first night under the chapel roof beside the family flames before they sleep anywhere else. The stranger's threshold night lasted eighty-one nights.", tags: ['customs', 'chapel', 'stranger'], aliases: ['threshold-night'], knownBy: ALL, secret: false },
    { id: 'festivals', title: "Hearthvale's festivals", text: "Kindling Day at first thaw, when every hearth is relit from the Ember Kettle. Moonpetal Night in late summer. The Sheaf Moot at harvest. Longwatch at midwinter, the longest night, when nobody sleeps.", tags: ['customs', 'festival'], aliases: ['Kindling Day', 'Moonpetal Night', 'Longwatch', 'joining flames'], knownBy: ALL, secret: false },
    { id: 'sheaf_moot', title: 'The Sheaf Moot', text: "Harvest, ten days off. The last sheaf is burned on the well-cap for the Wellstone, the Moot meets, and there is a dance, a hammer-throw and a turnip ribbon. This year: the bandits, and the question for Lyra.", tags: ['festival', 'sheaf_moot', 'moot'], aliases: ['the dance', 'the hammer-throw', 'the harvest'], knownBy: ALL, secret: false },
    { id: 'lamplighters_star', title: "The lamplighter's star", text: "A small bright star that stands over the Hollowcrown just before dawn on Longwatch morning. Lamplighters call it 'Lyra': when it shows, the night's work is done. Hobb named his daughter for it.", tags: ['stars', 'lyra', 'hobb', 'longwatch'], aliases: ['the Lyra star', 'Lyra star'], knownBy: ALL, secret: false },
    { id: 'sayings', title: 'Sayings of the valley', text: "'Keep your flame and your flame keeps you.' 'Home before the bell.' 'Never walk where you can't see a waystone.' 'Still water keeps its counsel.' 'Grey in the morning, count your neighbors by noon.' At dusk: 'Flame's lit?'", tags: ['customs', 'sayings'], aliases: ["flame's lit", 'sayings'], knownBy: ALL, secret: false },
    { id: 'oil_trouble', title: 'The oil', text: "Every street lamp in Hearthvale burns Cinderwick oil off Garrick's cart. Since the bandits began tolling the fork it costs half again what it did, the chapel's oil cart never arrived, and Hobb is trimming the wicks short.", tags: ['oil', 'bandits', 'hobb', 'garrick'], aliases: ['lamp-oil', 'the oil price'], knownBy: ALL, secret: false },
    { id: 'varek_band', title: "Varek One-Eye's band", text: "Outlaws led by a one-eyed man with an axe, six or more with archers, camped above the Cinderwick fork since last autumn. They toll the roads, killed Davin Morrow and Edric Hale this spring, and pay for ale in hundred-year-old lamp-pennies.", tags: ['bandits', 'danger', 'varek'], aliases: ['the bandits', 'Varek', 'Varek One-Eye', 'outlaws', 'the toll'], knownBy: ALL, secret: false },
    { id: 'stolen_key', title: 'The stolen key', text: "The ruins gate has been locked by order of the chapel for a hundred and ten years. Its rusted key hung in the empty ruins-keeper's lodge until this spring, when the bandits raided the lodge and carried it off. They hold it still.", tags: ['ruins', 'bandits', 'ruins_key', 'maren'], aliases: ['the rusted key', 'the gate key', "the ruins-keeper's key", 'the ruins gate'], knownBy: ALL, secret: false },
    { id: 'the_stranger', title: 'The stranger from the mountain', text: "Lyra and Hess found them in the Crown Ring two days after Maren went in: warm in the snow, a dark sword beside them, no footprints in or out. They slept eighty-one nights in the chapel, woke six days ago remembering nothing.", tags: ['stranger', 'player', 'hollowcrown'], aliases: ['the stranger', 'the found one', 'our foundling', 'mountain-found'], knownBy: ALL, secret: false },
    { id: 'stranger_whispers', title: 'What the village whispers about the stranger', text: "Drift-touched: nobody lies warm in the snow. A bandit spy, says Wys. A Lanternwright ghost, says Pip, delighted. Fell from the sky, says Tilly. Feed them, says Elda. Marl Haskett notes nobody argued till midnight about his lot.", tags: ['stranger', 'rumor', 'gossip'], aliases: ['rumors about the stranger'], knownBy: ALL, secret: false },
    { id: 'maren_preparations', title: 'How Maren went', text: "At midsummer Maren paid a month ahead at the Kettle, bought rope, oil and a miner's lantern from Garrick, moonpetal salve from Mira, turnips from Tobias, and had Bram sharpen a silver chisel. At dusk Aveline saw her walk to the ruins.", tags: ['maren', 'ruins', 'village'], aliases: ["Maren's preparations", 'the day Maren went'], knownBy: ALL, secret: false },

    // ---------------------------------------------------------------- what only Lyra (and a few) know
    { id: 'little_lamp_words', title: "'Little lamp'", text: "On the fortieth night of the long sleep, sitting watch in the chapel, Lyra heard the stranger say two words in plain speech, in a voice like someone very far away: 'little lamp'. Only Maren ever called Lyra that.", tags: ['stranger', 'maren', 'lyra'], aliases: ['little lamp', 'the fortieth night'], knownBy: ['lyra'], secret: true },
    { id: 'wellstone_hitch', title: "The hitch in the Wellstone's hum", text: "The Wellstone hums at the bottom of the well, and from anywhere on the square Lyra can hear it. Since midsummer its hum has had a hitch in it at dusk, and nobody else seems to notice.", tags: ['wellstone', 'ward', 'lyra'], aliases: ["the Wellstone's hum", 'the hum'], knownBy: ['lyra'], secret: true },
    { id: 'far_lamps', title: 'The far lamps on Lamplight Lane', text: "Hobb's eyes are failing at dusk, so Lyra lights the far lamps on Lamplight Lane before he gets there. He pretends not to notice, and Lyra pretends it was the wind.", tags: ['hobb', 'lyra', 'lamplight_lane', 'lamps'], aliases: ['the far lamps'], knownBy: ['lyra', 'hobb'], secret: true },
    { id: 'elda_lantern', title: "The lantern in the Kettle's top window", text: "The lantern Elda lights in the Ember Kettle's top window every night is for Tam, her husband, whose letters stopped coming from the sea. She told Lyra one Longwatch.", tags: ['elda', 'tam', 'ember_kettle'], aliases: ['the top-window lantern'], knownBy: ['elda', 'lyra', 'aveline'], secret: true },
    { id: 'brightborn_whispers', title: 'Is Lyra brightborn?', text: "Hearthvale has whispered for twenty-four years that Lyra is brightborn: born half a year after the Brightfall, hair grown in blue, light that burns violet. Lyra knows people whisper it. Lyra has decided not to care.", tags: ['lyra', 'brightborn', 'brightfall', 'rumor'], aliases: ['brightborn', 'drift-touched', 'are you brightborn', 'changeling'], knownBy: ALL, secret: false },
    { id: 'waystone_night', title: 'The waystone that burned one night', text: "Last spring Lyra made the dead waystone a mile down the road toward Saltmere burn for one night, with a coal from the Kettle hearth, a Stillring drawn around the lamp niche and three words of Lanternwright script. It went out at dawn.", tags: ['waystone', 'lyra', 'kings_road', 'dream'], aliases: ['the dead waystone', 'the waystone toward Saltmere'], knownBy: ['lyra'], secret: false },
  ],

  timeline: [
    { id: 'age_of_lanterns', when: 'Beyond counting', title: 'The Age of Lanterns', text: 'The Lanternwrights sing the Song and hold the world\'s magic still. They raise wardstones, waystones and waygates, build verse-houses where parts of the Song are kept burning, and honor the Song\'s singers above kings.', tags: ['history', 'lanternwrights'] },
    { id: 'unlighting', when: 'About a thousand years ago', title: 'The Unlighting', text: 'The Song breaks; nobody knows why. Magic spills over the land as the Drift and runs down into the dungeons. The verse-houses sink, the Sunken Ruins among them, and the Lanternwrights vanish from the world.', tags: ['history', 'drift', 'ruins'] },
    { id: 'hearth_years', when: 'The centuries after', title: 'The Hearth Years', text: 'Survivors learn by trial and grief that kept flame wakes a wardstone. The first villages are built, and the Hearth faith begins: a candle does not ask the dark for permission.', tags: ['history', 'faith'] },
    { id: 'crowned_road', when: 'About four hundred years ago', title: 'The Crowned Road', text: "King Aldwin the Lampbearer lays the King's Road from the coast to the Crownfells and relights its waystones. For a hundred and fifty years the Lowmarch is something like a kingdom, in three counties.", tags: ['history', 'kings_road'] },
    { id: 'hearthvale_founded', when: '312 years ago', title: 'Hearthvale is founded', text: "Gerda Mead's kettle-fire survives a hollow wind beside a well with a living wardstone at the bottom. Her fire becomes the Ember Kettle's hearth, Wend the Grey wakes the stone, and Ansel Ambrel lights the first lamps.", tags: ['history', 'hearthvale'] },
    { id: 'the_guttering', when: 'About 250 years ago', title: 'The Guttering', text: 'Half the waystones on the King\'s Road fail in a single winter. The last king dies without an heir, and the Lowmarch goes back to being villages. The road keeps its name.', tags: ['history', 'kings_road'] },
    { id: 'ruins_locked', when: '110 years ago', title: 'The ruins are locked', text: 'Three pilgrims go below the shrine in the upper halls of the Sunken Ruins and are never seen again. At the chapel\'s asking the Moot locks the iron gate and puts a keeper in a lodge beside it.', tags: ['history', 'ruins'] },
    { id: 'road_candle', when: '60 years ago', title: 'The road-candle', text: 'Mother Rhoswen, the chapel keeper before Aveline, lights a candle in the chapel window "for whoever is still on the road". It has not gone out since.', tags: ['chapel', 'faith'] },
    { id: 'hobb_takes_road', when: '56 years ago', title: 'Hobb takes the road', text: "Hobb Ambrel, twenty-three, puts down the lamplighter's ladder and walks the King's Road as a road-warden with Abel Ironhand. Wenna, twenty, turns down Corran Dell and waits for him.", tags: ['hobb', 'wenna', 'corran', 'road'] },
    { id: 'forge_lit', when: '53 years ago', title: 'The Ironhand forge is lit', text: 'Abel Ironhand leaves the road, marries and lights a forge in Hearthvale. Hobb walks on alone.', tags: ['smithy', 'bram', 'hobb'] },
    { id: 'hobb_home', when: '41 years ago', title: 'Hobb comes home', text: 'When his father dies, Hobb, thirty-eight, takes up the ladder and marries Wenna, thirty-five. In the next five years they bury three babies: Ansel, Bee and little Jem.', tags: ['hobb', 'wenna', 'family'] },
    { id: 'border_wars', when: '35 to 31 years ago', title: 'The Border Wars', text: "Saltmere and the hill-holds around Cinderwick fight over the crystal-seams of the Deepvein. Young men walk off from every village on the road; Rowan Vale's father Ewan never comes home. Aveline serves as a battle-cleric.", tags: ['history', 'war', 'rowan', 'aveline'] },
    { id: 'aveline_comes', when: '30 years ago', title: 'Aveline comes', text: "A tired woman who will not talk about the war takes the Chapel of the Hearth. Bram Ironhand, twenty-two, takes his father's forge the same year.", tags: ['aveline', 'bram', 'chapel'] },
    { id: 'brightfall_winter', when: '25 years ago', title: 'The Brightfall winter', text: 'For eleven still nights at midwinter light falls on the valley like snow, and moonpetals bloom in the frost. By the thaw Wenna Ambrel, fifty-one and long past hope of children, is with child.', tags: ['brightfall', 'wenna', 'drift'] },
    { id: 'lyra_born', when: '24 years ago', title: 'Lyra is born', text: 'At midsummer, half a year after the Brightfall, Lyra Ambrel is born to Hobb, fifty-five, and Wenna, fifty-two. Petra Ashby catches the baby. The old women count on their fingers and say nothing out loud.', tags: ['lyra', 'hobb', 'wenna', 'petra'] },
    { id: 'elda_comes', when: '22 years ago', title: 'Elda takes the Kettle', text: "Elda Thornbury comes inland from Saltmere, where she had stopped watching the harbor for her husband's ship, to take over her aunt's inn.", tags: ['elda', 'ember_kettle'] },
    { id: 'hollow_wind_winter', when: '20 years ago', title: 'The hollow-wind winter', text: "A hollow wind takes Hess Morrow's parents and Wys Pike's father, among others. Hess, twenty-one, raises her brother Davin, six.", tags: ['hess', 'davin', 'wys'] },
    { id: 'greywinter', when: '19 years ago', title: 'The Greywinter', text: "A grey lies on the west of the valley all winter and Brindlecombe's ward fails. About sixty survivors reach Hearthvale's ward line. The Moot lets in fourteen, the children, on the lamplighter's count. Many of the rest die on the road.", tags: ['greywinter', 'brindlecombe', 'hobb', 'sabeth'] },
    { id: 'maren_comes', when: '19 years ago', title: 'Maren comes', text: "In the spring after the Greywinter the Wellstone cracks along one face. Maren Ashgrove answers the Moot's call to Saltmere: forty-four, born in the Glasswater Isles. She takes the top room at the Kettle, marries the stone, and stays.", tags: ['maren', 'wellstone', 'ember_kettle'] },
    { id: 'night_of_lamps', when: '13 years ago', title: 'The night of the lamps', text: 'On Longwatch night, at eleven, Lyra Ambrel lights every lamp on the square at once in violet fire. Maren Ashgrove takes Lyra as apprentice.', tags: ['lyra', 'maren', 'magic'] },
    { id: 'new_reeve', when: '12 years ago', title: 'A new Reeve', text: 'Reeve Osric Ashby dies, and his son Alder is elected Reeve.', tags: ['alder', 'moot'] },
    { id: 'jory_returns', when: '11 years ago', title: 'Jory Fallow comes back', text: 'A Brindlecombe man who survived the Brightwater road comes back old and alone, asking to live near his dead village. The Moot lets him into the Wayhouse. That year Rowan Vale is made captain of the watch.', tags: ['jory', 'wayhouse', 'rowan'] },
    { id: 'maudie_goes', when: '10 years ago', title: 'Maudie Ashby goes', text: "Alder's wife goes to visit her sister in Brightwater and does not come back. Tilly is seven.", tags: ['alder', 'tilly'] },
    { id: 'hanna_dies', when: '6 years ago', title: 'Hanna Ironhand dies', text: 'She dies of winter fever. From then on Bram sets out two cups at breakfast.', tags: ['bram', 'hanna'] },
    { id: 'the_cut', when: '5 years ago', title: 'The Weeping Cut', text: "Lyra Ambrel goes into the small dungeon under Stonecut Quarry with Davin Morrow and Bryn Holloway, without the Moot's leave. All three come out, but Bryn's crushed leg never mends straight. The Moot seals the Cut with Bram's stakes.", tags: ['lyra', 'davin', 'bryn', 'quarry'] },
    { id: 'rosalind_dies', when: '4 years ago', title: 'Rosalind Fennick dies', text: 'Mira inherits the herb shop and the green book.', tags: ['mira'] },
    { id: 'three_years_ago', when: '3 years ago', title: 'Three years ago', text: 'Bryn Holloway goes to Saltmere to be a scribe. Tilly Ashby, fourteen, walks into the smithy and refuses to leave. That summer a boar gores Tobias Reed, and that winter Jory Fallow dies in the Wayhouse.', tags: ['bryn', 'tilly', 'tobias', 'jory'] },
    { id: 'ferry', when: '2 winters ago', title: 'The Brightwater ferry', text: "A hollow wind overturns Corran Dell's ferry near the mouth of the river Bright. Pip's parents, Ned and Lissy Tarrow, drown. Corran pulls Pip out of the lake, and Elda takes him under her flame that night. Corran has not run the ferry since.", tags: ['corran', 'pip', 'elda', 'mirror_lake'] },
    { id: 'bandits_come', when: 'Last autumn', title: 'The bandits come', text: 'A band led by a one-eyed man with an axe settles in the hills above the Cinderwick fork and starts taking a "toll" from carts.', tags: ['bandits'] },
    { id: 'the_ambush', when: 'This spring', title: 'The ambush', text: "Davin Morrow and Edric Hale of Rowan's watch are killed in a bandit ambush near the fork. Weeks later the bandits raid the ruins-keeper's lodge and carry off the gate key. June Reed goes to Brightwater to visit her sister.", tags: ['bandits', 'davin', 'rowan', 'ruins_key'] },
    { id: 'maren_goes_in', when: 'Three months ago, at midsummer', title: 'Maren goes in', text: "At dusk, carrying a lantern and a coil of rope, Maren Ashgrove goes over the wall of the Sunken Ruins and does not come back. That night blue lights begin to move in the ruins. It is Lyra's twenty-fourth birthday.", tags: ['maren', 'ruins', 'lyra'] },
    { id: 'stranger_found', when: 'Three months ago', title: 'The stranger is found', text: 'Two days after Maren went in, Lyra and Hess find the stranger in the Crown Ring on the Hollowcrown and carry the stranger down to Hearthvale. The Moot argues until midnight and lets the stranger in at dawn.', tags: ['stranger', 'lyra', 'hess', 'hollowcrown'] },
    { id: 'long_sleep', when: 'All summer', title: 'The long sleep', text: 'The stranger sleeps eighty-one days in the chapel and cannot be woken. Aveline sits with the stranger every night, Mira brews moonpetal broth, Elda spoons it in, and Lyra takes turns at the watch.', tags: ['stranger', 'chapel'] },
    { id: 'stranger_wakes', when: 'Six days ago', title: 'The stranger wakes', text: 'The stranger wakes with no memory of anything before the ring. Lyra takes the hearthwatch, and the stranger moves into the Wayhouse.', tags: ['stranger', 'hearthwatch', 'lyra'] },
    { id: 'wolves_on_road', when: 'Two days ago', title: "Wolves on the King's Road", text: "On the stranger's first walk outside the ward, wolves come at dusk where the road passes under the edge of the wood, and the stranger stands beside Lyra instead of running.", tags: ['wolves', 'kings_road', 'lyra', 'stranger'] },
    { id: 'now', when: 'Now, early autumn', title: 'Now', text: 'The harvest is nearly in, the Sheaf Moot is ten days off, and the ward is thinner than anyone will say aloud.', tags: ['hearthvale', 'sheaf_moot'] },
  ],

  places: [
    { id: 'p_hearthvale', locationId: 'hearthvale', title: 'Hearthvale', text: "Three hundred and twelve years of woodsmoke and bread around a kettle-fire, a well and a chapel. About a hundred and fifty people and thirty-eight flames. Every chimney smokes from first frost to last.", tags: ['village'], knownBy: ALL },
    { id: 'p_town_square', locationId: 'town_square', title: 'The town square', text: "The well, with the Wellstone humming at the bottom under an iron-banded cap Bram is re-hinging. The notice board, benches, two market stalls and the lamps Hobb lights first. Children may not play on the well-cap. They do.", tags: ['square', 'well', 'wellstone'], knownBy: ALL },
    { id: 'p_wayhouse', locationId: 'player_home', title: 'The Wayhouse', text: "Off the square's south-east corner: the founders' house for anyone the ward lets in. Two beds, a chest, Jory Fallow's books, Lyra's desk and locked trunk, Hobb's new lamp by the door and Biscuit on the step. The stranger lives here.", tags: ['home', 'wayhouse', 'stranger'], knownBy: ALL },
    { id: 'p_ember_kettle', locationId: 'ember_kettle', title: 'The Ember Kettle', text: "The inn, the Moot hall and the village's living room. Its hearth is Gerda Mead's founding fire, never once out. Maren's room at the top is kept as she left it, the room under the eaves is kept for Lyra, and Pip's cot is in the room below.", tags: ['inn', 'elda', 'moot'], knownBy: ALL },
    { id: 'p_chapel', locationId: 'chapel', title: 'Chapel of the Hearth', text: "On the north side of the square. Thirty-eight family flames burn on the altar, the road-candle burns in the window, and Hanna Ironhand's candle is lit every week. The candles lean toward the stranger.", tags: ['chapel', 'aveline', 'faith'], knownBy: ALL },
    { id: 'p_smithy', locationId: 'smithy', title: 'Ironhand Smithy', text: 'East of the square. Abel Ironhand lit the forge fifty-three years ago and it has never gone cold. The anvil sets the village\'s hours, and Tilly\'s lighter hammer answers it, a little off the beat.', tags: ['smithy', 'bram', 'tilly'], knownBy: ALL },
    { id: 'p_general_store', locationId: 'general_store', title: "Gale's Goods", text: "West of the square. Garrick's shop sells potions, bread at six coppers, lanterns, berries and anything else he can get onto a cart. A framed map to a well hangs behind the counter.", tags: ['shop', 'garrick'], knownBy: ALL },
    { id: 'p_herbalist', locationId: 'herbalist', title: "Fennick's Herbs", text: 'Beside Gale\'s Goods: drying racks, silverleaf, mint, three generations of jars and the green book. It smells like summer in every season.', tags: ['herbs', 'mira'], knownBy: ALL },
    { id: 'p_guardhouse', locationId: 'guardhouse', title: 'The guardhouse', text: "South-west of the square: Rowan's home and Wys's cot, a rack of spears, a cell nobody has used in years and a map-table with the bandit camp circled three times. Herb bundles on the step, and a flat roof where someone plays the flute.", tags: ['guard', 'rowan', 'wys'], knownBy: ALL },
    { id: 'p_farmhouse', locationId: 'farmhouse', title: 'Reed Farmhouse', text: 'Six generations of Reeds. Tobias and Tansy live here, and June\'s place is kept for her. There is a turnip on every surface.', tags: ['farm', 'tobias', 'tansy'], knownBy: ALL },
    { id: 'p_reed_farm', locationId: 'reed_farm', title: 'Reed Farm', text: "West of the village: turnips and wheat, Duchess and her hens, Sir Barnaby the scarecrow, boar-churned fences, and a field the whole village eats from.", tags: ['farm', 'tobias', 'duchess'], knownBy: ALL },
    { id: 'p_whisperwood', locationId: 'whisperwood', title: 'Whisperwood', text: "The old forest north of the village. Its near edge is inside the ward, with Wenna's hives among the lindens; farther out it thins into the hem, and deeper in stands the heart oak. The path to the Hollowcrown starts here.", tags: ['forest', 'wolves', 'moonpetal'], knownBy: ALL },
    { id: 'p_moonpetal_glade', locationId: 'moonpetal_glade', title: 'Moonpetal Glade', text: "Out in the hem of Whisperwood, where the biggest moonpetals open at night. A post there bears a carved crescent and the words: \"M.A. was here — look up.\" On Moonpetal Night the children come here with the watch.", tags: ['forest', 'moonpetal', 'glade'], knownBy: ALL },
    { id: 'p_quarry', locationId: 'stonecut_quarry', title: 'Stonecut Quarry', text: "North-west, in the hem. It gave the stone that built Hearthvale and iron for Bram's forge. Slimes crawl in its rain-pools. Under its north face, behind Bram's iron stakes, is the Weeping Cut.", tags: ['quarry', 'ore', 'slimes', 'weeping_cut'], knownBy: ALL },
    { id: 'p_bandit_camp', locationId: 'bandit_camp', title: 'The bandit camp', text: "In the hills north-east of Mirror Lake, above the Cinderwick fork and outside the ward: tents, a fire that never quite goes out, and a view down onto both roads.", tags: ['bandits', 'danger'], knownBy: ALL },
    { id: 'p_mirror_lake', locationId: 'mirror_lake', title: 'Mirror Lake', text: "East of the village, so still it holds the whole sky. Corran's dock is on the western shore with his net-shed at its landward end; the old ferry-house stands at the south end where the river Bright runs out. People say the lake hums.", tags: ['lake', 'water', 'fishing', 'corran'], knownBy: ALL },
    { id: 'p_sunken_ruins', locationId: 'sunken_ruins', title: 'The Sunken Ruins', text: "An old walled temple sinking into the marsh south-west of Hearthvale. A sheer wall, a sinkhole where its low stretch fell in at midsummer, a locked iron gate and the empty keeper's lodge. Blue lights move inside after dark.", tags: ['ruins', 'lanternwrights', 'danger'], knownBy: ALL },
    { id: 'p_ruins_halls', locationId: 'sunken_ruins', title: 'Inside the Sunken Ruins', text: "The upper halls: the old pilgrims' shrine, fallen pillars, blue ruin-lichen, glow crystals, stone that rings when struck, and a statue holding up a lantern inscribed '...the light that goes before...'. A stair goes down.", tags: ['ruins', 'lanternwrights', 'crystal'], knownBy: [] },
    { id: 'p_south_meadow', locationId: 'south_meadow', title: 'South Meadow', text: "South of the village: flowers, rabbits and puddle-slimes after drift-weather. The hem runs through its far side, and it is the best place in the valley to watch the ruins' lights.", tags: ['meadow', 'flowers'], knownBy: ALL },
    { id: 'p_kings_road', locationId: 'kings_road', title: "The King's Road", text: "It runs along the village's southern edge, crosses the stream at the old bridge and splits: the Bright Road south-east, the King's Road north to the fork. Wolves run at dusk where it passes under the edge of the wood.", tags: ['road', 'wolves', 'waystone'], knownBy: ALL },
    // Round three (DESIGN §19.2): the new homes in the village.
    { id: 'p_lamplight_lane', locationId: 'lamplight_lane', title: 'Lamplight Lane', text: "The lane that runs east from the chapel behind the smithy, with the Ambrels' chandlery at its end. Along it stand the far lamps.", tags: ['lane', 'lamps', 'ambrel'], knownBy: ALL },
    { id: 'p_chandlery', locationId: 'chandlery', title: 'The chandlery', text: "The Ambrels' narrow two-storey house at the end of Lamplight Lane, with the dipping-vat and the candle-racks downstairs. Lyra was born here, and the little room upstairs is still kept for Lyra. Outside is the bench where Hobb and Wenna sit at dusk.", tags: ['home', 'hobb', 'wenna', 'lyra', 'candles'], knownBy: ALL },
    { id: 'p_ashby_house', locationId: 'ashby_house', title: 'Ashby House', text: 'The tall stone house of the Reeves on the south side of the square, facing the well, with the ledger-room at the front. Alder, Petra and Tilly live here.', tags: ['home', 'alder', 'petra', 'tilly', 'moot'], knownBy: ALL },
    { id: 'p_dye_cottage', locationId: 'dye_cottage', title: 'The dye-vats cottage', text: 'East of the Wayhouse by the stream, just above the bridge: the last house in Hearthvale. The vats stand in the yard and the stream runs violet and teal below it. Sabeth and Hess live here.', tags: ['home', 'sabeth', 'hess', 'dye'], knownBy: ALL },
    { id: 'p_weavers_row', locationId: 'weavers_row', title: "Weavers' Row", text: "A short lane south of the square, where Nan Pike's loom clacks and Wys's three sisters argue.", tags: ['lane', 'pike', 'wys'], knownBy: ALL },
    { id: 'p_net_shed', locationId: 'net_shed', title: "Corran's net-shed", text: 'At the landward end of his dock on Mirror Lake. Corran sleeps here; he cannot sleep in the ferry-house with the empty slip below it.', tags: ['home', 'corran', 'lake'], knownBy: ALL },
    { id: 'p_wenna_hives', locationId: 'wenna_hives', title: "Wenna's hives", text: "Among the lindens at Whisperwood's near edge, inside the ward. Wenna finds them by their sound and sings the old songs to them. Lindenflower honey keeps for a hundred years.", tags: ['bees', 'wenna', 'honey', 'forest'], knownBy: ALL },
  ],

  people: [
    // ---------------------------------------------------------------- the eighteen
    { id: 'hobb', npcId: 'hobb', name: 'Hobb Ambrel', title: 'the lamplighter', text: "Seventy-nine: chandler and lamplighter, Lyra's father. Fifteen years a road-warden on the King's Road, home at thirty-eight, never once late lighting a lamp. In the Greywinter fourteen children came in on his count. He calls Lyra 'Star'.", tags: ['ambrel', 'lamplighter', 'family', 'village'], knownBy: ALL },
    { id: 'wenna', npcId: 'wenna', name: 'Wenna Ambrel', title: 'the beekeeper', text: "Seventy-six: beekeeper and songkeeper, Lyra's mother, with the sharpest tongue in the valley. Nearly blind, she finds her hives by their sound. She turned down Corran Dell and waited fifteen years for Hobb. Full names when she's cross.", tags: ['ambrel', 'bees', 'family', 'village'], knownBy: ALL },
    { id: 'bram', npcId: 'bram', name: 'Bram Ironhand', title: 'the blacksmith', text: "Fifty-two. Won't say three words, but will spend an hour fixing your hinge and refuse to be paid. Widowed six years; he still sets out two cups at breakfast. He forged the stakes that sealed the Weeping Cut. Calls Lyra 'mage'.", tags: ['smithy', 'village'], knownBy: ALL },
    { id: 'elda', npcId: 'elda', name: 'Elda Thornbury', title: 'the innkeeper', text: "Fifty-eight: keeps the Ember Kettle and everyone in it fed, and is the loudest gossip in the valley. Came inland from Saltmere twenty-two years ago. Kept Maren's room nineteen years, Lyra under her eaves four, and Pip under her flame.", tags: ['inn', 'village'], knownBy: ALL },
    { id: 'pip', npcId: 'pip', name: 'Pip', title: 'the orphan', text: "Pip Tarrow, nine. His parents drowned when the Brightwater ferry went down, and Elda took him in that night. Talks without stopping, fears nothing but deep water, follows a ginger stray called Biscuit. Lyra will teach him at eleven.", tags: ['child', 'village'], knownBy: ALL },
    { id: 'rowan', npcId: 'rowan', name: 'Captain Rowan Vale', title: 'the captain of the watch', text: "Thirty-eight, captain of the watch for eleven years. His father marched to the Border Wars and never came home. He held the ward line in the Greywinter at nineteen, and lost two of his watch this spring on a route he chose.", tags: ['guard', 'village'], knownBy: ALL },
    { id: 'mira', npcId: 'mira', name: 'Mira Fennick', title: 'the herbalist', text: "Twenty-six: the best greenwitch in the valley, shy until someone misnames a plant. Keeps her grandmother Rosalind's shop and green book. She brewed three nights for Bryn's leg, and kept the stranger alive on moonpetal broth.", tags: ['herbs', 'village'], knownBy: ALL },
    { id: 'tobias', npcId: 'tobias', name: 'Tobias Reed', title: 'the farmer', text: 'Forty-four. Apologizes to weeds, and once walked out to a boar with a fence-rail while its tusk was still in his leg. His wife June is visiting her sister in Brightwater; his daughter Tansy is fifteen and furious with everything.', tags: ['farm', 'village'], knownBy: ALL },
    { id: 'aveline', npcId: 'aveline', name: 'Sister Aveline', title: 'the chapel keeper', text: "Sixty-one: keeper of the Chapel of the Hearth for thirty years, once a battle-cleric. Maren's closest friend. She saw Maren walk toward the ruins at dusk, and sat with the stranger every night of the long sleep. Cheats at cards.", tags: ['chapel', 'maren', 'village'], knownBy: ALL },
    { id: 'garrick', npcId: 'garrick', name: 'Garrick "Gale" Hale', title: 'the merchant', text: "Forty-seven: Gale's Goods, and the village's only regular cart to the outside. Twenty years on the road, a story for every mile, and a bear outside Brightwater that was a very large dog. His nephew Edric died in the ambush this spring.", tags: ['shop', 'roads', 'village'], knownBy: ALL },
    { id: 'hess', npcId: 'hess', name: 'Hess Morrow', title: 'the huntress and wardrunner', text: "Hesper Morrow, forty-one, Hearthvale's wardrunner for fifteen years. She raised her brother Davin, taught Lyra to track, and carried the other end of the stranger's litter. Says the true thing and then nothing. Lives with Sabeth.", tags: ['hunter', 'wardrunner', 'village'], knownBy: ALL },
    { id: 'sabeth', npcId: 'sabeth', name: 'Sabeth Coll', title: 'the dyer and seamstress', text: "Thirty-four, the eldest of the fourteen Brindlecombe children let in during the Greywinter. Her mother and brother were turned away and went down in the grey on the Brightwater road. The Ambrels took her in. She made Lyra's cloak.", tags: ['dye', 'greywinter', 'village'], knownBy: ALL },
    { id: 'alder', npcId: 'alder', name: 'Alder Ashby', title: 'the Reeve', text: "Sixty-three: Reeve of the Hearthmoot for twelve years, son of old Reeve Osric and of Petra. He was the Moot's clerk in the Greywinter. His wife Maudie went to Brightwater ten years ago. He means to put the stone question to Lyra himself.", tags: ['moot', 'reeve', 'village'], knownBy: ALL },
    { id: 'petra', npcId: 'petra', name: 'Petra Ashby', title: 'the retired midwife', text: "Eighty-four, the eldest: midwife for fifty-five years, she caught nearly everyone born in Hearthvale, Lyra included, and tells them how at every festival. The rudest woman in the valley. Calls everyone 'duckling'.", tags: ['midwife', 'village'], knownBy: ALL },
    { id: 'tilly', npcId: 'tilly', name: 'Tilly Ashby', title: "the smith's apprentice", text: "Ottilie Ashby, seventeen: Alder's daughter, Bram's apprentice since she walked into the smithy at fourteen and refused to leave. The loudest girl in the valley, and careful the moment someone is hurt. She re-shod Lyra's staff.", tags: ['smithy', 'village'], knownBy: ALL },
    { id: 'tansy', npcId: 'tansy', name: 'Tansy Reed', title: 'the apprentice wardrunner', text: "Fifteen: Tobias's daughter. Keeps the chickens, goes on Hess's short runs to the hem, wears her mother's boots, and is very sure what other people ought to do. She wants to see Saltmere.", tags: ['farm', 'wardrunner', 'village'], knownBy: ALL },
    { id: 'corran', npcId: 'corran', name: 'Corran Dell', title: 'the fisherman', text: "Seventy-seven: fisherman of Mirror Lake. Forty years he ran the Brightwater ferry, until it went down two winters ago; he pulled Pip out, and Lyra at eight through the ice. Courted Wenna once. Plays stones with Hobb every night, and hums.", tags: ['fishing', 'lake', 'village'], knownBy: ALL },
    { id: 'wys', npcId: 'wys', name: 'Wys Pike', title: 'the watchman', text: "Wystan Pike, twenty: Nan Pike's eldest and Rowan's only full-time watchman, who joined this spring to fill a dead man's place. First to the ward line whenever the whistle blows. Sweet on Lyra since he was twelve.", tags: ['guard', 'village'], knownBy: ALL },

    // ---------------------------------------------------------------- the absent and the dead
    { id: 'maren', npcId: null, name: 'Maren Ashgrove', title: "Lyra's teacher", text: "Sixty-three, born in the Glasswater Isles: Hearthvale's wardwright for nineteen years and Lyra's teacher. Grey cloak, inky fingers, a laugh like a kettle coming to the boil. At midsummer she went over the ruins wall and never came back.", tags: ['mentor', 'maren', 'wardwright'], knownBy: ALL },
    { id: 'bryn', npcId: null, name: 'Bryn Holloway', title: "Lyra's oldest friend", text: "Twenty-four, the cooper's girl: loud, fearless, Lyra's other half as children. She dragged Lyra out of the Weeping Cut on her back, and falling stone crushed her leg; it never came straight. A scribe in Saltmere now, with a stick.", tags: ['friend', 'bryn', 'weeping_cut'], knownBy: ALL },
    { id: 'davin', npcId: null, name: 'Davin Morrow', title: "Hess's brother", text: "Hess's little brother, two years older than Lyra: handsome, bored, wanting a bigger life by the sea. He was Lyra's first love until the Weeping Cut. He joined the watch and was killed in the ambush on the King's Road this spring.", tags: ['dead', 'davin', 'hess', 'weeping_cut'], knownBy: ALL },
    { id: 'varek', npcId: null, name: 'Varek One-Eye', title: 'the bandit chief', text: "The chief of the bandits above the Cinderwick fork: one eye, an axe, a heavy swing. Varek is a common name in the west.", tags: ['bandits', 'danger'], knownBy: ALL },
    { id: 'hanna', npcId: null, name: 'Hanna Ironhand', title: "Bram's wife", text: "Bram's wife, dead of the winter fever six years ago. Aveline lights her candle in the chapel every week.", tags: ['dead', 'bram'], knownBy: ALL },
    { id: 'tam', npcId: null, name: 'Tam Thornbury', title: "Elda's husband", text: 'A sailor out of Saltmere who wrote Elda every month for nine years. Then the letters stopped. At sea, or under it.', tags: ['absent', 'elda', 'sea'], knownBy: ALL },
    { id: 'june', npcId: null, name: 'June Reed', title: "Tobias's wife", text: 'Went to Brightwater in the spring to visit her sister. It is autumn now. Tobias writes to her every week about the turnips.', tags: ['absent', 'tobias', 'tansy'], knownBy: ALL },
    { id: 'maudie', npcId: null, name: 'Maudie Ashby', title: "Alder's wife", text: "Went to visit her sister in Brightwater ten years ago and never came back. Tilly was seven. She has never written.", tags: ['absent', 'alder', 'tilly'], knownBy: ALL },
    { id: 'edric', npcId: null, name: 'Edric Hale', title: "Garrick's nephew", text: "Sent from Saltmere to learn the shop, bored by ledgers, joined the watch, and died in the ambush this spring at nineteen.", tags: ['dead', 'garrick', 'rowan'], knownBy: ALL },
    { id: 'ewan', npcId: null, name: 'Ewan Vale', title: "Rowan's father", text: "Marched off to the Border Wars when Rowan was five and never came home. His wife waited at the door for years and died eight years ago, still waiting.", tags: ['absent', 'rowan', 'war'], knownBy: ALL },
    { id: 'jory', npcId: null, name: 'Jory Fallow', title: "the Wayhouse's last tenant", text: "A Brindlecombe man who survived the Brightwater road and came back old and alone to live near his dead village. He saw Sabeth's mother and brother go down in the grey. He died in the Wayhouse three winters ago.", tags: ['dead', 'brindlecombe', 'wayhouse'], knownBy: ALL },
    { id: 'ansel_bee_jem', npcId: null, name: 'Ansel, Bee and Jem', title: "Lyra's brothers and sister, who died before Lyra was born", text: "Hobb and Wenna's first three babies. None of them saw a second winter. Lyra came long after, when Hobb and Wenna had stopped hoping.", tags: ['family', 'dead', 'ambrel'], knownBy: ALL },
    { id: 'tarrows', npcId: null, name: 'Ned and Lissy Tarrow', title: "Pip's parents", text: "Ned worked Corran's ferry ropes for twelve years; Lissy wove baskets. Both drowned when the ferry overturned two winters ago.", tags: ['dead', 'pip', 'corran'], knownBy: ALL },
    { id: 'rosalind', npcId: null, name: 'Rosalind Fennick', title: "Mira's grandmother", text: "The first Fennick to keep the herb shop. She gathered silverleaf all through the Greywinter because people needed it, and spent her last years forgetting small things, then names, then Mira's. She died four years ago.", tags: ['dead', 'mira', 'greywinter'], knownBy: ALL },
    { id: 'abel', npcId: null, name: 'Abel Ironhand', title: "Bram's father", text: "Walked the King's Road with Hobb Ambrel as a road-warden, then came home and lit the Ironhand forge fifty-three years ago. He reworked Hobb's road-warden badge into a hairpin for Wenna's wedding.", tags: ['dead', 'bram', 'hobb'], knownBy: ALL },
    { id: 'osric', npcId: null, name: 'Osric Ashby', title: 'the old Reeve', text: "Alder's father and Petra's husband, Reeve during the Greywinter. He died twelve years ago.", tags: ['dead', 'alder', 'petra', 'moot'], knownBy: ALL },
    { id: 'nan_pike', npcId: null, name: 'Nan Pike', title: 'the weaver', text: "Wys's mother, widowed in the hollow-wind winter, with three daughters younger than Wys. Her loom is on Weavers' Row.", tags: ['village', 'wys'], knownBy: ALL },
    { id: 'marl', npcId: null, name: 'Marl Haskett', title: 'a quarryman', text: "One of the Brindlecombe fourteen, taken under the Haskett flame at eight. He leads the volunteer watch's second rota and says in the Kettle that some of the men on that hill are 'our people'.", tags: ['village', 'brindlecombe', 'watch'], knownBy: ALL },
    { id: 'holloways', npcId: null, name: 'Abner and Rose Holloway', title: "Bryn's parents", text: "The coopers. Rose does the midwife's catching now, with Petra shouting advice. Since the Weeping Cut they have not sold Lyra a barrel.", tags: ['village', 'bryn'], knownBy: ALL },
    { id: 'biscuit', npcId: null, name: 'Biscuit', title: "Pip's stray", text: 'A ginger stray Pip follows everywhere. Biscuit tolerates this, sleeps on the Wayhouse step, and goes somewhere at night nobody can find out.', tags: ['cat', 'pip', 'pet'], knownBy: ALL },
    { id: 'duchess', npcId: null, name: 'Duchess', title: "Tobias's brown hen", text: "Believes the sun waits for her. She got into the Moot room and sat on the Reeve's ledger, and Tansy says she calls Moots of her own.", tags: ['chicken', 'tobias', 'tansy'], knownBy: ALL },
  ],

  lyraLife: [
    {
      id: 'born',
      age: 0,
      title: 'The Brightfall child',
      text: "I was born at midsummer in the chandlery on Lamplight Lane in Hearthvale, half a year after the Brightfall winter. My father Hobb was fifty-five and my mother Wenna fifty-two; they had buried three babies and stopped hoping. Petra Ashby caught me. Da named me for the lamplighter's star.",
      people: ['hobb', 'wenna', 'petra'],
      places: ['chandlery', 'lamplight_lane', 'hearthvale'],
      feeling: 'joy',
      importance: 8,
    },
    {
      id: 'old_folks_girl',
      age: 4,
      title: "The old folks' girl",
      text: "My hair came in midnight blue when I was two, and the old women made warding signs. I grew up on Da's shoulders on the lamp-round and at Mam's hives, learning which bees were cross. My parents couldn't run after me, so I learned not to need running after. I could always hear the Wellstone hum.",
      people: ['hobb', 'wenna'],
      places: ['lamplight_lane', 'town_square', 'wenna_hives'],
      feeling: 'affection',
      importance: 7,
    },
    {
      id: 'ward_line',
      age: 5,
      title: 'The Greywinter',
      text: "My first clear memory: standing at the ward line in the grey with Da, watching road-candles on the wrong side of it. Then a tall girl of fifteen came in through the gate and they put her in my bed. That was Sabeth. I followed her everywhere for a year.",
      people: ['hobb', 'sabeth'],
      places: ['hearthvale'],
      feeling: 'fear',
      importance: 8,
    },
    {
      id: 'first_lamp',
      age: 7,
      title: 'My first lamp',
      text: "At seven I lit my first lamp with a taper, while Da held the ladder and pretended not to be frightened. I thought I was the one lighting them all, and he let me think it.",
      people: ['hobb'],
      places: ['lamplight_lane', 'town_square'],
      feeling: 'pride',
      importance: 6,
    },
    {
      id: 'lake_ice',
      age: 8,
      title: 'Through the ice',
      text: "At eight I went out on Mirror Lake's ice too early in the winter and fell through. Corran Dell pulled me out blue as a mussel, and I bit him. I've hated deep water ever since. I don't say so.",
      people: ['corran'],
      places: ['mirror_lake'],
      feeling: 'fear',
      importance: 7,
    },
    {
      id: 'lamps_relit',
      age: 11,
      title: 'The night of the lamps',
      text: "Longwatch night, eleven years old: a hollow wind blew out every lamp on the square and knocked Da off his ladder onto the ice. Terrified, angry and freezing, I lit them all again at once, every wick, in violet fire. Da sat up and said 'Well now.' Maren came out of the Kettle in her nightgown and said, 'There goes my quiet old age.'",
      people: ['hobb', 'maren'],
      places: ['town_square', 'ember_kettle'],
      feeling: 'pride',
      importance: 10,
    },
    {
      id: 'apprentice',
      age: 13,
      title: "Maren's apprentice",
      text: "Maren taught me breath and warmth, sparks, star charts, a little Lanternwright script, how to keep a journal and how to brew tea far too strong. Her first rule, which I can say in her voice: 'Keep your own wick, little lamp. A lamp that burns for everyone burns out.' She became the mother I chose, beside the one I was born to.",
      people: ['maren'],
      places: ['ember_kettle'],
      feeling: 'affection',
      importance: 9,
    },
    {
      id: 'stillring_staff',
      age: 16,
      title: 'The Stillring and the staff',
      text: "At fifteen I learned the Stillring, Maren's polite way to say stop. At sixteen she gave me my staff with its heartglass, taken from the upper halls of the Sunken Ruins with the Moot's leave. That year I fell in love with Davin Morrow, who wanted a house by the sea and me in it.",
      people: ['maren', 'davin'],
      places: ['sunken_ruins'],
      feeling: 'joy',
      importance: 7,
    },
    {
      id: 'went_into_the_cut',
      age: 19,
      title: 'The Weeping Cut',
      text: "Davin wanted coin for the Saltmere road-guard and the Cut had crystals. I could feel it stirring and said no, and then yes, so I wouldn't be the one who made his life small. It woke around us. I cast until I guttered; Davin ran; Bryn dragged me out, and the stone crushed her leg. I lent warmth into it for three nights at Mira's. It wasn't enough.",
      people: ['davin', 'bryn', 'mira'],
      places: ['stonecut_quarry', 'herbalist'],
      feeling: 'sadness',
      importance: 10,
    },
    {
      id: 'never_again',
      age: 19,
      title: 'Never again',
      text: "Maren didn't shout. She said: 'You spent your judgment like a coin you didn't have. Never again go where you've already said no, for anyone. Not for him. Not for me.' That winter I ended things with Davin. The Holloways haven't sold me a barrel since. I learned the ward instead, and by twenty I was her right hand at the stone.",
      people: ['maren', 'davin', 'bryn'],
      places: ['town_square'],
      feeling: 'sadness',
      importance: 9,
    },
    {
      id: 'own_room',
      age: 20,
      title: 'My own room',
      text: "At twenty I moved into the room under the Ember Kettle's eaves and paid for it myself. The morning I left, Mam pressed Da's old road-warden badge into my hand, reworked into a silver crescent pin: 'Go walk your own road. And don't you dare stay anywhere for our sake.'",
      people: ['wenna', 'hobb', 'elda'],
      places: ['ember_kettle', 'chandlery'],
      feeling: 'pride',
      importance: 8,
    },
    {
      id: 'look_around',
      age: 21,
      title: 'Not the only one left',
      text: "When Bryn went to Saltmere to be a scribe, I felt like the only one left in an old village. Mam told me, not gently: 'You're not the only one left. Look around you.' So I did, and found Sabeth again, and Mira, and Hess, and Bram, and even Petra. The village was full of people. It always had been.",
      people: ['bryn', 'wenna', 'sabeth', 'mira', 'hess', 'bram', 'petra'],
      places: ['hearthvale'],
      feeling: 'affection',
      importance: 7,
    },
    {
      id: 'the_stone',
      age: 23,
      title: 'The stone, and the waystone',
      text: "Maren grew strange, up all night over star charts, talking about 'the other end on the Hollowcrown', and the Moot began to ask me to learn the Wellstone. My answer every time: not yet, and not because you need me to. Last spring I made the dead waystone toward Saltmere burn for one night. It went out at dawn.",
      people: ['maren', 'alder'],
      places: ['kings_road', 'town_square'],
      feeling: 'curiosity',
      importance: 8,
    },
    {
      id: 'davin_dies',
      age: 24,
      title: 'Davin',
      text: "This spring Davin was killed in the bandits' ambush on the King's Road. I didn't cry at the funeral. I cried in Bram's smithy, and he gave me tea and said nothing for an hour.",
      people: ['davin', 'bram'],
      places: ['smithy'],
      feeling: 'sadness',
      importance: 8,
    },
    {
      id: 'maren_goes',
      age: 24,
      title: 'My birthday',
      text: "Midsummer, my twenty-fourth birthday. Maren promised to come to supper at the chandlery and didn't. Mam had a fever and I sat up with her all night. That was the night Maren went over the ruins wall with a lantern and a rope. She left no word for me.",
      people: ['maren', 'wenna'],
      places: ['sunken_ruins', 'chandlery'],
      feeling: 'sadness',
      importance: 10,
    },
    {
      id: 'the_mountain',
      age: 24,
      title: 'The Crown Ring',
      text: "The next morning I paid Hess to take me up the Hollowcrown to 'the other end', hoping for Maren. In the Crown Ring the snow had melted in a perfect circle, and in it lay the stranger: warm and breathing, a sword beside them, no footprints anywhere. I had never seen them in my life. We carried them down on my cloak. It took two days.",
      people: ['hess', 'player'],
      places: ['hollowcrown'],
      feeling: 'surprise',
      importance: 10,
    },
    {
      id: 'little_lamp',
      age: 24,
      title: 'Little lamp',
      text: "On the fortieth night of the long sleep I was sitting watch in the chapel when the stranger said two words, asleep, plain as day, in a voice from very far away: 'little lamp'. Only Maren ever called me that.",
      people: ['player', 'maren'],
      places: ['chapel'],
      feeling: 'surprise',
      importance: 9,
    },
    {
      id: 'ruins_wall',
      age: 24,
      title: 'The ruins wall',
      text: "Later that summer I climbed the ruins wall alone at dusk on Hess's rope. The bones came up out of the dark. I bound the first one with the Stillring and went back up the rope with a skeleton's hand on my boot. On the walk home I decided I would not die in Maren's doorway. Not without the gate key.",
      people: ['hess', 'maren'],
      places: ['sunken_ruins'],
      feeling: 'fear',
      importance: 9,
    },
    {
      id: 'took_the_hearthwatch',
      age: 24,
      title: 'The hearthwatch',
      text: "Six days ago the stranger woke, and somebody had to take the hearthwatch. I took it, for my own reasons: the stipend, a second blade for the ruins, whatever ties the stranger to the ring and to Maren, plain curiosity, and a door to close between me and the Moot's questions.",
      people: ['player'],
      places: ['player_home'],
      feeling: 'curiosity',
      importance: 8,
    },
    {
      id: 'the_wolves',
      age: 24,
      title: "Wolves on the King's Road",
      text: "Two days ago, on the stranger's first walk outside the ward, the wolves came at dusk where the road runs under the edge of the wood. The stranger stood beside me instead of running. I noticed.",
      people: ['player'],
      places: ['kings_road'],
      feeling: 'trust',
      importance: 9,
    },
  ],

  mysteries: [
    {
      id: 'who_is_the_stranger',
      question: 'Who is the stranger from the mountain?',
      clues: [
        { text: 'The snow in the Crown Ring had melted in a perfect circle around the stranger, and there were no footprints anywhere, in or out.', foundAt: 'hess' },
        { text: "The stranger's boots were never scuffed, as if they had never walked anywhere, and their grey clothes are a weave nobody in the valley can name.", foundAt: 'player_home' },
        { text: "Bram cannot name the metal of the stranger's sword. It rings like the stone of the Sunken Ruins.", foundAt: 'bram' },
        { text: 'During the long sleep the stranger sometimes spoke in a language older than any Aveline knows. It sounded like singing.', foundAt: 'aveline' },
        { text: "When the stranger stood at the end of Corran's dock, Mirror Lake went still as glass and stopped humming.", foundAt: 'corran' },
        { text: 'The stranger can read a word or two of the Lanternwright carvings on the ruins, without knowing why.', foundAt: 'ruins_carvings' },
        { text: 'A bandit at the boundary stone asked Garrick, casually, about "the one the mountain gave you".', foundAt: 'garrick_alone' },
      ],
      truth:
        "The stranger is a Keeper of the Song. The keepers of the verse-house that became the Sunken Ruins sang themselves into its waygate when the Song broke; that verse runs through the ruins, the Wellstone, a drowned verse-house under Mirror Lake and the Crown Ring. When Maren stepped in at midsummer, the verse took her fresh voice and put out its most worn singer at the far end. Their memory is what a singer spends; the wrist scar is where their binding was cut; they heard Maren say 'little lamp' as she passed them in the Song; their struck-through name is cut in the gate's ring.",
      knownBy: [],
    },
    {
      id: 'where_is_maren',
      question: 'Where is Maren, and why did she go?',
      clues: [
        { text: 'Maren paid a month ahead at the Kettle before she went, as if she meant to come back.', foundAt: 'elda' },
        { text: "Maren bought rope, lamp oil and a hooded miner's lantern from Garrick the day before she went, and paid without haggling.", foundAt: 'garrick' },
        { text: 'Maren bought Mira\'s strongest moonpetal salve, "for cold hands in deep places", and asked what grows "on the far side of the old waygate".', foundAt: 'mira' },
        { text: 'Bram sharpened Maren a silver chisel, "for cutting runes out of old stone".', foundAt: 'bram' },
        { text: 'Under a crescent carved into a post in the Moonpetal Glade, in a neat hand: "M.A. was here — look up." Through a gap in the trees you can see the Hollowcrown.', foundAt: 'moonpetal_glade' },
        { text: "Maren's journal says the stones of this verse are failing, that she found the waygate alive, and that its verse runs north: from here to the Crown Ring, and past the Ring into the Pale.", foundAt: 'maren_journal' },
        { text: "On the journal's last page: a drawing of a wrist with a ring around it, labelled in script 'where the Song lets go', and one line: \"If someone comes out, I hope whoever it is is kind.\"", foundAt: 'maren_journal' },
        { text: "A fresh, bright name is cut into the ring of the waygate among a thousand old ones.", foundAt: 'waygate' },
      ],
      truth:
        "Maren did not go through to anywhere. She read that the Song is failing verse by verse as its Keepers wear out, and that when this verse fails every ward along it goes out. She went down to the waygate to join the verse as a singer, cut her own name into its ring with the silver chisel, and is there now: alive, held, singing. She chose it. She did not tell Lyra because anyone who followed would be held too, and because she wanted Lyra to have her own life. Her unfinished birthday letter, locked in Elda's strongbox, begins 'Little lamp, you are free of me, and of the stone. Keep your own wick.' She can come out only if someone willingly takes her place, or if the Song is mended.",
      knownBy: [],
    },
    {
      id: 'who_is_varek',
      question: 'Who is Varek One-Eye, and what does he want?',
      clues: [
        { text: 'The bandits pay for ale with lamp-pennies a hundred years old, the kind pilgrims left at the shrine in the ruins.', foundAt: 'elda' },
        { text: 'Aveline says some of the men on that hill are hungry farmhands, and someone should walk up it with bread and ask.', foundAt: 'aveline' },
        { text: "Marl Haskett, one of the Brindlecombe fourteen, says some of the men on that hill are 'our people'.", foundAt: 'ember_kettle' },
        { text: "Crates stamped with the chapel's seal and a Cinderwick carter's mark sit in the bandit camp.", foundAt: 'bandit_camp' },
      ],
      truth:
        "Varek One-Eye is Varek Coll of Brindlecombe, Sabeth's brother, turned away at Hearthvale's ward line in the Greywinter at seventeen; Rowan's spear took his eye on the boundary wall that night. His band are Brindlecombe's scattered survivors and farmhands with nowhere to go. He means to relight Brindlecombe's dead wardstone, and the toll pays for it. His men brought a cold blue crystal out of the ruins' lower halls that hums, and wants; with gravelight he could wake the stone without a wardwright, but it would wake as a dungeon. He killed Davin Morrow with his own axe.",
      knownBy: ['varek'],
    },
    {
      id: 'thinning_ward',
      question: 'Why is the ward thinning?',
      clues: [
        { text: "Since midsummer the Wellstone's hum has a hitch in it at dusk.", foundAt: 'town_square' },
        { text: 'There are slimes in the quarry pools, but not in the other rain-pools along that side of the hem.', foundAt: 'stonecut_quarry' },
        { text: "Bram's iron stakes on the Weeping Cut sweat in dry weather.", foundAt: 'weeping_cut' },
        { text: "Two more waystones on the King's Road went dark this summer, and Hess says Owlsend's lamps went out at midsummer.", foundAt: 'hess' },
        { text: "At night the blue light in the Sunken Ruins pulses in time with the Wellstone's hum.", foundAt: 'sunken_ruins' },
      ],
      truth:
        "Two layers. Locally: nobody tends the Wellstone now, and the crack down its face is widening. It began in the Greywinter with the grey and with blood: Rowan's spear drew blood on the boundary stones. And under the quarry the Weeping Cut is waking again; the water seeping under Bram's stakes is what crawls in the quarry pools. Across the world: every wardstone belongs to a verse of the Song, and the Song is failing as its Keepers wear out. Maren's fresh voice steadied this verse for a season. A wardwright married to the Wellstone would hold Hearthvale for years; only mending the Song would hold every ward.",
      knownBy: [],
    },
    {
      id: 'is_lyra_brightborn',
      question: 'Is Lyra brightborn?',
      clues: [
        { text: 'Lyra was born half a year after the Brightfall winter, to a mother of fifty-two, whole and as big as any baby carried nine months.', foundAt: 'petra' },
        { text: "Lyra's hair came in midnight blue, her magic woke early and strong, and her light is violet where most is white.", foundAt: 'lyra' },
        { text: 'Lyra has always heard the Wellstone hum louder than anyone, from anywhere on the square.', foundAt: 'town_square' },
      ],
      truth:
        "Yes. On the ninth night of the Brightfall Wenna walked out alone past the hem into South Meadow with her three children's names in her mouth, and asked, and the Drift answered without meaning anything by it. Lyra's hair, the color and strength of her light and her ear for the Song all come from that night. At her birth her eyes glowed violet and every candle in the room leaned toward her, and Petra pinched them out. None of it makes her one hair less Hobb and Wenna's daughter. A brightborn voice is the kind of voice a failing verse wants.",
      knownBy: [],
    },
    {
      id: 'the_greywinter_count',
      question: 'What really happened at the ward line in the Greywinter?',
      clues: [
        { text: 'The Moot let in fourteen Brindlecombe children "on the lamplighter\'s count" and turned the rest away; many died on the road to Brightwater.', foundAt: 'hobb' },
        { text: 'The Reeve spoke against letting the stranger in, then changed his vote in the night. Nobody changes their vote in the night for no reason.', foundAt: 'wenna' },
      ],
      truth:
        "Hobb counted roofs, food stores and willing households in the grey, and his answer was every soul, if families shared their flames. Reeve Osric Ashby was afraid of a starving winter and sixty strangers out of the grey, and told his son, the clerk, to read the number as fourteen. Alder did. Hobb had gone three nights without sleep and has believed for nineteen years that he said fourteen. This summer Alder heard the Wellstone hum toward the stranger lying at the ward line and could not turn away a found one twice; at dawn he changed his vote, knowing it spent one of the stone's four free places.",
      knownBy: ['alder'],
    },
    {
      id: 'owlsend_dark',
      question: "Why have Owlsend's lamps gone dark?",
      clues: [
        { text: "Hess says Owlsend's lamps could be seen from the shoulder of the Hollowcrown on clear nights, and at midsummer they could not. Somebody ought to say it out loud.", foundAt: 'hess' },
        { text: 'Cinderwick carters at the fork say a runner came down the north track asking the way to the nearest lit ward.', foundAt: 'garrick_carters' },
      ],
      truth:
        "Owlsend's ward failed in a long grey at midsummer. Twenty-three people survived in its cellars, seven households with five road-candles still lit, and before winter they will walk south to the nearest live ward, which is Hearthvale's: first Ketty Brask, fourteen, daughter of their dead wardrunner, and four days behind her the rest, led by her grandfather Gethin, Owlsend's chapel keeper. The stone bears forty-one, thirty-eight burn, and the stranger's flame took the fourth free place.",
      knownBy: [],
    },
    {
      id: 'why_the_song_broke',
      question: 'Why did the Song break?',
      clues: [{ text: 'The deepest carvings in the Sunken Ruins speak of singers who chose, and singers who were bound.', foundAt: 'ruins_depths' }],
      truth:
        "The Song was always paid for in singers: in every verse a few Keepers entered through a waygate and stayed, held out of time, singing. A verse sung by people who chose it holds; one sung by the unwilling frays. In their last age the Lanternwrights stopped choosing it and bound prisoners, debtors, foundlings and the brightborn to sing in their place, and in a single winter the bound verses broke and the Song came apart. Mending it would mean asking people to vanish. What is given unwillingly does not hold.",
      knownBy: [],
    },
    {
      id: 'mirror_lake_hum',
      question: 'What hums under Mirror Lake?',
      clues: [
        { text: 'Pip says Corran hums to the lake on still nights, and the lake hums back.', foundAt: 'pip' },
        { text: "Corran says the lake hasn't gone silent like it did under the stranger since the night of the ferry.", foundAt: 'mirror_lake' },
      ],
      truth:
        'A second verse-house of the same verse lies drowned at the bottom of Mirror Lake, and its waygate is not dead either. It stirred the night of the ferry, and it knew a Keeper when one stood on the dock.',
      knownBy: [],
    },
    {
      id: 'map_to_a_well',
      question: "What is the map behind Garrick's counter?",
      clues: [{ text: "Garrick's framed chart, bought in Owlsend for a goat, shows a well with a star over it and three marks joined to it by fine lines, and one word of script nobody can read.", foundAt: 'general_store' }],
      truth:
        "A Lanternwright chart of this verse. The well is Hearthvale's, drawn before Hearthvale existed; the three marks are a temple in a marsh, a ring on a mountain and a house under water. Its one word, which the stranger can read, means 'verse'.",
      knownBy: [],
    },
    {
      id: 'rowans_father',
      question: "What became of Rowan's father?",
      clues: [{ text: 'Ewan Vale marched to the Border Wars when Rowan was five and never came home.', foundAt: 'rowan' }],
      truth: 'Ewan Vale did not die in the Border Wars: he walked away from them. He lives in Saltmere with another wife and children. Aveline met him there fourteen years ago, and he begged her to keep silent.',
      knownBy: ['aveline'],
    },
  ],
};

// The Book of Halcyre (DESIGN §20): the lore as an in-game book, in chapters. Each chapter
// lists story entries as lorebook keys ('world:halcyre', 'place:p_chandlery', ...) in reading
// order. `unlock` says how its pages open for the player:
//   'start' - open from the first page of a new game;
//   'seen'  - each place page opens when the player first enters its locationId;
//   'met'   - each person page opens when the player first talks to them (npcId), and the
//             absent ones when someone first names them to the player;
//   'told'  - each page opens when Lyra tells it (her life: a life memory she shares);
//   'clue'  - a mystery page opens with its first clue found, and shows only the clues found.
// Every page is in exactly one chapter. A mystery's truth is never a page.
const keys = (kind, ids) => ids.map((id) => `${kind}:${id}`);
export const BOOK_CHAPTERS = [
  {
    id: 'halcyre', title: 'The Lit Hall', unlock: 'start',
    blurb: 'Halcyre, the Lanternwrights, and the Song that broke.',
    entries: [...keys('world', ['halcyre', 'lanternwrights', 'the_song', 'waygates', 'lowmarch', 'crownfells', 'hollowcrown', 'pale_reach']), ...keys('timeline', ['age_of_lanterns', 'unlighting', 'hearth_years', 'crowned_road', 'the_guttering'])],
  },
  {
    id: 'drift', title: 'The Drift', unlock: 'start',
    blurb: 'Loose magic, moving over the land like weather.',
    entries: keys('world', ['the_drift', 'glimmer', 'the_grey', 'hollow_wind', 'brightfall', 'the_turning']),
  },
  {
    id: 'wards', title: 'Wards and Kept Flame', unlock: 'start',
    blurb: 'Why people live close together, and what keeps them alive.',
    entries: keys('world', ['wards', 'wardstones', 'kept_flame', 'letting_in', 'keepers', 'marrying_the_stone', 'bell_reach', 'ward_customs', 'road_candles', 'waystones', 'kings_road_history']),
  },
  {
    id: 'magic', title: 'Magic', unlock: 'start',
    blurb: 'Every kind of magic, what it costs, and what the neighbors think.',
    entries: keys('world', ['hearthcraft', 'lumencraft', 'lyra_workings', 'binding_light', 'lyra_staff', 'greenwit', 'forgesong', 'songcraft', 'brightborn', 'gravelight', 'small_charms']),
  },
  {
    id: 'dungeons', title: 'Dungeons', unlock: 'start',
    blurb: 'Where the spilled magic pooled, and what it makes.',
    entries: [...keys('world', ['dungeons', 'dungeon_creatures', 'delving', 'weeping_cut', 'famous_dungeons']), ...keys('place', ['p_sunken_ruins'])],
  },
  {
    id: 'lowmarch', title: 'The Other Villages', unlock: 'start',
    blurb: 'Coals in a dark grate: the places Hearthvale trades with, and the dead ones.',
    entries: keys('world', ['brightwater', 'saltmere', 'cinderwick', 'owlsend', 'brindlecombe', 'glasswater_isles']),
  },
  {
    id: 'hearthvale', title: 'Hearthvale', unlock: 'start',
    blurb: 'A kettle-fire, a well and a chapel, kept for three hundred and twelve years.',
    entries: [
      ...keys('world', ['hearthvale_founding', 'the_ambrels', 'hearth_faith', 'flame_count', 'hearthmoot', 'moot_laws', 'looks_after_its_own', 'hearthwatch', 'threshold_night', 'festivals', 'sheaf_moot', 'lamplighters_star', 'sayings', 'oil_trouble']),
      ...keys('timeline', ['hearthvale_founded', 'ruins_locked', 'road_candle']),
    ],
  },
  {
    id: 'places', title: 'Places', unlock: 'seen',
    blurb: 'The village and the country around it, as you walk it.',
    entries: keys('place', ['p_hearthvale', 'p_town_square', 'p_wayhouse', 'p_ember_kettle', 'p_chapel', 'p_smithy', 'p_general_store', 'p_herbalist', 'p_guardhouse', 'p_lamplight_lane', 'p_chandlery', 'p_ashby_house', 'p_dye_cottage', 'p_weavers_row', 'p_farmhouse', 'p_reed_farm', 'p_whisperwood', 'p_wenna_hives', 'p_moonpetal_glade', 'p_quarry', 'p_mirror_lake', 'p_net_shed', 'p_south_meadow', 'p_kings_road', 'p_bandit_camp', 'p_ruins_halls']),
  },
  {
    id: 'people', title: 'The People of Hearthvale', unlock: 'met',
    blurb: 'Eighteen neighbors, and the people they miss.',
    entries: keys('person', [...VILLAGE, 'maren', 'bryn', 'davin', 'varek', 'hanna', 'tam', 'june', 'maudie', 'edric', 'ewan', 'jory', 'ansel_bee_jem', 'tarrows', 'rosalind', 'abel', 'osric', 'nan_pike', 'marl', 'holloways', 'biscuit', 'duchess']),
  },
  {
    id: 'story', title: 'The Story So Far', unlock: 'start',
    blurb: 'From the Brightfall winter to the stranger on the mountain.',
    entries: [
      ...keys('timeline', ['hobb_takes_road', 'forge_lit', 'hobb_home', 'border_wars', 'aveline_comes', 'brightfall_winter', 'lyra_born', 'elda_comes', 'hollow_wind_winter', 'greywinter', 'maren_comes', 'night_of_lamps', 'new_reeve', 'jory_returns', 'maudie_goes', 'hanna_dies', 'the_cut', 'rosalind_dies', 'three_years_ago', 'ferry', 'bandits_come', 'the_ambush', 'maren_goes_in', 'stranger_found', 'long_sleep', 'stranger_wakes', 'wolves_on_road', 'now']),
      ...keys('world', ['maren_preparations', 'other_end', 'the_stranger', 'stranger_whispers', 'varek_band', 'stolen_key', 'ruins_fine', 'the_stone_question']),
    ],
  },
  {
    id: 'lyra', title: 'Lyra Ambrel', unlock: 'told',
    blurb: 'Her life, as she tells it.',
    entries: [...keys('life', STORY.lyraLife.map((e) => e.id)), ...keys('world', ['brightborn_whispers', 'little_lamp_words', 'far_lamps', 'waystone_night', 'wellstone_hitch', 'elda_lantern'])],
  },
  {
    id: 'mysteries', title: 'Open Questions', unlock: 'clue',
    blurb: 'What nobody in Hearthvale can answer yet.',
    entries: keys('mystery', STORY.mysteries.map((e) => e.id)),
  },
];

export { VILLAGE as STORY_VILLAGERS };
