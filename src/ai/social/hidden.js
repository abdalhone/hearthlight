// What no one in Hearthvale may say aloud (docs/LORE.md §9.10, "Who knows what"): the
// truths marked hidden, and the character secrets that only their keepers know. Every
// line the village speaks passes through speakable(): the local banks are written to
// pass it (tests/social.test.mjs checks), and anything Claude writes that fails it is
// dropped in favour of the local line.
//
// Each pattern looks for the secret being *stated*. Suspicions and the village's false
// versions ("most people blame Wys for the flute", "fourteen on the lamplighter's
// count") are what people really say, so they are not caught here.

export const HIDDEN_TRUTHS = [
  { id: 'varek_sibling', re: /\bvarek\b[^.!?]{0,60}\b(brother|sister|sibling|kin)\b|\b(brother|sister)\b[^.!?]{0,40}\bvarek\b|\bvarek coll\b|\bcoll\b[^.!?]{0,30}\bone-eye\b/i },
  { id: 'rowan_spear', re: /\b(rowan|captain|he)\b[^.!?]{0,60}\b(took|struck|put out)\b[^.!?]{0,40}\beye\b|\bspear\b[^.!?]{0,60}\b(boy|varek|boundary)\b[^.!?]{0,40}\b(eye|blood)\b|\bblood\b[^.!?]{0,30}\bboundary stones?\b/i },
  { id: 'rowan_flute', re: /\b(rowan|the captain)\b[^.!?]{0,40}\b(plays?|playing)\b[^.!?]{0,20}\bflute\b|\bflute\b[^.!?]{0,40}\b(is|was) (rowan|the captain)\b/i },
  { id: 'count_truth', re: /\b(alder|osric|reeve)\b[^.!?]{0,60}\b(read|lied|said|told)\b[^.!?]{0,40}\bfourteen\b|\bhobb\b[^.!?]{0,40}\bcounted\b[^.!?]{0,40}\b(every soul|everyone|all of them|more than fourteen)\b|\bnot hobb'?s count\b/i },
  { id: 'alder_vote', re: /\b(alder|reeve)\b[^.!?]{0,50}\b(wept|weeping|crying|cried)\b|\bcouldn'?t (turn|do) it twice\b/i },
  { id: 'brightborn', re: /\bbrightborn\b|\b(wenna|mam|her mother)\b[^.!?]{0,60}\b(walked out|asked)\b[^.!?]{0,40}\b(brightfall|falling light|the drift)\b|\beyes glowed\b|\bcandles? (all )?leaned\b|\bpinched the candles\b/i },
  { id: 'garrick_toll', re: /\b(garrick|gale|i)\b[^.!?]{0,40}\b(pays?|paid|paying|leave|left|leaves)\b[^.!?]{0,40}\b(the toll|toll|bandits'? toll|purse)\b[^.!?]{0,40}\b(bandits?|varek|boundary stone|stone)\b|\bpurse\b[^.!?]{0,30}\bboundary stone\b/i },
  { id: 'bandit_question', re: /\bbandits?\b[^.!?]{0,40}\basked (garrick|me)\b[^.!?]{0,40}\b(stranger|mountain)\b/i },
  { id: 'hess_scout', re: /\bhess\b[^.!?]{0,50}\b(didn'?t|did not|never|failed to)\b[^.!?]{0,20}\b(come|scout)\b|\b(drunk|drank)\b[^.!?]{0,40}\b(ambush|morning)\b/i },
  { id: 'hess_blames_lyra', re: /\bhess\b[^.!?]{0,30}\bblames?\b[^.!?]{0,30}\blyra\b/i },
  { id: 'wys_froze', re: /\b(wys|pike|i)\b[^.!?]{0,30}\bfroze\b|\bfroze\b[^.!?]{0,30}\bwolf\b/i },
  { id: 'maren_song', re: /\bmaren\b[^.!?]{0,60}\b(is alive|still alive|singing|joined the song|in the song|a keeper|is held)\b|\bkeepers? of the song\b|\bsang (herself|themselves) in\b/i },
  { id: 'maren_letter', re: /\bstrongbox\b|\bmaren'?s?\b[^.!?]{0,20}\bletter\b[^.!?]{0,30}\b(elda|kept|locked)\b|\byou are free of me\b|\bkeep your own wick\b[^.!?]{0,20}\blittle lamp\b/i },
  { id: 'aveline_message', re: /\bi chose this\b|\btell her not to follow\b|\bmaren'?s? (last )?message\b/i },
  { id: 'ewan_alive', re: /\bewan\b[^.!?]{0,50}\b(alive|saltmere|new wife|another family|walked away)\b|\browan'?s father\b[^.!?]{0,40}\b(alive|saltmere)\b/i },
  { id: 'moonpetal_cakes', re: /\bmoonpetal\b[^.!?]{0,40}\b(cakes?|honey cakes?)\b|\b(cakes?)\b[^.!?]{0,40}\bmoonpetal\b/i },
  { id: 'mira_herbs', re: /\b(mira|i|she)\b[^.!?]{0,20}\b(leaves?|left|leaving)\b[^.!?]{0,20}\bthe herbs\b[^.!?]{0,30}\bguardhouse\b|\bit'?s mira\b[^.!?]{0,40}\bherbs\b|\bmira'?s herbs\b[^.!?]{0,20}\bguardhouse\b/i },
  { id: 'bram_poems', re: /\bbram\b[^.!?]{0,40}\b(poems?|poetry|poet)\b|\b(poems?|poetry)\b[^.!?]{0,40}\btin box\b|\bthe fire forgets nothing\b/i },
  { id: 'tobias_ferry', re: /\b(tobias|i'?m|he'?s|i am|he is)\b[^.!?]{0,30}\bbuy(ing)?\b[^.!?]{0,30}\bferry-?house\b|\bferry-?house\b[^.!?]{0,40}\bfor june\b/i },
  { id: 'june_letter', re: /\bjune\b[^.!?]{0,50}\b(asked (him|tobias|da) to move|isn'?t coming back|not coming back|might not come back|left him)\b|\b(tansy|i)\b[^.!?]{0,20}\b(has|have|hid|hides|keep|kept)\b[^.!?]{0,20}\b(june'?s|mam'?s|ma'?s|mother'?s) letter\b/i },
  { id: 'night_trips', re: /\b(pip|tansy|we)\b[^.!?]{0,40}\b(sneak|sneaks|sneaked|snuck)\b[^.!?]{0,40}\b(out|night|ruins|hem)\b/i },
  { id: 'pip_fear', re: /\bpip\b[^.!?]{0,30}\bafraid\b[^.!?]{0,30}\blyra\b[^.!?]{0,40}\bruins\b/i },
  { id: 'lake_verse', re: /\bverse-?house\b|\bdrowned\b[^.!?]{0,30}\b(house|temple|gate)\b|\bwaygate\b[^.!?]{0,40}\blake\b|\bsomething sleeps\b[^.!?]{0,30}\blake\b/i },
  { id: 'stranger_keeper', re: /\b(stranger|they|the mountain one|found one)\b[^.!?]{0,40}\bwas a keeper\b|\bkeeper\b[^.!?]{0,40}\b(stranger|put out)\b/i },
  { id: 'map_verse', re: /\bmap\b[^.!?]{0,40}\bchart of the verse\b/i },
  { id: 'song_broke', re: /\bbound\b[^.!?]{0,40}\bsing in their place\b/i },
];

// The first hidden truth a line states, or null.
export function hiddenIn(text) {
  const s = String(text || '');
  if (!s) return null;
  for (const h of HIDDEN_TRUTHS) if (h.re.test(s)) return h.id;
  return null;
}

export function speakable(text) {
  return !hiddenIn(text);
}
