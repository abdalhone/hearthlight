// The Book of Halcyre: what the player knows of the world, as an illustrated book
// (DESIGN §20). Pages come from two places: the book's own pages below (written from
// docs/LORE.md, common knowledge only) and the lore in src/lore/story.js (entries everyone
// in the valley knows, shown once the player has met them). A page opens when the player
// learns it: the prologue opens the basics; places, people and story scenes open the rest.
// Nothing here is a truth LORE §9 keeps hidden; story.js mysteries show their question only.

export const CHAPTERS = [
  { id: 'world', title: 'The World', panel: 'the_drift', intro: 'Why people live close together, and what moves over the land between the villages.' },
  { id: 'magic', title: 'Magic', panel: 'night_of_lamps', intro: 'Halcyre has every kind of magic. What differs is what each one costs, and what the neighbours think of you for using it.' },
  { id: 'dungeons', title: 'Dungeons', panel: 'weeping_cut', intro: 'Where the spilled magic pooled underground and began to behave like something alive.' },
  { id: 'hearthvale', title: 'Hearthvale', panel: 'hearthvale_dusk', intro: 'One lamp in a large, dark room: the village that took you in.' },
  { id: 'people', title: 'The People', panel: 'brightfall', intro: 'Everyone you have met in Hearthvale, as the village knows them.' },
  { id: 'lyra', title: 'Lyra', panel: 'the_climb', intro: 'The woman who carried you down a mountain, and why she lives the way she lives.' },
  { id: 'stranger', title: 'The Stranger', panel: 'crown_ring', intro: 'You. What the valley knows about you, which is more than you do.' },
  { id: 'story', title: 'The Story So Far', panel: 'long_sleep', intro: 'What has happened, and the questions nobody can answer yet.' },
];

