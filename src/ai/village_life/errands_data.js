// What Hearthvale's eighteen need from each other in a day (DESIGN §28): the errands
// each villager may run, the people each one expects to find where they always are, what
// the village has to trade, and who minds whose work when someone is missing. Data only:
// errands.js plans the day from it, village_life.js runs it.
//
// Errand template:
//   { id, who, to (person needed, or null for a place-only job), at (location id),
//     window: [from, to] hours (when the person is reliably there), kind: buy | sell |
//     collect | deliver | visit | fetch | task, goods (what changes hands, said aloud), item (an item
//     id that really moves, when there is one), qty, price (copper), purpose (why, as they
//     would think it), label (what the village view shows: "off to Gale's Goods for wick"),
//     why [what they tell you if you ask where they're off to], going [muttered on setting
//     off], talks [[ [speaker, text], ... ], ...] (the exchange; one variant is played),
//     solo [what they say doing a place-only job], next (a follow-up errand), days
//     ('sunday'), weight, care (how much the errand matters to their day, 0..1) }
//
// Lines use: {n} what the speaker calls the listener, {P} the player's name.
// Nothing here may state a truth LORE §9.10 keeps hidden (tests check with hidden.js).

export const PRONOUNS = {
  hobb: 'he', wenna: 'she', elda: 'she', bram: 'he', pip: 'he', rowan: 'he', mira: 'she', tobias: 'he', aveline: 'she',
  garrick: 'he', hess: 'she', sabeth: 'she', alder: 'he', petra: 'she', tilly: 'she', tansy: 'she', corran: 'he', wys: 'he',
  lyra: 'she', player: 'they',
};

export function pronoun(id, form = 'he') {
  const p = PRONOUNS[id] || 'they';
  const table = {
    he: { he: 'he', him: 'him', his: 'his', He: 'He', His: 'His', "he's": "he's", "He's": "He's" },
    she: { he: 'she', him: 'her', his: 'her', He: 'She', His: 'Her', "he's": "she's", "He's": "She's" },
    they: { he: 'they', him: 'them', his: 'their', He: 'They', His: 'Their', "he's": "they're", "He's": "They're" },
  };
  return table[p][form] ?? form;
}

// How a place is named in the middle of a sentence ("at the smithy", "by the lake").
export const PLACE_PHRASE = {
  hearthvale: 'in the village',
  town_square: 'the square',
  player_home: 'the Wayhouse',
  ember_kettle: 'the Kettle',
  smithy: 'the smithy',
  general_store: "Gale's Goods",
  chapel: 'the chapel',
  herbalist: "Mira's shop",
  guardhouse: 'the guardhouse',
  farmhouse: 'the Reed farmhouse',
  lamplight_lane: 'Lamplight Lane',
  chandlery: 'the chandlery',
  ashby_house: 'Ashby House',
  weavers_row: "Weavers' Row",
  pike_house: "Nan Pike's",
  holloway_house: "the Holloways'",
  tolley_house: "the Tolleys'",
  dye_cottage: 'the dye-vats',
  net_shed: "Corran's net-shed",
  wenna_hives: "Wenna's hives",
  reed_farm: 'Reed Farm',
  whisperwood: 'the edge of the Whisperwood',
  moonpetal_glade: 'the Moonpetal Glade',
  stonecut_quarry: 'the quarry',
  bandit_camp: 'the hills past the lake',
  mirror_lake: 'the lake',
  sunken_ruins: 'out by the ruins',
  south_meadow: 'South Meadow',
  kings_road: "the King's Road",
  wilds: 'out past the village',
};

// "at the smithy" / "by the lake" / "in the Kettle" / "out by the ruins".
export const PLACE_AT = {
  hearthvale: 'in the village',
  town_square: 'in the square',
  ember_kettle: 'at the Kettle',
  whisperwood: 'at the edge of the Whisperwood',
  mirror_lake: 'down by the lake',
  stonecut_quarry: 'up at the quarry',
  south_meadow: 'out in South Meadow',
  kings_road: "on the King's Road",
  reed_farm: 'out at Reed Farm',
  sunken_ruins: 'out by the ruins',
  bandit_camp: 'up in the hills past the lake',
  wilds: 'out past the village',
  lamplight_lane: 'on Lamplight Lane',
  weavers_row: "on Weavers' Row",
  moonpetal_glade: 'out at the Moonpetal Glade',
  wenna_hives: "out by Wenna's hives",
};

export function placePhrase(id, fallbackName = '') {
  return PLACE_PHRASE[id] || (fallbackName ? `the ${String(fallbackName).replace(/^the /i, '')}` : 'somewhere');
}

export function placeAt(id, fallbackName = '') {
  return PLACE_AT[id] || `at ${placePhrase(id, fallbackName)}`;
}

// ------------------------------------------------------------------ the errands

