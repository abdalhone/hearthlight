// STUB (owned by the combat/player agent).
// Contract: registerItemArt(atlas, rng) registers one 'icon:<itemId>' sprite (16x16) per item
// in entities/items.js, plus 'icon:unknown'. itemIcon(atlas, itemId) -> canvas (for DOM UI).
export function registerItemArt(atlas, rng) {}
export function itemIcon(atlas, itemId) {
  return atlas.frame(`icon:${itemId}`) || atlas.frame('icon:unknown') || null;
}