// The book's own pages. unlock: 'prologue', or the ids of events that open them (see
// unlocksForEvent): 'place:<location id>', 'scene:<scene id>', 'met:<npc id>'.
export const PAGES = [
  // ------------------------------------------------------------------ the world
  { id: 'halcyre', chapter: 'world', title: 'Halcyre, the lit hall', unlock: 'prologue',
    text: 'The world is called Halcyre, a word older than any kingdom. In the speech of the Lanternwrights, the mage-builders of the deep past, it means something like the lit hall. They believed the world was one great hall, and that their work was to keep its lamps burning. For a long time, they did.' },
  { id: 'the_song', chapter: 'world', title: 'The Song and the Unlighting', unlock: 'prologue',
    text: 'The Lanternwrights held the world’s wild magic still with one great working they called the Song, sung into stone: wardstones, waystones, and great stone rings called waygates. About a thousand years ago the Song broke. The Lowmarch calls that time the Unlighting. Nobody alive knows why it happened.' },
  { id: 'the_drift', chapter: 'world', title: 'The Drift', unlock: 'prologue',
    text: 'When the Song broke, the magic did not vanish. It spilled. Now it moves over the open land the way weather does. It is not evil; it is power with no purpose, and it changes what it touches.\n\nGlimmer: a sparkling haze at dusk that turns lamps blue. The grey: a fog that makes things forget themselves; a long grey is how villages die. Hollow wind: a dry cold that steals warmth. Brightfall: light that falls like snow on still winter nights. The turning: what the Drift does to beasts, and to still water, which crawls away as slimes.' },
  { id: 'wards', chapter: 'world', title: 'Wards', unlock: 'prologue',
    text: 'Nobody lives in the Drift for long, so people live inside wards. At the heart of each is a wardstone the Lanternwrights left behind, still humming with a scrap of the Song. A stone is cold on its own: it is fed by flames kept on purpose, one for every household, on the chapel altar. Hearthvale’s ward reaches about as far as the chapel bell can be heard on a still day, the bell-reach. Its thin outer band is the hem.\n\nWhy it matters: every rule in the village, every lamp, every argument about who may come in, is about keeping that ward up.' },
  { id: 'roads', chapter: 'world', title: 'The King’s Road and the waystones', unlock: 'place:kings_road',
    text: 'Four hundred years ago a king laid the King’s Road from Saltmere on the coast to the mountains, and raised waystones along it: tall pillars with a lamp niche at the top. A lit waystone throws a small ward across the road, enough for a caravan to shelter under for a night. Perhaps one in three still burns. Travellers carry a road-candle, a flame from their home hearth in a shuttered lantern, and never camp where they cannot see a waystone.' },
  { id: 'villages', chapter: 'world', title: 'The other villages', unlock: 'prologue',
    text: 'About thirty villages in the Lowmarch still keep a ward, a few days apart. Brightwater, a river town three days south-east. Saltmere, the harbour town on the coast, twelve days away, with its delvers’ guild and its sea-wall of names. Cinderwick, the mining village in the eastern hills, whose oil burns in every street lamp in Hearthvale. Owlsend, small and stubborn, three days north under the mountains. And Brindlecombe, a day and a half west, dead since the Greywinter nineteen years ago, its doors still standing open.' },
  { id: 'hollowcrown', chapter: 'world', title: 'The Hollowcrown and the Crown Ring', unlock: 'prologue',
    text: 'The Hollowcrown is the nearest and highest peak of the Crownfells, a day and a half’s climb north, its broken summit white even in summer. On its shoulder above the treeline stands the Crown Ring: nine broken standing stones in a circle, carved with worn Lanternwright script, deep in snow at midsummer. Hearthvale has always called it a dead waygate. Maren’s notes called it the other end.' },

  // ------------------------------------------------------------------ magic
  { id: 'hearthcraft', chapter: 'magic', title: 'Hearthcraft', unlock: 'prologue',
    text: 'The magic of kept flame and boundaries: of saying here, and not past here. A chalk mark over a door is hearthcraft; so is the chapel’s ring of family flames. A wardwright binds herself to a village’s stone, tends it and feels every crack in it as an ache in her own bones; she cannot go more than a day’s walk from it. Villagers call that marrying the stone. It is the only magic everyone trusts, and the one they most expect someone else to carry for them.' },
  { id: 'lumencraft', chapter: 'magic', title: 'Lumencraft, the Lamp-art', unlock: 'prologue',
    text: 'The art of shaping light into force: a bolt, a shield, a ring that holds. A lumencrafter makes the light out of her own warmth, so every spell takes a little heat from her body. Push too far and she goes blue-lipped with lamp-chill; past that, she gutters: faints, cold as stone. That is why lumencrafters love fires, wool, strong tea and moonpetals, and why the good ones carry a heartglass in their staff, a crystal that stores warmth to spend instead of their own blood. Lyra is a lumencrafter.' },
  { id: 'lyra_workings', chapter: 'magic', title: 'Sparks, lending warmth, the Stillring', unlock: 'scene:night_of_lamps',
    text: 'Lyra has three workings. Sparks: light thrown hard enough to strike; hers burn violet, which is unusual. Lending warmth: pouring her own warmth into someone else’s body to speed its mending, the hardest and costliest thing she does. Maren’s rule: never lend more than you can live without. And the Stillring, Maren’s own invention: a ring of violet light that closes around someone’s feet and tells them, for a few heartbeats, not past here. Maren called it the polite way to say stop.' },
  { id: 'greenwit', chapter: 'magic', title: 'Greenwit', unlock: 'place:herbalist',
    text: 'Some plants hold magic. Moonpetals open only at night and warm cold hands. Silverleaf knits flesh. Lindenflower honey keeps for a hundred years. A greenwitch does not cast; she prepares. The risk is in the gathering: herbs cut in drift-weather bring the weather home with them. Mira Fennick does not gather in drift-weather, for anyone.' },
  { id: 'forgesong', chapter: 'magic', title: 'Forgesong', unlock: 'place:smithy',
    text: 'Some smiths put something into iron as they work it, mostly without meaning to. A forgesung blade bites slimes and turned beasts like cloth. The iron keeps what the smith felt while it was sung. Bram Ironhand’s blades are better than anyone else’s, and he would be offended to hear it called magic.' },
  { id: 'gravelight', chapter: 'magic', title: 'Gravelight', unlock: 'place:sunken_ruins',
    text: 'The dungeons’ own magic: cold blue light that wears the bones of the dead and walks them as skeletons, and flies the dark as bats. It is not given; it is borrowed from something that wants it back. Every Moot in the Lowmarch forbids it. Since midsummer it has moved in the Sunken Ruins after dark.' },
  { id: 'brightborn', chapter: 'magic', title: 'The brightborn', unlock: 'prologue',
    text: 'Some people are touched by the Drift: born under brightfall, or caught in glimmer as children. They come away with something: a knack for finding water, eyes that see in the dark, hair the colour of a night sky, magic that wakes too strong and too early. Villagers call them brightborn, or less kindly drift-touched, and the old women make warding signs. For twenty-four years Hearthvale has whispered it about Lyra. She has decided not to care.' },
  { id: 'small_charms', chapter: 'magic', title: 'Small charms', unlock: 'prologue',
    text: 'The magic everyone does without calling it magic: knots in a hair-ribbon, salt across a sill, a bell on a goat, humming to the fish, a spoon of honey left on the doorstep on Longwatch night. Most of it does nothing at all. All of it makes people braver in the dark, which in Halcyre is half of what any magic is for.' },

  // ------------------------------------------------------------------ dungeons
  { id: 'dungeons', chapter: 'dungeons', title: 'What a dungeon is', unlock: 'prologue',
    text: 'When the Song broke, some of the spilled magic ran downhill into caves, mines and the buried works of the Lanternwrights, and pooled. The pools became dungeons: places where magic gathers so thickly it starts to behave like something alive. They sleep for years, then wake, slowly, and push their creatures out: slimes, bats, skeletons. They also grow glow crystals, the most valuable thing a dungeon gives.' },
  { id: 'delving', chapter: 'dungeons', title: 'Delving', unlock: 'scene:maren_gate',
    text: 'To delve is to go into a dungeon on purpose and come out with something. In the towns it is a trade with a guild. In the villages it is forbidden without the Moot’s leave, because a delver who wakes a dungeon wakes it for everyone. Delvers go in pairs, with road-candles and rope, and agree beforehand when to turn back. The old rule: the deep pays the one who leaves first.' },
  { id: 'sunken_ruins', chapter: 'dungeons', title: 'The Sunken Ruins', unlock: 'prologue',
    text: 'An old walled temple half swallowed by the marsh south-west of Hearthvale: fallen pillars, blue lichen, stone that rings when you strike it. Its wall is twice a man’s height. The iron gate has been locked by order of the chapel for a hundred and ten years; the bandits took its key this spring. Maren Ashgrove went over the wall at midsummer. That night the blue lights began.' },
  { id: 'weeping_cut', chapter: 'dungeons', title: 'The Weeping Cut', unlock: 'place:stonecut_quarry',
    text: 'A small, old working under the north face of Stonecut Quarry. Quarrymen broke into it two hundred years ago and heard it dripping. Five years ago three young people went in without leave and woke it. The Moot sealed it with iron stakes Bram forged, and they hold the door.' },

  // ------------------------------------------------------------------ hearthvale
  { id: 'hearthvale', chapter: 'hearthvale', title: 'Hearthvale', unlock: 'prologue',
    text: 'Three hundred and twelve years ago a caravan sheltered from a hollow wind beside the road, and a widow named Gerda Mead kept one kettle-fire burning all night. In the morning they found a well beside it with a living wardstone at the bottom. Gerda’s fire is still the hearth of the Ember Kettle and has never once gone out. About a hundred and fifty people live here now.' },
  { id: 'wellstone', chapter: 'hearthvale', title: 'The Wellstone', unlock: 'prologue',
    text: 'Hearthvale’s wardstone lies at the bottom of the well in the square, under an iron-banded cap. On very still nights, if you lean over the well, you can hear it hum. When you were carried past it, it hummed loud enough for everyone to hear.' },
  { id: 'family_flames', chapter: 'hearthvale', title: 'The family flames', unlock: 'prologue',
    text: 'Every household keeps one flame on the altar of the Chapel of the Hearth. Together they are the Hearthlight, and they hold the ward up. Thirty-eight burn there now, and anyone can count them. How many the stone can bear is a number the Moot keeps to itself. A road-candle has burned in the chapel window for sixty years, for whoever is still on the road.' },
  { id: 'moot', chapter: 'hearthvale', title: 'The Hearthmoot and its laws', unlock: 'place:ember_kettle',
    text: 'The head of every household that keeps a flame meets in the Ember Kettle’s back room when there is business. The Moot elects a Reeve, Alder Ashby, to keep its ledgers. Captain Rowan Vale keeps the watch. The laws are few and old: keep your flame; nobody goes outside the ward alone, and nobody past the wall of the Sunken Ruins at all; no blood inside the bell-reach; no delving without leave; strangers keep threshold night and a season of hearthwatch.' },
  { id: 'customs', chapter: 'hearthvale', title: 'Customs', unlock: 'prologue',
    text: 'At sunset the chapel bell rings once and the lamplighter begins his round; children still out when the bell rings run home. Anyone let in from outside spends their first night under the chapel roof. A newcomer is not left alone under a roof for their first season: a villager takes the hearthwatch, holds the key and looks in, and can hand it back to the Reeve at any time. Two households marry by joining flames. On Longwatch, the longest night, nobody sleeps.' },
  { id: 'sheaf_moot', chapter: 'hearthvale', title: 'The Sheaf Moot', unlock: 'prologue',
    text: 'The harvest festival, ten days off: the last sheaf from Reed Farm burned on the well-cap, a dance in the square, the hammer-throw, a ribbon for the biggest turnip. This year the Moot has two hard questions: what to do about the bandits, and whether to ask Lyra Ambrel, in front of everyone, to marry the stone.' },
  { id: 'worries', chapter: 'hearthvale', title: 'What worries the village', unlock: 'place:town_square',
    text: 'The bandits are the worry people say aloud: a band under a one-eyed man in the hills above the Cinderwick fork, who toll the carts, killed two of the watch this spring, and took the ruins key. The ruins are the worry people say quietly. The ward is the worry almost nobody says at all: without a wardwright it is thinning; there are slimes in the quarry and the wolves are bolder every night. And winter is coming.' },

  // ------------------------------------------------------------------ lyra
  { id: 'lyra', chapter: 'lyra', title: 'Lyra Ambrel', unlock: 'prologue',
    text: 'Twenty-four, a lumencrafter, Maren Ashgrove’s apprentice since she was eleven, and the daughter of Hobb the lamplighter and Wenna the beekeeper. Midnight-blue hair with one braid and a silver crescent pin; a violet-and-teal cloak; an ash staff tipped with a heartglass.\n\nShe lives for herself. She travels with you because she chooses to, while it is good for her, and every order is a request she weighs. She is warm, nosy and teasing, she says no once and plainly, with her reason, and she pays back every favour.' },
  { id: 'hearthwatch', chapter: 'lyra', title: 'The hearthwatch', unlock: 'prologue',
    text: 'Lyra holds your key. Six days ago, when you woke, the Moot needed someone to keep the hearthwatch on you, and she took it: the stipend, a second blade, curiosity, and whatever ties you to the ring where she found you. Nobody is obliged to keep a hearthwatch. She took yours because she wanted to.' },
  { id: 'night_of_lamps', chapter: 'lyra', title: 'The night of the lamps', unlock: 'scene:night_of_lamps',
    text: 'On Longwatch night when she was eleven, a hollow wind blew out every lamp on the square and knocked her father off his ladder onto the ice. Frightened, angry and freezing, Lyra lit them all again at once, in violet fire. One lamp burst. Her father sat up and said, “Well now.” Maren came out of the Ember Kettle in her nightgown and said, “Well. There goes my quiet old age.” She took Lyra on the next morning.' },
  { id: 'her_parents', chapter: 'lyra', title: 'Hobb and Wenna', unlock: 'scene:meet_ambrels',
    text: 'Her parents married late and buried three babies before she came: Ansel, Bee and little Jem. Hobb has lit every lamp in the valley for forty-one years and still cannot find his spectacles; he calls her Star. Wenna, nearly blind, finds her hives by their sound and scolds with full names. When Lyra moved out, Wenna told her: don’t you dare stay anywhere for our sake.' },
  { id: 'the_cut_told', chapter: 'lyra', title: 'What happened in the Cut', unlock: 'scene:weeping_cut',
    text: 'She told you herself. At nineteen she went into the Weeping Cut against her own judgment, because Davin asked and she did not want to be the one who made his life small. It woke. Bryn carried her out, and the stone took Bryn’s leg. Maren said: you spent your judgment like a coin you didn’t have; never again go where you’ve already said no, for anyone. That is why her no is a no.' },

  // ------------------------------------------------------------------ the stranger
  { id: 'found', chapter: 'stranger', title: 'How you were found', unlock: 'prologue',
    text: 'Two days after Maren went into the ruins, Lyra and Hess Morrow reached the Crown Ring at dawn. In the middle the snow had melted in a perfect circle, and you lay in it: warm, breathing, impossible to wake, a sword beside you. There were no footprints, in or out. They bound your hands loosely and carried you down on a litter made of Lyra’s cloak. It took two days.' },
  { id: 'long_sleep', chapter: 'stranger', title: 'The long sleep', unlock: 'prologue',
    text: 'The Moot argued at the ward line until midnight about letting a found one in, and at dawn it did. When you were carried past the well, the Wellstone hummed for everyone to hear, and in the chapel the road-candle leaned toward you and burned tall. Your threshold night lasted eighty-one nights. Sister Aveline sat with you, Mira brewed moonpetal broth, Elda spooned it in, and Lyra took her turns at the watch. Six days ago you woke, remembering nothing.' },
  { id: 'clues', chapter: 'stranger', title: 'What you came with', unlock: 'prologue',
    text: 'Clothes of a fine grey weave nobody in the valley could name, now folded in the chest at the foot of your bed. Boots with unscuffed soles, as if they had never walked anywhere. No pack, no food, no road-candle, and nobody survives a night outside a ward without one. A sword of dark metal. A thin pale scar around one wrist, like a bracelet. Sabeth sewed what you wear now.' },
  { id: 'flames_lean', chapter: 'stranger', title: 'The flames lean', unlock: 'scene:chapel_candles',
    text: 'When you come near the chapel altar, every one of the thirty-eight family flames leans toward you, the way a flower leans to a window. Sister Aveline says they did it every night of the long sleep. She calls you a question someone has sent us.' },

  // ------------------------------------------------------------------ the story so far
  { id: 'maren_gone', chapter: 'story', title: 'Maren went into the ruins', unlock: 'prologue',
    text: 'Three months ago, at midsummer, on Lyra’s twenty-fourth birthday, Maren Ashgrove, Hearthvale’s wardwright for nineteen years, walked toward the Sunken Ruins at dusk with a lantern and a rope, went over the wall, and did not come back. She left no word for Lyra that Lyra knows of.' },
  { id: 'wolves', chapter: 'story', title: 'The wolves on the King’s Road', unlock: 'prologue',
    text: 'Two days ago, on your first walk outside the ward, wolves came at dusk where the road passes under the edge of the wood. You stood beside Lyra instead of running. She noticed.' },
  { id: 'aveline_saw', chapter: 'story', title: 'What Aveline saw', unlock: 'scene:maren_aveline',
    text: 'Sister Aveline saw Maren go: dusk on the longest day, her grey cloak, a lantern, a coil of rope over her shoulder, walking toward the marsh as if she were late for supper. Aveline called after her. Maren raised her hand and did not turn around. Maren had paid a month ahead at the Kettle and bought turnips for a long walk.' },
  { id: 'the_gate', chapter: 'story', title: 'The ruins gate', unlock: 'scene:maren_gate',
    text: 'Lyra will not go into the ruins again without the key. She climbed the wall once, alone, on Hess’s rope, and came back up it with a skeleton’s hand on her boot. A gate is a way out you can run through; a rope is not. The bandits have the key.' },
  { id: 'the_journal', chapter: 'story', title: 'Maren’s journal', unlock: 'scene:maren_journal',
    text: 'At the foot of the stair in the ruins, Maren left her journal. Its last line: “If someone comes out, I hope whoever it is is kind.” Someone did come out, at the other end.' },
];