export const ERRANDS = [
  // Hobb ----------------------------------------------------------------------
  {
    id: 'hobb_wick', who: 'hobb', to: 'garrick', at: 'general_store', window: [13.25, 16.25], kind: 'buy', goods: 'wick', qty: 1, price: 2,
    purpose: 'buy wick for tonight’s lamp-round', label: "off to Gale's Goods for wick", care: 0.75, weight: 1.6,
    why: ["Wick, from Garrick's. Lamps don't light on wishes.", "Gale's Goods. Every wick wants trimming, and I've none left to trim."],
    going: ['Wick. Well now. Wick.', "Off to Garrick's. Slowly."],
    talks: [
      [['hobb', "Well now, Garrick. Wick, if you've any that isn't watered."], ['garrick', "My friend! The finest wick in three counties. And the oil's not watered, I swear on my mother's mule."], ['hobb', "Mm. The lamps'll tell me."]],
      [['hobb', 'A hank of wick, Garrick. The long kind.'], ['garrick', 'For the lamplighter, the long kind and a copper off. Nobody tell Elda I gave a discount.'], ['hobb', "Well now. Your secret's safe in my bad ear."]],
    ],
  },
  {
    id: 'hobb_candles', who: 'hobb', to: 'aveline', at: 'chapel', window: [7.4, 10.6], kind: 'deliver', goods: 'candles', item: 'candle', qty: 4,
    purpose: "take the chapel its fresh candles", label: 'taking new candles to the chapel', care: 0.6, weight: 1.2,
    why: ["Fresh candles for the flames. Wenna's wax, my dipping."],
    going: ['Candles for the Sister.'],
    talks: [
      [['hobb', "Fresh candles for the flames, Sister. Dipped this morning."], ['aveline', "Peace on you, Hobb. They'll burn true. Yours always do."]],
      [['hobb', "Well now, Sister. Four for the altar, and the stubs for Pip's 'spells'."], ['aveline', 'You encourage him, child. …Leave them by the woodpile, then.']],
    ],
  },
  {
    id: 'hobb_ladder', who: 'hobb', to: 'bram', at: 'smithy', window: [8, 11.4], kind: 'visit', goods: 'a loose rung',
    purpose: 'get Bram to look at the ladder’s loose rung', label: 'asking Bram to mend the ladder', care: 0.45, weight: 0.8,
    why: ["The ladder's got a rung that talks back. Bram'll hush it."],
    talks: [
      [['hobb', "Lad. The third rung's loose again."], ['bram', 'Hmph. Leave it. Done by dusk.'], ['hobb', "Well now. You're your father's son."]],
    ],
  },
  // Wenna ---------------------------------------------------------------------
  {
    id: 'wenna_honey_rite', who: 'wenna', to: 'aveline', at: 'chapel', window: [13.1, 14.3], kind: 'deliver', goods: 'a crock of honey', item: 'honey', qty: 1,
    purpose: 'leave a crock of honey for the Sheaf Moot rite', label: 'bringing honey for the rite', care: 0.5, weight: 1,
    why: ["Honey for the rite. Somebody in this village has to remember the old ways."],
    talks: [
      [['wenna', "There. Linden, the last pull. For the rite, Sister."], ['aveline', 'Thank you, Wenna.'], ['wenna', "Don't thank me. Thank the bees."]],
    ],
  },
  {
    id: 'wenna_salve', who: 'wenna', to: 'mira', at: 'herbalist', window: [14.7, 16.5], kind: 'buy', goods: 'sting salve', qty: 1, price: 3,
    purpose: 'buy sting salve from Mira', label: "going to Mira's for sting salve", care: 0.4, weight: 0.9,
    why: ["Sting salve. Not that I feel them any more. Hobb does, on my behalf."],
    talks: [
      [['wenna', "Mira, girl. Sting salve. The strong one."], ['mira', 'Oh! Yes. Here. Sorry — here. Twice a day.'], ['wenna', 'Stop apologising and take my coppers.']],
    ],
  },
  // Elda ----------------------------------------------------------------------
  {
    id: 'elda_honey', who: 'elda', to: 'wenna', at: 'chandlery', window: [11.6, 12.85], kind: 'buy', goods: 'honey', item: 'honey', qty: 2, price: 12,
    purpose: 'buy honey from Wenna for the honey cakes', label: 'off to the chandlery for honey', care: 0.7, weight: 1.6,
    why: ["Honey, love, from Wenna. A hundred honey cakes for the Moot don't sweeten themselves."],
    going: ["Honey. Two crocks. Don't let me forget.", 'Back in a blink, love, mind the kettle!'],
    talks: [
      [['elda', "Two crocks, Wenna love, and don't you dare give me change."], ['wenna', "Twelve coppers. And I'll hear no thanks for it."], ['elda', "You'll hear it anyway."]],
      [['elda', "Wenna! Honey, love. For the Moot cakes."], ['wenna', "You pay too much on purpose, Elda Thornbury. I know it, and I charge you more for it."]],
    ],
  },
  {
    id: 'elda_needles', who: 'elda', to: 'garrick', at: 'general_store', window: [15.05, 15.9], kind: 'buy', goods: 'needles', qty: 1, price: 2,
    purpose: 'buy needles, and see what Garrick’s charging for bread', label: "nipping to Gale's Goods for needles", care: 0.4, weight: 1.1,
    why: ["Needles, love. And a look at what Garrick's charging for bread."],
    talks: [
      [['elda', 'Needles, Garrick. And I see your bread\'s still six coppers.'], ['garrick', 'Quality costs, Elda! Your five-copper loaf is a doorstop.'], ['elda', 'My doorstops sell out by noon, love.']],
    ],
  },
  {
    id: 'elda_mira', who: 'elda', to: 'mira', at: 'herbalist', window: [15.05, 15.9], kind: 'visit', goods: 'a word about the Captain',
    purpose: 'tell Mira the Captain is on the square', label: 'off to make mischief at the herbalist', care: 0.3, weight: 0.8,
    why: ["Just a word with Mira, love. About nothing. About the Captain."],
    talks: [
      [['elda', "Love, the Captain's on the square. Go and say hello."], ['mira', "Elda! I'm brewing. Sorry. I'm brewing."], ['elda', 'Brew faster, then.']],
    ],
  },
  // Bram ----------------------------------------------------------------------
  {
    id: 'bram_oil', who: 'bram', to: 'rowan', at: 'ember_kettle', window: [12.1, 12.85], kind: 'visit', goods: 'sword oil',
    purpose: 'give Rowan a flask of sword oil he will not use', label: 'taking sword oil to the Captain', care: 0.3, weight: 0.9,
    why: ['Oil. For a sword that never gets any.'],
    talks: [
      [['bram', 'Oil. For the sword.'], ['rowan', "It's oiled."], ['bram', "Hmph. It's not."]],
    ],
  },
  {
    id: 'bram_hinge', who: 'bram', to: null, at: 'town_square', window: [14.2, 16.4], kind: 'task', goods: 'the well-cap hinge',
    purpose: 'fit the new hinge on the well-cap', label: 'fitting the well-cap hinge', care: 0.5, weight: 1.1,
    why: ['The well-cap hinge. Before the sheaf is burned on it.'],
    solo: ['Hmph. Children on the well-cap again.', 'Good iron. Holds.'],
  },
  // Pip -----------------------------------------------------------------------
  {
    id: 'pip_lunch', who: 'pip', to: 'bram', at: 'smithy', window: [11.3, 11.9], kind: 'deliver', goods: "Bram's lunch", item: 'bread', qty: 1,
    purpose: 'take Mister Bram his lunch from Elda', label: 'taking Bram his lunch', care: 0.6, weight: 1.6,
    why: ["Elda says Mister Bram forgets to EAT. So I'm taking him lunch. It's very important. Like a quest."],
    going: ['Lunch for Mister Bram! Coming through!'],
    talks: [
      [['pip', 'Mister Bram! Elda says EAT. Is that a new tin animal? Is it for me?'], ['bram', 'Hmph. Tell her thank you.'], ['pip', "Is it, though? For me?"], ['bram', '…It might be.']],
      [['pip', 'Lunch! I only ate a little bit of the crust. That was the toll.'], ['bram', 'Hmph. Fair toll.']],
    ],
  },
  {
    id: 'pip_tracks', who: 'pip', to: 'tobias', at: 'reed_farm', window: [13.3, 14.8], kind: 'sell', goods: 'boar tracks', price: 1,
    purpose: 'report boar tracks to Mister Tobias for a copper', label: 'reporting boar tracks at Reed Farm', care: 0.4, weight: 1.2,
    why: ['Boar tracks! Real ones! Probably! Mister Tobias pays a copper each.'],
    talks: [
      [['pip', 'Mister Tobias! Boar tracks! By the fence! Real ones! Probably!'], ['tobias', "Oh dear. Oh — well. Here's your copper. Show me, if it's not too much trouble."]],
    ],
  },
  {
    id: 'pip_notice', who: 'pip', to: null, at: 'town_square', window: [9, 11.2], kind: 'task', goods: 'a notice',
    purpose: 'pin a new notice on the board', label: 'pinning a notice on the board', care: 0.2, weight: 0.8,
    why: ["New notice! LOST: BISCUIT. He's not lost. That's the trick."],
    solo: ['LOST: BISCUIT. (HE IS NOT LOST.) There.'],
  },
  // Rowan ---------------------------------------------------------------------
  {
    id: 'rowan_alder', who: 'rowan', to: 'alder', at: 'ember_kettle', window: [13.3, 15.6], kind: 'visit', goods: 'the watch rota',
    purpose: 'press the Reeve again for two paid watchmen', label: 'taking the rota to the Reeve', care: 0.5, weight: 1.1,
    why: ['Moot business. Watchmen. Again.'],
    talks: [
      [['rowan', 'Reeve. Two paid watchmen and a proper rota.'], ['alder', 'Ahem. The Moot cannot afford — I will put it on the agenda, Captain.'], ['rowan', "That's what you said last month."]],
    ],
  },
  {
    id: 'rowan_hess', who: 'rowan', to: 'hess', at: 'kings_road', window: [9, 11.5], kind: 'visit', goods: 'word of the road',
    purpose: 'ask Hess what she saw on the road', label: "walking the King's Road to find Hess", care: 0.4, weight: 0.9,
    why: ['The road. I want Hess\'s report.'],
    talks: [
      [['rowan', 'Morrow. Anything on the road?'], ['hess', 'Mm. Tracks at the fork. Old.'], ['rowan', 'Thank you.'], ['hess', "Don't."]],
    ],
  },
  // Mira ----------------------------------------------------------------------
  {
    id: 'mira_petra', who: 'mira', to: 'petra', at: 'town_square', window: [9, 11.6], kind: 'deliver', goods: 'knee salve',
    purpose: "take Petra her knee salve", label: 'taking Petra her knee salve', care: 0.6, weight: 1.4,
    why: ['Mistress Petra\'s knee salve. Comfrey and willow-bark. Sorry, you didn\'t ask what was in it.'],
    talks: [
      [['mira', 'Your knee salve, Mistress Petra. Twice a day. Not with brandy.'], ['petra', "Duckling, everything's better with brandy. Ask Aveline."]],
    ],
  },
  {
    id: 'mira_bram', who: 'mira', to: 'bram', at: 'smithy', window: [14.1, 16.5], kind: 'deliver', goods: 'burn salve',
    purpose: 'leave Bram his burn salve', label: 'taking burn salve to the smithy', care: 0.5, weight: 1.1,
    why: ['Burn salve for Bram. He says he doesn\'t need it. He needs it.'],
    talks: [
      [['mira', "Burn salve. I've — it's the same as always."], ['bram', "Hmph. Don't need it."], ['mira', "I'll leave it by the quench-tub, then. Sorry."]],
    ],
  },
  {
    id: 'mira_sabeth', who: 'mira', to: 'sabeth', at: 'town_square', window: [17.05, 17.9], kind: 'visit', goods: 'dye-plants for herbs',
    purpose: 'trade dye-plants with Sabeth', label: 'trading dye-plants with Sabeth', care: 0.3, weight: 0.8,
    why: ["Trading with Sabeth. Woad for — and we are NOT talking about the murrel-root patch."],
    talks: [
      [['mira', 'The woad you wanted. And the murrel-root patch is still mine.'], ['sabeth', "Hold still, you've a thread loose. And no, it isn't."]],
    ],
  },
  // Tobias --------------------------------------------------------------------
  {
    id: 'tobias_wheat', who: 'tobias', to: 'garrick', at: 'general_store', window: [15, 17.2], kind: 'sell', goods: 'wheat', item: 'wheat', qty: 4, price: 8,
    purpose: 'sell Garrick wheat for the Brightwater run', label: "taking wheat to Gale's Goods", care: 0.6, weight: 1.4,
    why: ["Wheat for Garrick, if it's not too much trouble. He says it's the best in three counties. Oh dear, I hope he's right."],
    talks: [
      [['tobias', "Four sheaves, Garrick, if it's not too much trouble."], ['garrick', 'The best wheat in three counties! I tell Brightwater so every month.'], ['tobias', 'Oh, you needn\'t. But thank you.']],
    ],
  },
  {
    id: 'tobias_chamomile', who: 'tobias', to: 'mira', at: 'herbalist', window: [13.2, 14.6], kind: 'visit', goods: 'chamomile',
    purpose: 'swap Mira chamomile for a worry or two', label: "taking chamomile to Mira's", care: 0.3, weight: 0.9,
    why: ['Chamomile for Mira. She gives me worries back. No — the other way round.'],
    talks: [
      [['tobias', 'Chamomile, Mira. Late this year. Oh dear, is that bad?'], ['mira', "No — it's fine. It's late everywhere. Thank you."]],
    ],
  },
  // Aveline -------------------------------------------------------------------
  {
    id: 'aveline_mira', who: 'aveline', to: 'mira', at: 'herbalist', window: [15, 16.6], kind: 'visit', goods: 'a page of the old herbal',
    purpose: 'bring Mira the page of the old herbal she wanted', label: "taking an old herbal to Mira's", care: 0.3, weight: 0.9,
    why: ['A page of an old herbal for Mira. Silverleaf, as the old ones knew it.'],
    talks: [
      [['aveline', 'I found the page on silverleaf you wanted, child.'], ['mira', 'Oh! Thank you. Sorry. Thank you.']],
    ],
  },
  {
    id: 'aveline_brandy', who: 'aveline', to: 'petra', at: 'ashby_house', window: [13.1, 14.4], kind: 'visit', goods: 'Sunday brandy', days: 'sunday',
    purpose: 'sit with Petra over the Sunday plum brandy', label: 'off for Sunday brandy with Petra', care: 0.4, weight: 2,
    why: ['Sunday, child. Petra and I have an appointment with a bottle.'],
    talks: [
      [['aveline', 'Sunday, Petra.'], ['petra', "Duckling! Sit. I've not watered it. Much."], ['aveline', 'I heard that.']],
    ],
  },
  // Garrick -------------------------------------------------------------------
  {
    id: 'garrick_dyes', who: 'garrick', to: 'sabeth', at: 'dye_cottage', window: [7.7, 10.4], kind: 'deliver', goods: 'Brightwater madder',
    purpose: 'bring Sabeth her madder from Brightwater', label: 'taking dyes out to the dye-vats', care: 0.5, weight: 1.2,
    why: ["Sabeth's madder, all the way from Brightwater. At a price that would make my mother's mule weep."],
    talks: [
      [['garrick', 'Your Brightwater madder, Sabeth! And the price is robbery, I know, I know.'], ['sabeth', "It's robbery from you, Garrick. Hold still, you've a thread loose."]],
    ],
  },
  {
    id: 'garrick_hess', who: 'garrick', to: 'hess', at: 'ember_kettle', window: [19.1, 19.9], kind: 'visit', goods: 'a guard for the oil run',
    purpose: 'hire Hess to ride guard on the Cinderwick oil run', label: 'hiring Hess for the oil run', care: 0.6, weight: 1.1,
    why: ['Hess. The Cinderwick run, before the snow. I need her on the cart.'],
    talks: [
      [['garrick', 'Hess! The Cinderwick run, before the snow. Your usual fee?'], ['hess', 'Double.'], ['garrick', 'Double! My friend, I—'], ['hess', "Wind's wrong. Double."]],
    ],
  },
  {
    id: 'garrick_bread', who: 'garrick', to: 'elda', at: 'ember_kettle', window: [12.1, 12.8], kind: 'visit', goods: 'the price of bread',
    purpose: 'see what Elda is charging for bread today', label: 'checking on the bread war', care: 0.2, weight: 0.8,
    why: ["Reconnaissance, my friend. In the bread war."],
    talks: [
      [['garrick', 'Five coppers, Elda? You\'ll ruin us both.'], ['elda', 'Six is robbery, love. Sit, have some stew.'], ['garrick', '…Just a small bowl.']],
    ],
  },
  // Hess ----------------------------------------------------------------------
  {
    id: 'hess_venison', who: 'hess', to: 'elda', at: 'ember_kettle', window: [12.05, 12.9], kind: 'sell', goods: 'venison', item: 'venison', qty: 2, price: 9,
    purpose: 'sell Elda venison for the Moot', label: 'taking venison to the Kettle', care: 0.5, weight: 1.3,
    why: ['Venison. For the Kettle.'],
    talks: [
      [['hess', 'Venison. Fresh.'], ['elda', "Oh, lovely. Sit, love, you're dead on your feet."], ['hess', 'Mm.']],
    ],
  },
  {
    id: 'hess_pelts', who: 'hess', to: 'garrick', at: 'general_store', window: [16, 16.9], kind: 'sell', goods: 'a wolf pelt', item: 'wolf_pelt', qty: 1, price: 10,
    purpose: 'sell Garrick a wolf pelt', label: "selling a pelt at Gale's Goods", care: 0.5, weight: 1.1,
    why: ["A pelt for Garrick. He'll haggle. He'll lose."],
    talks: [
      [['hess', 'Wolf pelt. Ten.'], ['garrick', "Ten? Hess, my friend, it's a wolf, not a bear."], ['hess', 'Ten.'], ['garrick', '…Ten.']],
    ],
  },
  // Sabeth --------------------------------------------------------------------
  {
    id: 'sabeth_cloth', who: 'sabeth', to: 'garrick', at: 'general_store', window: [13.1, 15.3], kind: 'sell', goods: 'cloth', item: 'wool_cloak', qty: 1, price: 25,
    purpose: 'deliver dyed cloth to Garrick for the road', label: "delivering cloth to Gale's Goods", care: 0.6, weight: 1.5,
    why: ["Cloth for Garrick. Brightwater pays well for Hearthvale violet."],
    talks: [
      [['sabeth', 'Murrel violet and lake-wort teal. Count it.'], ['garrick', 'Exquisite! And the price is — Sabeth. The price.'], ['sabeth', 'Is the price. Busy\'s good.']],
    ],
  },
  {
    id: 'sabeth_veil', who: 'sabeth', to: 'wenna', at: 'chandlery', window: [14.6, 15.4], kind: 'deliver', goods: 'a mended bee-veil',
    purpose: 'give Wenna her mended bee-veil', label: 'mending Wenna’s bee-veil', care: 0.4, weight: 0.9,
    why: ["Wenna's bee-veil. She tore it again and swears she didn't."],
    talks: [
      [['sabeth', 'Your veil. Mended.'], ['wenna', "It wasn't torn."], ['sabeth', 'Then it\'s un-torn. Hold still.']],
    ],
  },
  // Alder ---------------------------------------------------------------------
  {
    id: 'alder_dues', who: 'alder', to: 'garrick', at: 'general_store', window: [8.6, 11.5], kind: 'collect', goods: 'the quarter’s Moot dues', price: 3,
    purpose: 'collect the quarter’s Moot dues from Garrick', label: "collecting Moot dues at Gale's Goods", care: 0.5, weight: 1.3,
    why: ["As Reeve, I must collect the quarter's dues. It is not personal. It is procedure."],
    talks: [
      [['alder', "Ahem. As Reeve, I must ask for the quarter's dues."], ['garrick', 'Splendid! Business is booming. Slowly. Very slowly. Here.'], ['alder', 'Noted. With thanks.']],
    ],
  },
  {
    id: 'alder_aveline', who: 'alder', to: 'aveline', at: 'chapel', window: [16.1, 16.9], kind: 'visit', goods: 'the Moot question',
    purpose: 'speak with Sister Aveline about the question for the Moot', label: 'calling on the chapel about Moot business', care: 0.3, weight: 0.9,
    why: ['Moot business. The question of the stone.'],
    talks: [
      [['alder', 'Sister. About the question of Lyra and the stone.'], ['aveline', 'A stone married unwillingly holds badly, Alder. I will say so before the Moot.'], ['alder', 'Ahem. So noted.']],
    ],
  },
  // Petra ---------------------------------------------------------------------
  {
    id: 'petra_dance', who: 'petra', to: 'corran', at: 'ember_kettle', window: [18.05, 18.9], kind: 'visit', goods: 'a dance at the Moot',
    purpose: 'make Corran promise her a dance at the Moot, to annoy Wenna', label: 'off to claim a dance from Corran', care: 0.3, weight: 1,
    why: ["Corran Dell is going to dance with me at the Moot. He doesn't know yet."],
    talks: [
      [['petra', "Corran Dell. You'll dance with me at the Moot."], ['corran', 'Hm-hmm. If my knees agree.'], ['petra', "Your knees'll do as they're told, duckling."]],
    ],
  },
  {
    id: 'petra_bets', who: 'petra', to: 'elda', at: 'ember_kettle', window: [12.05, 12.85], kind: 'visit', goods: 'the book on Hess and Sabeth',
    purpose: 'collect Elda’s bet on Hess and Sabeth', label: 'collecting bets at the Kettle', care: 0.3, weight: 1,
    why: ['Bets, duckling. On a joining of flames. Do you want in?'],
    talks: [
      [['petra', "Elda. A copper on the Moot. You're in or you're out."], ['elda', "In, love. Don't tell Hess."], ['petra', "Nobody tells Hess anything. That's the fun."]],
    ],
  },
  {
    id: 'petra_brandy', who: 'petra', to: 'aveline', at: 'chapel', window: [15.1, 16.4], kind: 'visit', goods: 'the plum brandy', days: 'sunday',
    purpose: 'take the Sunday plum brandy to Aveline', label: 'carrying Sunday brandy to the chapel', care: 0.4, weight: 2,
    why: ["It's Sunday. Aveline's expecting the brandy. She'll say she isn't."],
    talks: [
      [['petra', "Sunday, duckling. I've not watered it."], ['aveline', 'Petra. It is a chapel.'], ['petra', 'And this is plum brandy. Sit.']],
    ],
  },
  // Tilly ---------------------------------------------------------------------
  {
    id: 'tilly_ore', who: 'tilly', to: null, at: 'stonecut_quarry', window: [6.8, 9.6], kind: 'fetch', goods: 'iron ore', item: 'iron_ore', qty: 3,
    purpose: 'fetch iron ore from the quarry for the forge', label: 'fetching ore from the quarry', care: 0.7, weight: 1.6,
    why: ["Ore. From the quarry. Bram's orders. Well — Bram's grunt."],
    going: ['Quarry run! Back before the forge is hot. Probably.'],
    solo: ["Three good lumps. Bram'll grunt. That's a compliment.", 'Ore! Ha. The slimes can keep the puddles.'],
    next: {
      id: 'tilly_ore_deliver', to: 'bram', at: 'smithy', kind: 'deliver', goods: 'the ore', item: 'iron_ore', qty: 3, purpose: 'bring Bram the ore', label: 'bringing the ore back to the forge',
      talks: [
        [['tilly', "Ore, Master. Three lumps. One's mostly rock, I'm told by the rock."], ['bram', 'Hmph. Good.'], ['tilly', 'Good! He said good!']],
      ],
    },
  },
  {
    id: 'tilly_wys', who: 'tilly', to: 'wys', at: 'town_square', window: [18.55, 19.1], kind: 'visit', goods: 'the hammer-throw line',
    purpose: 'tell Wys, again, that her foot was not over the line', label: 'arguing with Wys about the hammer-throw', care: 0.2, weight: 0.9,
    why: ['Pike. The line. My foot was NOT over it.'],
    talks: [
      [['tilly', 'Pike. My foot was NOT over the line.'], ['wys', 'Citizen — I mean, Tilly — it was. By a thumb.'], ['tilly', 'By YOUR thumb, maybe.']],
    ],
  },
  // Tansy ---------------------------------------------------------------------
  {
    id: 'tansy_eggs', who: 'tansy', to: 'elda', at: 'ember_kettle', window: [12.05, 12.85], kind: 'sell', goods: 'eggs', item: 'egg', qty: 6, price: 6,
    purpose: 'sell Elda the morning’s eggs', label: 'taking eggs to the Kettle', care: 0.6, weight: 1.5,
    why: ["Eggs. For the Kettle. What."],
    talks: [
      [['tansy', "Eggs. Duchess says they're her best. She's lying."], ['elda', "Oh, lovely, love. Sit, you're skin and bone."], ['tansy', "I'm not sitting."]],
    ],
  },
  {
    id: 'tansy_wenna', who: 'tansy', to: 'wenna', at: 'chandlery', window: [11.6, 12.0], kind: 'sell', goods: 'eggs', item: 'egg', qty: 2, price: 2,
    purpose: 'take Wenna her two eggs', label: 'taking two eggs to the chandlery', care: 0.3, weight: 0.8,
    why: ['Two eggs for Wenna. She can tell if they\'re Duchess\'s. Somehow.'],
    talks: [
      [['tansy', 'Eggs.'], ['wenna', "Who's that? Tansy. You smell of hen."], ['tansy', '…Thanks.']],
    ],
  },
  // Corran --------------------------------------------------------------------
  {
    id: 'corran_catch', who: 'corran', to: 'elda', at: 'ember_kettle', window: [9.0, 9.65], kind: 'sell', goods: 'the morning’s catch', item: 'raw_fish', qty: 4, price: 8,
    purpose: 'sell Elda the morning’s catch', label: 'bringing the morning’s catch to the Kettle', care: 0.6, weight: 1.8,
    why: ['Fish for Elda. Hm-hmm. Fish are biting, or lying about it.'],
    talks: [
      [['corran', "Hm-hmm. Four perch, Elda. Fair morning's work."], ['elda', "Lovely, Corran love. You'll stop for a cup?"], ['corran', 'One. Hm-hmm.']],
    ],
  },
  {
    id: 'corran_eel', who: 'corran', to: 'garrick', at: 'general_store', window: [13.1, 14.5], kind: 'sell', goods: 'smoked eel', item: 'smoked_eel', qty: 2, price: 10,
    purpose: 'sell Garrick smoked eel for the road', label: "taking smoked eel to Gale's Goods", care: 0.4, weight: 1.1,
    why: ["Eel for Garrick. He tells Brightwater it's Saltmere eel. Hm-hmm. The lake doesn't mind."],
    talks: [
      [['corran', 'Two smoked eel. Hm-hmm.'], ['garrick', "Saltmere's finest! …Mirror Lake's finest. Thank you, Corran."]],
    ],
  },
  // Wys -----------------------------------------------------------------------
  {
    id: 'wys_report', who: 'wys', to: 'rowan', at: 'ember_kettle', window: [19.1, 19.9], kind: 'visit', goods: 'his report',
    purpose: 'report the day’s watch to the Captain', label: 'reporting to the Captain', care: 0.6, weight: 1.6,
    why: ['Reporting to the Captain! Very formal. Very important.'],
    talks: [
      [['wys', 'Captain! Report: the square is secure. One suspicious figure. It was Duchess.'], ['rowan', 'Noted. Eat something, Pike.']],
      [['wys', 'Captain. Report. Nothing. Nothing at all. Very alert.'], ['rowan', 'Good. Sit down before you fall down.']],
    ],
  },
  {
    id: 'wys_hess', who: 'wys', to: 'hess', at: 'kings_road', window: [9.2, 11.4], kind: 'visit', goods: 'a patrol report',
    purpose: 'check the road with Hess', label: "walking the King's Road to check in with Hess", care: 0.3, weight: 0.8,
    why: ["Checking the road. With Hess. Who frightens me. Not that I'd say so."],
    talks: [
      [['wys', 'Citizen! — Hess. Anything to report? I mean. Hello.'], ['hess', "Mm. You're scaring the deer, Pike."]],
    ],
  },
];

