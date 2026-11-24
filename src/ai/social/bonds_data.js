// Who stands how with whom in Hearthvale (docs/LORE.md §6 "The relationship map", each
// profile's "His/Her people", and §7 "Lyra's people"). Pure data.
//
// A bond is directed: bond(a, b) is how a stands toward b. `tags` name what b is to a
// (bond('hobb', 'lyra').tags has 'child'; bond('lyra', 'hobb').tags has 'parent').
// Numbers use the game's scale: affinity -100..100, trust 0..100, familiarity 0..100.
// Notes are public knowledge only: they reach Claude's prompts, so no secret (LORE §9.10)
// may ever be written here.

export const VILLAGERS = ['hobb', 'wenna', 'elda', 'bram', 'pip', 'rowan', 'mira', 'tobias', 'aveline', 'garrick', 'hess', 'sabeth', 'alder', 'petra', 'tilly', 'tansy', 'corran', 'wys'];
export const PEOPLE = [...VILLAGERS, 'lyra'];

export const FULL_NAMES = {
  hobb: 'Hobb Ambrel',
  wenna: 'Wenna Ambrel',
  elda: 'Elda Thornbury',
  bram: 'Bram Ironhand',
  pip: 'Pip',
  rowan: 'Captain Rowan Vale',
  mira: 'Mira Fennick',
  tobias: 'Tobias Reed',
  aveline: 'Sister Aveline',
  garrick: 'Garrick "Gale" Hale',
  hess: 'Hesper "Hess" Morrow',
  sabeth: 'Sabeth Coll',
  alder: 'Alder Ashby',
  petra: 'Petra Ashby',
  tilly: 'Ottilie "Tilly" Ashby',
  tansy: 'Tansy Reed',
  corran: 'Corran Dell',
  wys: 'Wystan "Wys" Pike',
  lyra: 'Lyra Ambrel',
};

// How the village names them in passing (third person).
export const SHORT_NAMES = {
  hobb: 'Hobb',
  wenna: 'Wenna',
  elda: 'Elda',
  bram: 'Bram',
  pip: 'Pip',
  rowan: 'Rowan',
  mira: 'Mira',
  tobias: 'Tobias',
  aveline: 'Aveline',
  garrick: 'Garrick',
  hess: 'Hess',
  sabeth: 'Sabeth',
  alder: 'Alder',
  petra: 'Petra',
  tilly: 'Tilly',
  tansy: 'Tansy',
  corran: 'Corran',
  wys: 'Wys',
  lyra: 'Lyra',
};

export const ROLES = {
  hobb: 'chandler and lamplighter',
  wenna: 'beekeeper and songkeeper',
  elda: 'innkeeper',
  bram: 'blacksmith',
  pip: 'orphan',
  rowan: 'captain of the watch',
  mira: 'herbalist',
  tobias: 'farmer',
  aveline: 'keeper of the chapel',
  garrick: 'merchant',
  hess: 'huntress and wardrunner',
  sabeth: 'dyer and seamstress',
  alder: 'Reeve of the Hearthmoot',
  petra: 'retired midwife',
  tilly: "smith's apprentice",
  tansy: 'chicken-keeper and apprentice wardrunner',
  corran: 'fisherman',
  wys: 'watchman',
  lyra: 'lumencrafter',
};

export const CHILDREN = new Set(['pip']);
export const YOUNG = new Set(['pip', 'tansy', 'tilly', 'wys']);
export const GENDER = {
  hobb: 'm', wenna: 'f', elda: 'f', bram: 'm', pip: 'm', rowan: 'm', mira: 'f', tobias: 'm', aveline: 'f', garrick: 'm',
  hess: 'f', sabeth: 'f', alder: 'm', petra: 'f', tilly: 'f', tansy: 'f', corran: 'm', wys: 'm', lyra: 'f',
};

// Everyone in a village of a hundred and fifty knows everyone else a little.
export const BASELINE = { affinity: 12, trust: 50, familiarity: 62, tags: [], note: '' };
export const BASELINE_YOUNG = { affinity: 10, trust: 45, familiarity: 50, tags: [], note: '' };