// Open questions shown in The Story So Far (questions only: answers are the game's to give).
export const QUESTIONS = [
  { id: 'q_stranger', unlock: 'prologue', text: 'Who are you, and how did you come to be lying warm in the snow inside the Crown Ring?' },
  { id: 'q_maren', unlock: 'prologue', text: 'Where is Maren, and why did she go?' },
  { id: 'q_bandits', unlock: 'place:town_square', text: 'Who is the one-eyed man in the hills, and what does he want?' },
  { id: 'q_ward', unlock: 'place:stonecut_quarry', text: 'Why are there slimes in the quarry pools, and nowhere else along the hem?' },
  { id: 'q_owlsend', unlock: 'met:hess', text: 'Hess says Owlsend’s lamps could not be seen at midsummer. What happened there?' },
];

// What the prologue teaches: every page and question marked 'prologue', plus the
// common-knowledge story.js entries of the same ideas.
export const PROLOGUE_UNLOCKS = [
  ...PAGES.filter((p) => p.unlock === 'prologue').map((p) => p.id),
  ...QUESTIONS.filter((q) => q.unlock === 'prologue').map((q) => q.id),
  'halcyre', 'lanternwrights', 'the_song', 'the_drift', 'glimmer', 'the_grey', 'hollow_wind', 'brightfall', 'the_turning',
  'wards', 'wardstones', 'kept_flame', 'bell_reach', 'hollowcrown', 'other_end', 'the_stranger', 'p_hearthvale', 'p_wayhouse',
  'hearthvale_founding', 'hearth_faith', 'hearthwatch', 'threshold_night', 'lumencraft', 'hearthcraft', 'maren', 'lyra', 'hess',
];