export const ERRANDS_BY_WHO = (() => {
  const m = {};
  for (const e of ERRANDS) (m[e.who] ||= []).push(e);
  return m;
})();

export function errandTemplate(id) {
  for (const e of ERRANDS) {
    if (e.id === id) return e;
    if (e.next?.id === id) return { ...e.next, who: e.who, window: [e.window[0], 24] };
  }
  return null;
}

// ------------------------------------------------------------------ who expects whom

// Routine meetings: who expects to find whom, where, when. If they are not there the
// one waiting notices: Tilly finds the forge cold, Elda saves a bowl nobody eats, Sabeth
// sits down to supper alone. Everyone is expected somewhere by someone every day, so
// nobody vanishes without being missed by nightfall. `what`: what they meant to do.
export const EXPECTS = [
  { who: 'tilly', whom: 'bram', at: 'smithy', window: [6.4, 11.9], what: 'work the forge with Bram' },
  { who: 'tilly', whom: 'bram', at: 'smithy', window: [13.2, 17.3], what: 'work the forge with Bram' },
  { who: 'bram', whom: 'tilly', at: 'smithy', window: [6.5, 11.8], what: 'have Tilly at the forge', mild: true },
  { who: 'tansy', whom: 'hess', at: 'kings_road', window: [8.2, 10.9], what: 'go on the short run with Hess' },
  { who: 'sabeth', whom: 'hess', at: 'dye_cottage', window: [18.1, 18.9], what: 'have supper with Hess', late: true },
  { who: 'hess', whom: 'sabeth', at: 'dye_cottage', window: [18.1, 18.9], what: 'have supper with Sabeth' },
  { who: 'hobb', whom: 'corran', at: 'ember_kettle', window: [21.7, 22.7], what: 'play stones with Corran' },
  { who: 'corran', whom: 'hobb', at: 'ember_kettle', window: [21.7, 22.4], what: 'play stones with Hobb' },
  { who: 'petra', whom: 'wenna', at: 'chandlery', window: [14.7, 17.3], what: 'quarrel with Wenna' },
  { who: 'wenna', whom: 'petra', at: 'chandlery', window: [14.7, 17.3], what: 'quarrel with Petra', mild: true },
  { who: 'wenna', whom: 'hobb', at: 'chandlery', window: [6.05, 6.45], what: 'have breakfast with Hobb' },
  { who: 'hobb', whom: 'wenna', at: 'chandlery', window: [6.05, 6.45], what: 'have breakfast with Wenna' },
  { who: 'pip', whom: 'elda', at: 'ember_kettle', window: [7.6, 8.4], what: 'have breakfast' },
  { who: 'elda', whom: 'pip', at: 'ember_kettle', window: [18.6, 19.4], what: 'see Pip eat his supper' },
  { who: 'elda', whom: 'garrick', at: 'ember_kettle', window: [18.3, 19.8], what: 'serve Garrick his supper' },
  { who: 'elda', whom: 'bram', at: 'ember_kettle', window: [18.2, 19.3], what: 'give Bram the bowl she saves him' },
  { who: 'elda', whom: 'corran', at: 'ember_kettle', window: [18.2, 19.3], what: 'serve Corran his supper', mild: true },
  { who: 'elda', whom: 'mira', at: 'ember_kettle', window: [18.1, 18.9], what: 'feed Mira and tease her about the Captain', mild: true },
  { who: 'elda', whom: 'aveline', at: 'ember_kettle', window: [18.1, 18.9], what: 'serve Aveline her supper', mild: true },
  { who: 'elda', whom: 'rowan', at: 'ember_kettle', window: [19.1, 19.9], what: 'feed the watch', mild: true },
  { who: 'alder', whom: 'petra', at: 'ashby_house', window: [19.1, 20.4], what: 'have supper with his mother' },
  { who: 'alder', whom: 'tilly', at: 'ashby_house', window: [17.6, 17.95], what: 'have supper with his daughter' },
  { who: 'tobias', whom: 'tansy', at: 'reed_farm', window: [13.2, 16.9], what: 'see Tansy at her chores' },
  { who: 'tansy', whom: 'tobias', at: 'reed_farm', window: [13.2, 16.9], what: 'keep an eye on her da', mild: true },
  { who: 'wys', whom: 'rowan', at: 'town_square', window: [20.1, 20.9], what: 'walk the evening watch with the Captain' },
  { who: 'rowan', whom: 'wys', at: 'town_square', window: [20.1, 20.9], what: 'walk the evening watch with Pike' },
];