// [a, b, affinity, trust, familiarity, tags, note]: how a stands toward b.
export const SEED_BONDS = [
  // Hobb
  ['hobb', 'wenna', 95, 95, 100, ['spouse'], 'His wife of forty-one years. She scolds, he hums; they hold hands on the bench at dusk.'],
  ['hobb', 'lyra', 95, 85, 100, ['child'], 'Star. The light he did not plan.'],
  ['hobb', 'sabeth', 85, 85, 100, ['ward', 'child'], 'The girl he took under his flame in the Greywinter. The daughter he got to choose.'],
  ['hobb', 'corran', 55, 70, 100, ['rival', 'friend'], 'Stones at the Kettle every night. Both cheat. He has never quite forgiven the courting.'],
  ['hobb', 'bram', 70, 85, 95, ['friend'], "His old road-partner's son. Mends the ladder every spring and calls him 'old man'."],
  ['hobb', 'alder', 55, 90, 90, ['friend'], 'The Reeve. Hobb trusts him completely.'],
  ['hobb', 'petra', 50, 70, 100, [], 'Caught his daughter. Calls him "the candle".'],
  ['hobb', 'garrick', 15, 40, 80, [], "Swears Garrick's Cinderwick oil is watered."],
  ['hobb', 'aveline', 50, 80, 90, [], 'Lights the chapel with his candles.'],
  ['hobb', 'elda', 50, 70, 95, [], 'The Kettle, and stones every night.'],
  ['hobb', 'pip', 45, 50, 85, [], 'Skips the lamplighter rhyme behind him.'],
  // Wenna
  ['wenna', 'hobb', 95, 90, 100, ['spouse'], '"That man." Forty-one years, and she waited fifteen for him first.'],
  ['wenna', 'lyra', 95, 85, 100, ['child'], 'Told her never to stay anywhere for their sake, and meant it.'],
  ['wenna', 'sabeth', 85, 85, 100, ['ward', 'child'], 'Taught her bees in the Greywinter. Sabeth sews her bee-veils.'],
  ['wenna', 'petra', 60, 85, 100, ['friend', 'rival'], 'Best friend and worst enemy for seventy years.'],
  ['wenna', 'corran', 55, 85, 100, ['friend'], 'Her old suitor. The first fish of every spring.'],
  ['wenna', 'elda', 45, 70, 90, ['friend'], 'Sells her honey too dear; Elda pays too much on purpose.'],
  ['wenna', 'aveline', 55, 80, 95, [], 'The back pew. They say very little to each other, and it suits them.'],
  ['wenna', 'alder', 5, 50, 95, [], 'The Reeve who wants her daughter married to a stone.'],
  ['wenna', 'bram', 50, 75, 90, [], 'Abel Ironhand\'s boy.'],
  // Elda
  ['elda', 'pip', 95, 80, 100, ['ward'], 'Her sparrow. Took him under her flame the night of the ferry.'],
  ['elda', 'garrick', 55, 55, 95, ['friend', 'rival'], 'The bread war. Never believes his stories; always asks for another.'],
  ['elda', 'mira', 80, 75, 95, ['friend'], 'Determined to marry her off to the Captain.'],
  ['elda', 'tobias', 65, 75, 90, ['friend'], 'Gives him twice the stew he pays for.'],
  ['elda', 'rowan', 60, 70, 90, [], 'Feeds his watch for free. He ignores her gossip.'],
  ['elda', 'corran', 55, 75, 90, [], 'His morning fish, her kitchen.'],
  ['elda', 'wys', 60, 60, 90, [], 'Feeds him as if he were still growing. He is.'],
  ['elda', 'bram', 65, 80, 95, ['friend'], 'A bowl saved for him at the end of the bar.'],
  ['elda', 'wenna', 60, 75, 90, ['friend'], 'Pays too much for her honey, on purpose.'],
  ['elda', 'lyra', 85, 80, 100, ['friend'], 'Four years under her roof. Not hurt about the Wayhouse. Not at all.'],
  ['elda', 'aveline', 60, 85, 90, ['friend'], 'Tells her everything. Aveline tells her nothing.'],
  ['elda', 'petra', 45, 55, 95, [], 'The bench outside the Kettle is Petra\'s throne.'],
  // Bram
  ['bram', 'pip', 70, 60, 90, [], 'Tin animals on the Kettle windowsill.'],
  ['bram', 'tilly', 60, 70, 100, ['apprentice'], 'Too loud, too quick, and the best pair of hands he has trained. He has not told her so.'],
  ['bram', 'hobb', 70, 85, 95, ['friend'], '"The old man." Mends his ladder every spring.'],
  ['bram', 'aveline', 70, 85, 90, ['friend'], 'Sat with him the night Hanna died.'],
  ['bram', 'rowan', 35, 75, 90, [], 'Made his sword. Rowan never oils it.'],
  ['bram', 'mira', 50, 75, 85, [], 'Her burn salve, which he pretends not to need.'],
  ['bram', 'elda', 60, 75, 95, ['friend'], 'Saves him a bowl.'],
  ['bram', 'lyra', 65, 80, 90, ['friend'], '"Mage." Asks good questions. Does not waste words.'],
  ['bram', 'garrick', 15, 55, 85, [], 'Talks too much. Pays on time.'],
  // Pip
  ['pip', 'elda', 90, 85, 100, ['parent'], 'Like a mum.'],
  ['pip', 'bram', 70, 75, 85, ['friend'], 'The secret maker of tin animals. Pip knows.'],
  ['pip', 'rowan', 85, 80, 80, [], 'The bravest person ever, except Lyra.'],
  ['pip', 'tansy', 70, 70, 90, ['friend'], 'His partner in crime. She pretends he is a nuisance.'],
  ['pip', 'corran', 40, 55, 80, [], 'Likes him. Cannot quite look at him.'],
  ['pip', 'tobias', 60, 65, 85, ['friend'], 'The boar-track business: a copper a track.'],
  ['pip', 'garrick', 60, 60, 80, ['friend'], 'Broken biscuits.'],
  ['pip', 'lyra', 95, 85, 90, ['friend'], 'The best mage in the WHOLE world. She is teaching him when he is eleven.'],
  ['pip', 'aveline', 35, 60, 80, [], 'Her candle-ends make the best spells.'],
  // Rowan
  ['rowan', 'wys', 55, 50, 95, ['apprentice'], 'His only full-time watchman. Drills him hard.'],
  ['rowan', 'hess', 20, 60, 90, [], 'She blames him for Davin, aloud, and he lets her.'],
  ['rowan', 'mira', 45, 75, 80, [], 'Very good at salves.'],
  ['rowan', 'alder', 20, 60, 90, ['rival'], 'Watchmen requested, watchmen refused.'],
  ['rowan', 'garrick', 10, 25, 85, [], "Has questions about Garrick's luck on the road."],
  ['rowan', 'aveline', 70, 90, 95, ['friend'], 'His counsel.'],
  ['rowan', 'bram', 50, 80, 90, [], 'Made his sword and nags about it.'],
  ['rowan', 'elda', 55, 75, 90, [], 'Feeds the watch for free.'],
  ['rowan', 'pip', 50, 55, 85, [], 'Wants to blow the whistle.'],
  ['rowan', 'sabeth', 35, 60, 85, [], 'Always civil. Has never once smiled at him. He has never asked why.'],
  ['rowan', 'lyra', 45, 65, 80, [], 'Said no to the watch, plainly, with her reasons.'],
  // Mira
  ['mira', 'rowan', 70, 75, 80, ['crush'], 'She loves him and cannot say so.'],
  ['mira', 'lyra', 80, 85, 90, ['friend'], 'Her quiet friend since girlhood.'],
  ['mira', 'elda', 60, 75, 90, ['friend'], 'Teases her about the Captain without mercy.'],
  ['mira', 'sabeth', 30, 65, 85, ['rival'], 'Dye-plants traded for herbs, and the murrel-root war.'],
  ['mira', 'tobias', 55, 75, 85, ['friend'], 'Chamomile and worries.'],
  ['mira', 'aveline', 70, 85, 90, ['mentor'], 'Taught her to read the old herbals.'],
  ['mira', 'bram', 50, 75, 85, [], 'Makes his burn salve stronger every year.'],
  // Tobias
  ['tobias', 'tansy', 90, 70, 100, ['child'], 'Loves her and does not understand her.'],
  ['tobias', 'hess', 25, 65, 80, [], 'Hunts the boars off his field. He is a little afraid of her.'],
  ['tobias', 'corran', 55, 80, 85, ['friend'], 'Good with a net, good at keeping quiet.'],
  ['tobias', 'elda', 70, 80, 90, ['friend'], 'Twice the stew he pays for.'],
  ['tobias', 'pip', 55, 60, 85, ['friend'], 'His partner in the boar-track business.'],
  ['tobias', 'mira', 55, 75, 85, ['friend'], 'Chamomile for worries.'],
  ['tobias', 'garrick', 45, 55, 85, [], 'Sells his wheat on the road as the best in three counties.'],
  ['tobias', 'lyra', 55, 70, 75, [], 'Works for her coin and asks about his turnips like they matter.'],
  // Tansy
  ['tansy', 'tobias', 70, 55, 100, ['parent'], 'Loves him. Rolls her eyes at him. Protects him.'],
  ['tansy', 'hess', 85, 85, 85, ['mentor'], 'Her hero.'],
  ['tansy', 'pip', 35, 60, 90, ['friend'], 'Pretends he is a nuisance.'],
  ['tansy', 'tilly', 80, 80, 95, ['friend'], 'Best friends.'],
  ['tansy', 'lyra', 15, 45, 70, [], 'Judges her for refusing the stone. Edgy respect.'],
  ['tansy', 'wys', 0, 40, 85, [], "Wys reports Duchess to the Captain."],
  // Aveline
  ['aveline', 'rowan', 70, 80, 95, ['friend'], 'She counsels him.'],
  ['aveline', 'bram', 70, 80, 90, ['friend'], 'Sat with him the night Hanna died.'],
  ['aveline', 'petra', 65, 70, 95, ['friend'], 'Sunday plum brandy.'],
  ['aveline', 'wenna', 60, 80, 95, [], 'The back pew. Very little said.'],
  ['aveline', 'alder', 15, 60, 90, ['rival'], 'Opponents before the Moot over Lyra and the stone.'],
  ['aveline', 'mira', 70, 80, 90, ['apprentice'], 'Taught her to read the old herbals.'],
  ['aveline', 'garrick', 40, 40, 90, [], 'He confesses things to her sideways, by over-praising his wares.'],
  ['aveline', 'lyra', 65, 70, 90, ['friend'], 'She carries her own light.'],
  ['aveline', 'pip', 45, 55, 85, [], 'Pilfers candle-ends for his spells.'],
  // Garrick
  ['garrick', 'elda', 65, 70, 95, ['friend', 'rival'], 'The bread war.'],
  ['garrick', 'hess', 30, 45, 85, [], 'Rides guard on his cart and argues every price.'],
  ['garrick', 'sabeth', 40, 65, 85, [], 'Fetches her dyes from Brightwater and grumbles at her prices.'],
  ['garrick', 'rowan', 25, 50, 85, [], 'The captain watches his cart.'],
  ['garrick', 'tobias', 60, 75, 85, ['friend'], 'Best wheat in three counties, he swears.'],
  ['garrick', 'pip', 65, 55, 80, ['friend'], 'Future customer, future mage, present menace.'],
  ['garrick', 'aveline', 35, 50, 90, [], 'She looks at him as if she knows.'],
  ['garrick', 'lyra', 55, 70, 80, [], 'Hardest bargain in the valley. Won\'t take the guard job.'],
  ['garrick', 'hobb', 35, 60, 80, [], 'Complains about the oil. Buys it anyway.'],
  // Hess
  ['hess', 'sabeth', 90, 85, 100, ['partner'], 'One roof, two flames.'],
  ['hess', 'rowan', -30, 35, 90, ['grudge'], 'Blames him for Davin, aloud.'],
  ['hess', 'garrick', 10, 30, 90, [], "Guards his cart. Has noticed his luck on the road."],
  ['hess', 'tansy', 60, 65, 85, ['apprentice'], 'Takes her on the short runs to the hem.'],
  ['hess', 'tobias', 30, 60, 80, [], 'Hunts his boars. He flinches when she says hello.'],
  ['hess', 'wys', 0, 40, 80, [], 'His clumsy patrols scare off the game.'],
  ['hess', 'lyra', 60, 70, 85, ['friend'], 'Taught her to track. One argument: Varek.'],
  // Sabeth
  ['sabeth', 'hess', 90, 80, 100, ['partner'], 'One roof, two flames.'],
  ['sabeth', 'hobb', 85, 80, 100, ['parent'], 'Her foster-father.'],
  ['sabeth', 'wenna', 85, 85, 100, ['parent'], 'Her foster-mother. Bees and bee-veils.'],
  ['sabeth', 'lyra', 85, 80, 95, ['sibling'], '"Sister." Re-dyes her cloak every spring.'],
  ['sabeth', 'garrick', 35, 55, 85, [], 'Fetches her dyes and grumbles at her prices.'],
  ['sabeth', 'rowan', 5, 40, 85, [], 'Always civil to him.'],
  ['sabeth', 'mira', 30, 60, 85, ['rival'], 'The murrel-root war.'],
  // Alder
  ['alder', 'petra', 55, 60, 100, ['parent'], 'His mother, who mocks him in public.'],
  ['alder', 'tilly', 75, 60, 100, ['child'], 'Chose the forge over his ledgers.'],
  ['alder', 'hobb', 60, 80, 95, ['friend'], 'Hobb trusts him.'],
  ['alder', 'rowan', 30, 70, 90, ['rival'], 'Keeps refusing his watchmen.'],
  ['alder', 'aveline', 30, 70, 90, ['rival'], 'His opponent before the Moot over Lyra.'],
  ['alder', 'lyra', 10, 40, 85, [], 'Selfish, he says, with great respect.'],
  ['alder', 'wenna', 25, 60, 90, [], 'Has opinions about procedure. Loud ones.'],
  // Petra
  ['petra', 'wenna', 60, 80, 100, ['friend', 'rival'], 'Best friend and worst enemy for seventy years.'],
  ['petra', 'alder', 60, 55, 100, ['child'], 'Her son. She mocks him in public.'],
  ['petra', 'tilly', 85, 80, 100, ['family'], 'Her granddaughter, her ally in every family war.'],
  ['petra', 'aveline', 65, 70, 95, ['friend'], 'Sunday brandy. Aveline waters it.'],
  ['petra', 'hobb', 55, 75, 100, [], '"The candle."'],
  ['petra', 'corran', 50, 70, 100, [], 'Will dance with him at the Moot to annoy Wenna.'],
  ['petra', 'lyra', 70, 65, 100, ['friend'], '"Kicker." Came out kicking and hasn\'t stopped.'],
  ['petra', 'hess', 50, 60, 95, [], 'Taking bets on her and Sabeth.'],
  ['petra', 'sabeth', 55, 65, 95, [], 'Taking bets on her and Hess.'],
  // Tilly
  ['tilly', 'bram', 80, 85, 95, ['mentor'], '"Master", to annoy him.'],
  ['tilly', 'alder', 40, 55, 100, ['parent'], 'Ledgers against the forge.'],
  ['tilly', 'petra', 85, 85, 100, ['family'], 'Her ally in every family war.'],
  ['tilly', 'tansy', 85, 85, 95, ['friend'], 'Best friends.'],
  ['tilly', 'wys', -10, 45, 90, ['rival'], 'The line in the dirt at the hammer-throw.'],
  ['tilly', 'lyra', 60, 60, 80, ['friend'], 'Owes her a copper she will never take.'],
  // Corran
  ['corran', 'wenna', 70, 85, 100, ['friend', 'crush'], 'Still brings her the first fish of spring. Thinks nobody notices.'],
  ['corran', 'hobb', 60, 75, 100, ['rival', 'friend'], 'His nightly opponent at stones.'],
  ['corran', 'pip', 70, 60, 85, [], 'Pulled him out of the water.'],
  ['corran', 'elda', 55, 75, 90, [], 'Buys his fish.'],
  ['corran', 'tobias', 55, 75, 85, ['friend'], 'Good lad. Worries.'],
  ['corran', 'lyra', 60, 65, 90, ['friend'], 'Pulled her out of the lake blue as a mussel, and she bit him.'],
  ['corran', 'petra', 45, 70, 100, [], 'Says she will dance with him. He is afraid she means it.'],
  // Wys
  ['wys', 'rowan', 90, 90, 95, ['mentor'], 'The Captain is right.'],
  ['wys', 'tilly', -10, 45, 90, ['rival'], 'Her foot was over the line.'],
  ['wys', 'elda', 65, 70, 90, [], 'Feeds him.'],
  ['wys', 'hess', 20, 55, 80, [], 'She frightens him without trying.'],
  ['wys', 'lyra', 75, 70, 70, ['crush'], 'Since he was twelve. She has been clear.'],
  ['wys', 'tansy', 5, 45, 85, [], 'Laughs at him about Duchess.'],
  // Lyra (her side lives in mind.relationships once she exists; this is her first day)
  ['lyra', 'hobb', 90, 85, 100, ['parent'], 'Da. Gentlest man I know. Stubborn as a lamp-post.'],
  ['lyra', 'wenna', 90, 85, 100, ['parent'], 'Mam. Seventy-six, nearly blind, and the fiercest person in this valley.'],
  ['lyra', 'sabeth', 85, 80, 90, ['sibling'], 'Beth. My sister.'],
  ['lyra', 'hess', 60, 70, 85, ['friend'], 'Taught me to track. One argument: Varek.'],
  ['lyra', 'elda', 75, 75, 90, ['friend'], 'Best honey cakes in the Lowmarch. Eleven out of ten.'],
  ['lyra', 'mira', 75, 80, 85, ['friend'], 'The cleverest person in this village.'],
  ['lyra', 'bram', 65, 75, 85, ['friend'], 'Tea and an hour of silence after Davin\'s funeral.'],
  ['lyra', 'pip', 60, 55, 70, ['friend'], 'Sprout. I teach him when he is eleven.'],
  ['lyra', 'rowan', 40, 65, 75, [], 'Captain. Works like he is paying something off.'],
  ['lyra', 'tobias', 45, 60, 70, [], 'Apologizes to weeds.'],
  ['lyra', 'aveline', 55, 65, 75, ['friend'], 'Beats me at cards and quotes scripture doing it.'],
  ['lyra', 'garrick', 40, 45, 70, [], 'Could sell a hat to a fish.'],
  ['lyra', 'alder', 10, 35, 80, [], 'Reeve. We get on fine at a distance of one table.'],
  ['lyra', 'petra', 60, 60, 90, ['friend'], 'The only person in this village ruder than I am.'],
  ['lyra', 'tilly', 50, 55, 75, [], 'Copper. I owe her one.'],
  ['lyra', 'tansy', 20, 40, 65, [], 'Thinks I should marry a rock.'],
  ['lyra', 'corran', 55, 60, 85, ['friend'], 'Pulled me out of the lake. I bit him.'],
  ['lyra', 'wys', 25, 45, 60, [], 'Watchman.'],
];

// Two people who are each other's family, whatever the tag on either side says.
export const FAMILY_TAGS = new Set(['spouse', 'child', 'parent', 'ward', 'sibling', 'family', 'partner']);