const PLACE_EVENTS = ['enter_location'];

// Which pages an event opens. Places open their pages (and story.js's place entry
// 'p_<id>'); meeting someone (being near them) opens their page.
export function unlocksForEvent(type, p, game) {
  if (PLACE_EVENTS.includes(type)) {
    if (p?.actor && p.actor !== game?.player) return null;
    const id = typeof p?.location === 'string' ? p.location : p?.location?.id;
    if (!id) return null;
    const key = `place:${id}`;
    return [`p_${id}`, ...PAGES.filter((pg) => pg.unlock === key).map((pg) => pg.id), ...QUESTIONS.filter((q) => q.unlock === key).map((q) => q.id)];
  }
  if (type === 'npc_met') {
    const id = p?.id;
    if (!id) return null;
    const key = `met:${id}`;
    return [id, ...PAGES.filter((pg) => pg.unlock === key).map((pg) => pg.id), ...QUESTIONS.filter((q) => q.unlock === key).map((q) => q.id)];
  }
  if (type === 'story_scene') {
    const key = `scene:${p?.id}`;
    return [...PAGES.filter((pg) => pg.unlock === key).map((pg) => pg.id), ...QUESTIONS.filter((q) => q.unlock === key).map((q) => q.id)];
  }
  if (type === 'memory_added') {
    // A secret Lyra chose to tell the player opens the matching page of her life.
    const m = p?.memory;
    if (!m || !Array.isArray(m.tags) || !m.tags.includes('secret')) return null;
    const t = String(m.text || '').toLowerCase();
    const out = [];
    if (t.includes('little lamp')) out.push('little_lamp_words');
    if (t.includes('far lamps')) out.push('far_lamps');
    return out;
  }
  return null;
}