// ------------------------------------------------------------------ the village's goods

// Each morning's stock, per seller. Keys are item ids where the item exists, else a plain
// word (what they say aloud). Errands draw it down; so does the player at the shop.
export const STOCK = {
  garrick: { wick: 6, needles: 4, salt: 5, bread: 8, potion: 4, lantern: 2 },
  wenna: { honey: 4 },
  tansy: { egg: 9 },
  corran: { raw_fish: 5, smoked_eel: 3 },
  hess: { venison: 3, wolf_pelt: 1 },
  sabeth: { wool_cloak: 2 },
  mira: { 'sting salve': 3, 'knee salve': 2, 'burn salve': 2, herb: 5 },
  hobb: { candle: 10 },
  elda: { bread: 10, honey_cake: 8, stew: 8 },
  tobias: { wheat: 8, turnip: 10 },
};

// What each producer has in hand in the morning (really moves on errands).
export const MORNING_GOODS = {
  hobb: { candle: 4 },
  wenna: { honey: 3 },
  tansy: { egg: 8 },
  corran: { raw_fish: 4, smoked_eel: 2 },
  hess: { venison: 2, wolf_pelt: 1 },
  sabeth: { wool_cloak: 1 },
  tobias: { wheat: 4 },
  pip: { bread: 1 },
};

// ------------------------------------------------------------------ when someone is missing

// Who minds whose work once someone is missing (schedules adapt).
export const COVER = {
  garrick: { by: 'alder', at: 'general_store', hours: [8, 17], doing: "minding Gale's Goods while Garrick is missing" },
  bram: { by: 'tilly', at: 'smithy', hours: [6, 17.5], doing: 'keeping the forge lit while Bram is missing' },
  elda: { by: 'sabeth', at: 'ember_kettle', hours: [7, 20], doing: 'keeping the Kettle while Elda is missing' },
  mira: { by: 'aveline', at: 'herbalist', hours: [8, 12], doing: "minding Mira's shelves while she is missing" },
  tobias: { by: 'tansy', at: 'reed_farm', hours: [6, 17], doing: 'doing her da’s work as well as her own' },
  aveline: { by: 'petra', at: 'chapel', hours: [11, 16], doing: 'tending the flames while Aveline is missing' },
  rowan: { by: 'wys', at: 'guardhouse', hours: [6, 9], doing: 'keeping the watch alone' },
  wys: { by: 'rowan', at: 'town_square', hours: [7, 12], doing: "walking Pike's rounds himself" },
  hobb: { by: 'wys', at: 'town_square', hours: [17.5, 19.5], doing: "lighting Hobb's lamps" },
  wenna: { by: 'hobb', at: 'wenna_hives', hours: [8, 10], doing: "minding Wenna's hives, badly" },
  tansy: { by: 'tobias', at: 'reed_farm', hours: [5, 7], doing: "feeding Tansy's hens" },
  hess: { by: 'wys', at: 'kings_road', hours: [8, 11], doing: "walking Hess's road himself" },
  sabeth: { by: 'hess', at: 'dye_cottage', hours: [8, 11], doing: 'stirring the vats, wrongly' },
  alder: { by: 'petra', at: 'ashby_house', hours: [8, 12], doing: "keeping Alder's ledger, in her own way" },
};

// Places worth searching outside the houses, nearest first from the square (never past
// the ward: nobody goes outside it alone).
export const OUTSKIRTS = ['whisperwood', 'wenna_hives', 'mirror_lake', 'south_meadow', 'reed_farm', 'stonecut_quarry', 'kings_road'];
export const BEYOND_WARD = new Set(['bandit_camp', 'sunken_ruins', 'wilds']);

// Who the watch is, in order of who takes charge.
export const WATCH = ['rowan', 'wys'];
// Who searches well (trackers) and who never goes out searching (the frail, the young at night).
export const TRACKERS = new Set(['hess', 'tansy', 'rowan', 'wys']);
export const NO_SEARCH = new Set(['wenna', 'petra', 'elda']);
export const CHILDREN = new Set(['pip', 'tansy']);

// Hearthvale's weekday: the clock's day 7, 14, … is a Sunday.
export function isSunday(day) {
  return day % 7 === 0;
}
